# Security policy

BSYSTEM Operations is a small, internal, pilot-stage monitoring tool
(see `README.md`) — not a public product with a dedicated security
team or a paid disclosure program. This policy is scoped to match that
reality.

## Reporting a vulnerability

If you find a security issue in this repository (an authentication
bypass, a way to read/modify another server's data, a way to defeat the
enrollment claim/TTL mechanism, etc.):

- **Do not open a public GitHub issue for it.**
- Email the maintainer directly: evgen-kucher@ukr.net, or reach them via
  the existing internal BSYSTEM/BRAVO-Toolkit communication channel
  (Discord) if that's faster.
- Include what you found, how to reproduce it, and its likely impact.

## What to expect

This is a one-person project at pilot stage — there is no formal SLA.
In practice: expect an acknowledgement within a few business days, and
a fix or mitigation prioritized ahead of new feature work once
confirmed. If the issue affects a server currently enrolled in the pilot
(see `docs/ETAP5_PILOT_ROLLOUT_PLAN.md`), it will be treated as
high-priority regardless of when it's reported.

## Scope

Covers the code in this repository (`api/`, `ui/`, Docker/Compose
configuration, CI). Does not cover BRAVO-Toolkit itself (a separate
repository) or the hosting infrastructure a pilot deployment runs on —
report infrastructure-level findings through whatever channel is
appropriate for that host.
