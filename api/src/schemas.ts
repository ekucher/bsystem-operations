import { z } from 'zod';

// One product per server (grilling Q: "На одному сервері може бути лише
// один продукт або VetOffice або LIMS") — a server row carries exactly
// one of these, never both.
export const ProductType = z.enum(['LIMS', 'VETOFFICE']);
export type ProductType = z.infer<typeof ProductType>;

export const ServerStatus = z.enum(['pending', 'approved', 'revoked']);
export type ServerStatus = z.infer<typeof ServerStatus>;

export const EventCategory = z.enum(['backup', 'maintenance', 'health']);
export type EventCategory = z.infer<typeof EventCategory>;

export const Severity = z.enum(['SUCCESS', 'WARNING', 'ERROR', 'CRITICAL']);
export type Severity = z.infer<typeof Severity>;

// Mirrors BRAVO.Health's Get-ManagedServiceHealthIssues after its planned
// extension (Etap 2): every known service reports an explicit status on
// every health run, not just when something is wrong.
export const ServiceRunState = z.enum(['running', 'stopped', 'unknown']);
export type ServiceRunState = z.infer<typeof ServiceRunState>;

export const ServiceStatusEntry = z.object({
  name: z.string().min(1),
  status: ServiceRunState,
});
export type ServiceStatusEntry = z.infer<typeof ServiceStatusEntry>;

// Deliberately open-ended (`details`): backup/maintenance/health events
// carry different domain-specific fields (drive free space, sync issue
// counts, restore verification age, ...). Forcing a single rigid shape
// across all three categories this early would either lose information
// or force a premature union type. `message`/`component`/`services` are
// the fields Etap 3's UI needs unconditionally; everything else rides in
// `details` and is rendered generically until a concrete UI need narrows
// it.
export const EventPayload = z.object({
  message: z.string().min(1),
  component: z.string().optional(),
  services: z.array(ServiceStatusEntry).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type EventPayload = z.infer<typeof EventPayload>;

export const EnrollRequest = z.object({
  serverId: z.string().uuid(),
  institutionCode: z.string().min(1),
  productType: ProductType,
  hostname: z.string().min(1),
  bootstrapSecret: z.string().min(1),
});
export type EnrollRequest = z.infer<typeof EnrollRequest>;

export const EventRequest = z.object({
  category: EventCategory,
  severity: Severity,
  payload: EventPayload,
});
export type EventRequest = z.infer<typeof EventRequest>;

export const HeartbeatRequest = z.object({
  bravoVersion: z.string().optional(),
});
export type HeartbeatRequest = z.infer<typeof HeartbeatRequest>;

// Etap 3: role — RBAC-поняття, окреме від джерела автентифікації
// (v1 = local password_hash), щоб пізніше мігрувати на authentik OIDC,
// не переписуючи авторизаційні перевірки. 'admin' = перегляд + approve
// pending-серверів; 'viewer' = лише перегляд.
export const UserRole = z.enum(['admin', 'viewer']);
export type UserRole = z.infer<typeof UserRole>;

export const LoginRequest = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

// Minimum password policy for local accounts (create-admin CLI — see
// src/cli/create-admin.ts, the only place a password is ever set). Not
// applied to login: an existing weak password from before this policy
// existed must still be allowed to authenticate, only new/changed
// passwords are gated. Deliberately no composition rules (forced
// uppercase/digit/special-char) — length plus a denylist of the
// passwords attackers try first buys most of the real protection
// without the usability cost.
const COMMON_WEAK_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  'password1234',
  '123456789',
  '1234567890',
  '12345678910',
  'qwertyuiop',
  'qwertyuiop12',
  'qwertyuiop123',
  'letmein12345',
  'admin123456',
  'administrator',
  'changeme123',
  'welcome12345',
]);

export const NewPassword = z
  .string()
  .min(12, 'Password must be at least 12 characters long.')
  .refine((value) => !COMMON_WEAK_PASSWORDS.has(value.toLowerCase()), {
    message: 'Password is too common/predictable — choose a less guessable one.',
  });
export type NewPassword = z.infer<typeof NewPassword>;
