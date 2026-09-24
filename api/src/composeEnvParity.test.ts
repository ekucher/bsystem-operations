import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import { ENV_VAR_NAMES } from './config.js';

// envDocsParity.test.ts (PR #2 / Wave 1) only checks that every var
// config.ts's zod schema reads is *documented* in a .env.example file. It
// does NOT check that docker-compose.yml actually forwards that
// documented value into the api container's environment — an operator
// can set a var in their root .env, see it explained in .env.example, and
// have it silently do nothing because docker-compose.yml never mentions
// it (the real bug this test guards against: EVENT_RETENTION_DAYS,
// HEARTBEAT_MISSED_THRESHOLD, SESSION_TTL_HOURS and
// HEARTBEAT_EXPECTED_INTERVAL_MINUTES were all documented but not
// propagated until this fix).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ComposeDoc = any;

function loadCompose(): ComposeDoc {
  const raw = readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf-8');
  return parseYaml(raw);
}

// Vars that are deliberately NOT forwarded via `${VAR}` passthrough in the
// base compose file's `environment:` block, and why. Each of these is a
// conscious exception to "every documented var must be forwarded" — not
// an oversight — so keeping the list here (with reasons) means a var can
// only join it via a reviewed code change, not silently.
const INTENTIONALLY_NOT_PASSED_THROUGH: Record<string, string> = {
  // Container-internal wiring: always 8080 inside the container (nginx
  // proxies to it on the compose network); not something an operator
  // tunes via .env the way EVENT_RETENTION_DAYS is. Hardcoded in
  // docker-compose.yml on purpose.
  PORT: 'fixed container-internal port, not operator-configurable via .env',
  // Container-internal wiring: always the named volume's mount path
  // inside the container. Changing it without also changing the volume
  // mount would break the app; not an operator-facing knob.
  DB_PATH: 'fixed container-internal path tied to the volumes: mount, not operator-configurable via .env',
  // Baked into the image at build time via api/Dockerfile's `ARG
  // GIT_SHA` + `ENV GIT_SHA=$GIT_SHA` (sourced from docker-compose.yml's
  // build.args, not environment:) — already becomes a real container env
  // var without needing a second `environment:` passthrough.
  GIT_SHA: 'set via Dockerfile build ARG/ENV (docker-compose.yml build.args), not environment:',
  // Deliberately excluded from the base file so config.ts's fail-safe
  // `true` default (Secure-cookie) stands in production. Only
  // docker-compose.override.yml(.example) — local-dev-only, gitignored —
  // sets this to "false". See docker-compose.yml's own comment above the
  // DISCORD_ALERTS_WEBHOOK_URL line.
  COOKIE_SECURE: 'intentionally omitted from the base file so the secure-by-default value stands (dev opts out via docker-compose.override.yml)',
};

describe('env var / docker-compose.yml runtime propagation parity', () => {
  const compose = loadCompose();
  const apiEnvironment: Record<string, unknown> = compose.services.api.environment ?? {};

  it('forwards every operator-configurable env var into the api service, or documents why not', () => {
    const missing: string[] = [];
    for (const name of ENV_VAR_NAMES) {
      if (name in INTENTIONALLY_NOT_PASSED_THROUGH) {
        continue;
      }
      const value = apiEnvironment[name];
      const isPassthrough = typeof value === 'string' && value.includes(`\${${name}`);
      if (!isPassthrough) {
        missing.push(name);
      }
    }
    expect(missing).toEqual([]);
  });

  it('does not silently reintroduce a COOKIE_SECURE override in the base compose file', () => {
    // Regression guard for E2: the base file must keep relying on
    // config.ts's secure-by-default value. If this ever fires, someone
    // added COOKIE_SECURE back to docker-compose.yml's api.environment —
    // remove it (dev-only override belongs in
    // docker-compose.override.yml(.example) instead).
    expect(apiEnvironment).not.toHaveProperty('COOKIE_SECURE');
  });

  it("keeps the intentionally-not-forwarded allowlist limited to vars that really are container-internal", () => {
    // Guards the allowlist itself against silently growing: every name in
    // it must still be a real, known config var (not a typo) and every
    // entry must carry a non-empty justification.
    for (const [name, reason] of Object.entries(INTENTIONALLY_NOT_PASSED_THROUGH)) {
      expect(ENV_VAR_NAMES).toContain(name);
      expect(reason.length).toBeGreaterThan(0);
    }
  });
});
