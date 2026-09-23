#!/usr/bin/env node
// No self-registration route exists (see routes/auth.ts) — this CLI is
// the only way to create a local account. Run via
// `npm run create-admin --workspace=api -- --username X --password Y
// [--role admin|viewer]`.
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config.js';
import { hashPassword } from '../crypto.js';
import { openDb } from '../db.js';
import { OperationsRepository } from '../repository.js';

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

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!args.username || !args.password) {
    // eslint-disable-next-line no-console
    console.error('Usage: create-admin --username <name> --password <pass> [--role admin|viewer]');
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
    passwordHash: hashPassword(args.password),
    role,
    now: new Date().toISOString(),
  });
  // eslint-disable-next-line no-console
  console.log(`Created ${role} user '${args.username}'.`);
}

main();
