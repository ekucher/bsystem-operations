import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import { EnrollRequest } from './schemas.js';

// Targeted drift guard for the enrollment endpoints specifically (F8) —
// this is the area that changed the most during the D-series hardening
// (claim tokens, header-only bootstrap secret, 409s) and is the area
// most likely to silently drift from api/docs/openapi.yaml. Not a
// generic OpenAPI<->Zod diff engine: just the concrete fields/headers a
// human reading the spec would rely on to write a client.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OpenApiDoc = any;

function loadOpenApi(): OpenApiDoc {
  const raw = readFileSync(path.join(repoRoot, 'api', 'docs', 'openapi.yaml'), 'utf-8');
  return parseYaml(raw);
}

describe('openapi.yaml <-> schemas.ts parity: enrollment endpoints', () => {
  const doc = loadOpenApi();

  it('documents exactly the fields EnrollRequest (POST /enroll) requires', () => {
    const props = doc.paths['/enroll'].post.requestBody.content['application/json'].schema;
    const documentedRequired = new Set<string>(props.required ?? []);
    const documentedFields = new Set<string>(Object.keys(props.properties ?? {}));

    const zodShape = EnrollRequest.shape;
    const zodFields = new Set<string>(Object.keys(zodShape));
    // All of EnrollRequest's fields are required (none use .optional()),
    // so the required set and the field set are the same here.
    const zodRequired = zodFields;

    expect(documentedFields).toEqual(zodFields);
    expect(documentedRequired).toEqual(zodRequired);
  });

  it('documents X-Bootstrap-Secret as the only auth for POST /enroll (D2: header-only transport)', () => {
    const security = doc.paths['/enroll'].post.security;
    expect(security).toEqual([{ bootstrapSecret: [] }]);
    expect(doc.components.securitySchemes.bootstrapSecret.name).toBe('X-Bootstrap-Secret');
    expect(doc.components.securitySchemes.bootstrapSecret.in).toBe('header');
  });

  it('documents the 409 already_finalized response for POST /enroll (D6)', () => {
    const responses = doc.paths['/enroll'].post.responses;
    expect(Object.keys(responses)).toEqual(expect.arrayContaining(['202', '400', '401', '409', '503']));
  });

  it('documents GET /enroll/{serverId} as requiring both bootstrapSecret and enrollmentClaim (D1)', () => {
    const getOp = doc.paths['/enroll/{serverId}'].get;
    const security = getOp.security;
    expect(security).toEqual(expect.arrayContaining([{ bootstrapSecret: [] }, { enrollmentClaim: [] }]));
    expect(doc.components.securitySchemes.enrollmentClaim.name).toBe('X-Enrollment-Claim');

    // The claim also has to show up as an explicit path-level header
    // parameter (not just a securityScheme) since it's required per-call.
    const claimParam = (getOp.parameters ?? []).find(
      (p: { name?: string; in?: string }) => p.name === 'X-Enrollment-Claim' && p.in === 'header',
    );
    expect(claimParam).toBeDefined();
    expect(claimParam.required).toBe(true);
  });

  it('documents the collapsed 404 for GET /enroll/{serverId} (D7: unknown/revoked/bad-claim indistinguishable)', () => {
    const responses = doc.paths['/enroll/{serverId}'].get.responses;
    expect(Object.keys(responses)).toEqual(expect.arrayContaining(['200', '401', '404']));
  });
});
