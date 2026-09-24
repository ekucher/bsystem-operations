#!/usr/bin/env node
// No self-registration route exists (see routes/auth.ts) — this CLI is
// the only way to create a local account. Run via
// `npm run create-admin --workspace=api -- --username X [--role admin|viewer]`
// and you'll be prompted for a password with echo disabled (recommended,
// interactive use). `--password <pass>` remains supported for scripted/
// automated provisioning, but typing a real password on the command line
// leaves it in shell history and briefly visible to anyone who can list
// processes (`ps`) — prefer the interactive prompt whenever a human is
// running this.
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config.js';
import { hashPassword } from '../crypto.js';
import { openDb } from '../db.js';
import { OperationsRepository } from '../repository.js';
import { NewPassword } from '../schemas.js';

interface ParsedArgs {
  username?: string;
  password?: string;
  role?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--username') {
      out.username = argv[++i];
    } else if (arg === '--password') {
      out.password = argv[++i];
    } else if (arg === '--role') {
      out.role = argv[++i];
    }
  }
  return out;
}

// Reads a password from stdin with echo disabled, so it never appears on
// the terminal, in shell history, or in scrollback. Requires an
// interactive TTY (raw mode) — a piped/non-interactive stdin has no
// terminal to mute, so callers without a TTY must use --password instead.
function promptHiddenPassword(promptText: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new Error('stdin is not a TTY — pass --password explicitly for non-interactive use.'));
      return;
    }
    process.stdout.write(promptText);
    stdin.resume();
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    let input = '';
    const cleanup = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
    };
    const onData = (chunk: string): void => {
      switch (chunk) {
        case '\n':
        case '\r':
        case '': // Ctrl-D
          cleanup();
          process.stdout.write('\n');
          resolve(input);
          return;
        case '': // Ctrl-C
          cleanup();
          process.stdout.write('\n');
          reject(new Error('aborted'));
          return;
        case '': // backspace
        case '\b':
          input = input.slice(0, -1);
          return;
        default:
          input += chunk;
      }
    };
    stdin.on('data', onData);
  });
}

async function resolvePassword(args: ParsedArgs): Promise<string> {
  if (args.password) {
    return args.password;
  }
  const first = await promptHiddenPassword('Password: ');
  const second = await promptHiddenPassword('Confirm password: ');
  if (first !== second) {
    throw new Error('Passwords do not match.');
  }
  return first;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.username) {
    // eslint-disable-next-line no-console
    console.error(
      'Usage: create-admin --username <name> [--password <pass>] [--role admin|viewer]\n' +
        '(omit --password to be prompted interactively with echo disabled)',
    );
    process.exitCode = 1;
    return;
  }
  if (args.role && args.role !== 'admin' && args.role !== 'viewer') {
    // eslint-disable-next-line no-console
    console.error(`Invalid --role '${args.role}': expected 'admin' or 'viewer'.`);
    process.exitCode = 1;
    return;
  }
  const role = args.role === 'viewer' ? 'viewer' : 'admin';

  let password: string;
  try {
    password = await resolvePassword(args);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error((err as Error).message);
    process.exitCode = 1;
    return;
  }

  const policyCheck = NewPassword.safeParse(password);
  if (!policyCheck.success) {
    // eslint-disable-next-line no-console
    console.error(policyCheck.error.issues.map((issue) => issue.message).join(' '));
    process.exitCode = 1;
    return;
  }

  const config = loadConfig();
  const repository = new OperationsRepository(openDb(config.dbPath));

  if (repository.getUserByUsername(args.username)) {
    // eslint-disable-next-line no-console
    console.error(`User '${args.username}' already exists.`);
    process.exitCode = 1;
    return;
  }

  repository.createUser({
    id: randomUUID(),
    username: args.username,
    passwordHash: await hashPassword(policyCheck.data),
    role,
    now: new Date().toISOString(),
  });
  // eslint-disable-next-line no-console
  console.log(`Created ${role} user '${args.username}'.`);
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
