import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ENV_VAR_NAMES } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

// Guards against "we added a config knob but forgot to document it":
// every env var config.ts's zod schema actually reads must appear in at
// least one of the two .env.example files a developer would look at.
function documentedVarNames(filePath: string): Set<string> {
  const contents = readFileSync(filePath, 'utf-8');
  const names = new Set<string>();
  for (const line of contents.split('\n')) {
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line.trim());
    if (match) {
      names.add(match[1]);
    }
  }
  return names;
}

describe('env var / .env.example documentation parity', () => {
  const rootEnvExample = documentedVarNames(path.join(repoRoot, '.env.example'));
  const apiEnvExample = documentedVarNames(path.join(repoRoot, 'api', '.env.example'));
  const documented = new Set([...rootEnvExample, ...apiEnvExample]);

  it('documents every env var the app config schema reads', () => {
    const undocumented = ENV_VAR_NAMES.filter((name) => !documented.has(name));
    expect(undocumented).toEqual([]);
  });

  it('does not document config-shaped vars that the schema no longer reads', () => {
    // "Config-shaped" = looks like an app setting (not comments/blank
    // lines, already filtered by documentedVarNames). Every var either
    // file documents should be one the schema recognises — otherwise the
    // docs are describing a knob that doesn't exist (or exists under a
    // different name, which is just as confusing).
    const known = new Set<string>(ENV_VAR_NAMES);
    const strayInRoot = [...rootEnvExample].filter((name) => !known.has(name));
    const strayInApi = [...apiEnvExample].filter((name) => !known.has(name));
    expect(strayInRoot).toEqual([]);
    expect(strayInApi).toEqual([]);
  });
});
