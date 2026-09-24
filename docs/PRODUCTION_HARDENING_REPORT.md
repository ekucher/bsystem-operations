# BSYSTEM Operations — Production Hardening Report

Дата: 2026-09-24
Lead Agent: Claude (Sonnet 5), сесія `session_01Srqagc1Fs9avhEAiTXABrj`

## 1. Baseline

| Репозиторій | Branch | SHA на старті |
|---|---|---|
| bsystem-operations | main | `526bbdf7b2885edcd3e5387e6d759b3a26ef4995` |
| BRAVO-Toolkit | developer | `3e9e172a4b1fc1b41da8066b105ff46dadf66cb3` |
| BRAVO-Toolkit | feature/bsystem-operations-foundation | `620f2b0c9cb79263d1fa8b9943b30c883eae844b` (ahead 4 / behind 18 vs developer, diverged) |

Обидва baseline SHA підтверджено актуальними через `git fetch --all --prune` на момент старту (жоден не змінився з моменту постановки задачі).

## 2. Структура роботи

Lead Agent + 6 спеціалізованих субагентів, кожен у власному git worktree/branch:

| Агент | Branch | Область | Статус |
|---|---|---|---|
| A | `fix/ops-security-boundary` | API security/auth/public DTO | ✅ інтегровано |
| B | `fix/ops-runtime-config` | Docker/config/runtime hardening | ✅ інтегровано |
| C | `fix/ops-db-migrations` | DB migrations/backup | ✅ інтегровано |
| D | `fix/ops-credential-lifecycle` | Enrollment/credential lifecycle | ✅ інтегровано |
| F-UI | `fix/ops-ui-ci-hardening` | UI robustness | ✅ інтегровано |
| F2 | `fix/ops-ci-docs-governance` | CI/security/docs/governance | ✅ інтегровано |
| E | `feat/ops-reliable-telemetry` (BRAVO-Toolkit) | Durable telemetry/BRAVO agent | ✅ завершено, **НЕ змерджено в developer** (навмисно, лишається окремим branch на розгляд власника) |

Усі bsystem-operations-агенти інтегровано в `fix/operations-production-hardening` (base: main@526bbdf). Кожен агент review'ївся Lead Agent'ом особисто: читання diff, незалежний прогін тестів у Docker node:22 (не на слово агента), перевірка на scope creep/secrets.

**Виявлено й виправлено Lead Agent'ом самостійно (не агентами):**
- UI Docker build падав (`@rolldown/binding-linux-x64-musl`, відомий npm optional-deps баг на musl/alpine) — переніс build-стадію на glibc.
- Agent E зупинився посеред роботи (951 незакомічених рядків, "Standing by for monitor" замість звіту) — Lead Agent прочитав повний diff, знайшов і виправив реальний баг у власному self-test'і агента (E10-фікс, підтверджений тестом, насправді validated a WRONG double-`/api` URL as correct через невідповідність документованого прикладу конфігу і реального коду), перепрогнав повний `BRAVO_SELF_TEST.ps1` і закомітив роботу сам.

## 3. P0 findings — статус

| # | Finding | Статус |
|---|---|---|
| A1 | credential-хеші (`api_key_hash`, `pending_api_key`) витікали в JSON-відповіді | ✅ Fixed — `PublicServer`/`toPublicServer()` allow-list mapper |
| A2 | синхронний `scryptSync` у request path, немає rate limiting, timing leak на unknown username | ✅ Fixed — async scrypt, `LoginAttemptLimiter`, dummy-hash timing normalization |
| B1 | production compose дефолтив `dev-bootstrap-secret`/`COOKIE_SECURE=false` | ✅ Fixed — `${VAR:?err}`, підтверджено живим fail-closed тестом |
| B2 | API host-published напряму в production compose | ✅ Fixed — internal-only, nginx проксує |
| D1 | fleet-wide bootstrap secret сам по собі давав доступ до чужого API-ключа за відомим GUID | ✅ Fixed — per-enrollment claim token (`X-Enrollment-Claim`) |
| D6 | повторний enrollment безумовно переписував identity approved/revoked сервера | ✅ Fixed — 409 `already_finalized`, ніякої мутації post-approval |
| E9 (BRAVO) | пошкоджений server-id state-файл мовчки генерував новий GUID (ghost-ідентичність) | ✅ Fixed — fail-closed, ERROR-лог, без заміни |
| E10 (BRAVO) | URL-резолюція ламалась/дублювала `/api` залежно від trailing slash | ✅ Fixed — explicit string-join, підтверджено проти реальної документованої конвенції |

## 4. P1 findings — статус

- Migrations: `CREATE TABLE IF NOT EXISTS`-як-єдиний-механізм → versioned migrations (`PRAGMA user_version`), 7 кроків, upgrade-тести на старій схемі. **Fixed.**
- Backup: небезпечний `cp` WAL-БД → SQLite Online Backup API, restore-тест з `PRAGMA integrity_check`. **Fixed.**
- D3/D4/D5: reveal-once ключ без recovery, відсутній revoke/reissue, необмежений plaintext pending key → TTL-обмежений (5 хв) re-revealable reveal + повний revoke/reissue/audit-trail API. **Fixed.**
- E3/E4/E5/E6/E7 (durable telemetry): подія губилась назавжди при недоступності API → durable local outbox (file-per-event, atomic write), bounded exponential backoff, eventId/occurredAt envelope, ідемпотентний прийом на API-стороні (`UNIQUE(server_id, event_id)`). **Fixed.**
- E11: revoked credential не помічався агентом, 401 логувався і губився вічно → локальний ключ очищується на 401, природний re-enroll. **Fixed.**
- UI: malformed `stages` unsafe cast, never-heartbeated сервер показувався як "ok", сесія не оброблялась централізовано на 401. **Fixed.**

## 5. P2 findings — статус

- Readiness vs liveness розділено (`/health` vs `/ready`, DB-перевірка). **Fixed.**
- Graceful shutdown (SIGTERM/SIGINT, зупинка таймерів, закриття DB). **Fixed.**
- Build metadata (`GIT_SHA` → `/health.revision`). **Fixed.**
- Container hardening: non-root (вже було), `cap_drop: ALL`, `no-new-privileges`, bounded logging. **Fixed.** Read-only rootfs — свідомо пропущено (WAL-файли потребують запису поряд з `/data`, ризик визнано невиправданим для цього масштабу).
- CI: Docker E2E gate, OpenAPI lint + parity-тест, `npm audit`, gitleaks, workflow hardening (permissions, timeouts, SHA-pinned third-party actions). **Fixed.**
- Governance: branch protection на `main` (реально застосовано через `gh api`, перевірено), CODEOWNERS, SECURITY.md. **Fixed.** LICENSE — **відкрите рішення власника**, не вигадано.

## 6. Database migration result

`api/src/migrations.ts` — 7 версійних кроків, `PRAGMA user_version`, кожен у власній транзакції. Guard-логіка для pre-existing DB (створених старим `CREATE TABLE IF NOT EXISTS` шляхом до появи versioning) задокументована явно. Upgrade-тести: стара схема → нова, fresh install, подвійний прогін (ідемпотентність), навмисна помилка міграції зупиняє запуск без часткового стану. Backup/restore: `db.backup()` (SQLite Online Backup API) + `PRAGMA integrity_check` тест. Композитний індекс `(server_id, category, created_at DESC, id DESC)` доданий і обґрунтований через `EXPLAIN QUERY PLAN` (реальний вивід у звіті Agent C).

## 7. Credential lifecycle result

Повний цикл верифіковано **живим Docker E2E** (не лише unit-тестами):
```
enroll → claimToken → approve → poll (TTL 5хв, re-revealable) → apiKey
  → event (eventId) → retry того ж eventId → ідемпотентно (1 рядок у БД)
  → revoke → подальші events 401 → reissue → новий apiKey → event 202
  → GET /admin/servers/:id.recentActions показує approve→revoke→reissue по порядку
```
90+ unit/integration тестів на API-стороні покривають edge cases (409 already_finalized, 404 undistinguishable для unknown/revoked/wrong-claim, TTL expiry).

## 8. Telemetry reliability result

BRAVO.Operations.psm1 переписаний: durable file-per-event outbox (atomic write-to-temp-then-Replace), eventId/occurredAt/schemaVersion envelope зафіксований у момент виникнення події (не відправки), bounded exponential backoff (30s→1800s стеля), dead-letter для справжніх 4xx, opportunistic drain на кожному Send-виклику. 20 нових self-test кейсів, включно з симуляцією перезапуску процесу (Remove-Module/Import-Module) для перевірки durability.

## 9. BRAVO integration result

E1 виконано через **вибірковий cherry-pick** трьох Operations-специфічних комітів на свіжу гілку від актуального `developer` (не прямий merge розбіжної feature-гілки) — уникнуто притягування 2 нерелевантних комітів (chore/claude-state, unrelated if-else hardening), які випадково опинились на тій самій старій гілці. Diff проти `developer` — чистий, лише Operations-файли.

**Full `BRAVO_SELF_TEST.ps1`: 2248/2248 PASS, 0 FAIL** (виконано реально на цій Windows-машині через Windows PowerShell 5.1 — не "NOT EXECUTED", команда справді відпрацювала).

Гілка `feat/ops-reliable-telemetry` **не змержена в `developer`** і не запушена — лишається локально для рев'ю власником репозиторію перед PR, згідно з політикою "не merge diverged feature branch напряму".

## 10. Docker/runtime result

Живий Docker Compose E2E (двічі, на різних станах гілки): build обох образів, negative-case (без секрету — відмова стартувати), readiness poll, create-admin CLI, повний auth-цикл, graceful SIGTERM shutdown. Усі підтверджено реальним виводом команд, не припущеннями.

## 11. CI/security result

`.github/workflows/ci.yml`: 5 jobs (`api`, `ui`, `openapi-lint`, `supply-chain`, `docker-e2e`), усі з `timeout-minutes`, `permissions: contents: read`. `docker-e2e` job реально виконує enroll-free admin-цикл в GitHub Actions (build → negative-case → up → readiness poll → create-admin → login/me/servers/logout). `npm audit --audit-level=critical` (0 vulnerabilities станом на 2026-09-24), gitleaks (SHA-pinned).

## 12. Documentation result

README, `.env.example`, `api/.env.example`, `api/docs/openapi.yaml`, `docs/ETAP5_PILOT_ROLLOUT_PLAN.md`, `docs/backup-restore.md`, `docs/REPOSITORY_GOVERNANCE.md`, `SECURITY.md`, `CODEOWNERS` — усі оновлені й перевірені на відповідність фактичному коду (не аспіраційні).

## 13. Тести, реально виконані

- bsystem-operations API: **97 тестів / 12 файлів** (typecheck + build чисто), в Docker node:22 (відповідає CI Node 22, не хостовому Node 24 з непрацюючим native-toolchain для better-sqlite3).
- bsystem-operations UI: **8 тестів / 1 файл**, typecheck + build чисто.
- BRAVO-Toolkit: **повний `BRAVO_SELF_TEST.ps1` — 2248/2248 PASS**, виконано реально через Windows PowerShell 5.1 tool на цій машині.
- Живий Docker Compose E2E: виконано вручну двічі (базовий цикл + повний credential lifecycle з revoke/reissue).

## 14. Тести, НЕ виконані

- Реальний GitHub Actions прогін нового `docker-e2e`/`openapi-lint`/`supply-chain` job — команди виконано вручну локально й підтверджено ідентичні до того, що виконає CI, але **сам GitHub Actions runner не запускався** (гілка не запушена як PR). **NOT EXECUTED — гілка `fix/operations-production-hardening` запушена як branch, але PR не створено; CI має запуститись при відкритті PR.**
- Windows Server 2012-специфічна поведінка BRAVO.Operations — перевірено лише статично (PS 5.1-сумісний синтаксис, немає `??`/`?.`/класів) і через self-test на цій Windows 11 машині. **NOT EXECUTED на реальному Windows Server 2012 — середовище недоступне в цій сесії.**
- Реальний BRAVO agent проти живого bsystem-operations стенду (E2E між репозиторіями) — self-test мокає HTTP-транспорт; наскрізний ручний прогін PowerShell-агента проти Docker-стенду **не виконувався** в цій сесії (обмеження часу/скоупу).

## 15. Залишкові blockers

1. **PR не відкрито** ні для `fix/operations-production-hardening` (bsystem-operations), ні для `feat/ops-reliable-telemetry` (BRAVO-Toolkit) — обидва лишаються branch'ами, готовими до рев'ю власником.
2. **LICENSE відсутня** — зафіксовано як явний decision point (`docs/REPOSITORY_GOVERNANCE.md`), не вирішено.
3. BRAVO agent-side зміни не верифіковані наскрізно проти живого API (лише self-test з моком).
4. `required_approving_review_count: 0` на branch protection — свідомий компроміс (одноосібний власник не може approve власний PR), задокументовано з точними командами для підвищення пізніше.

## 16. Pilot readiness: **READY** (за умови відкриття й перевірки PR)

Усі 17 критеріїв з розділу 22 майстер-задачі виконані:
- [x] API credential leak closed
- [x] production Compose fail-closed
- [x] no default dev bootstrap secret
- [x] secure cookies production default
- [x] environment validation active (Zod)
- [x] migrations implemented and tested
- [x] backup + restore tested
- [x] enrollment loss recovery exists (TTL re-revealable claim)
- [x] revoke/reissue exists
- [x] per-enrollment credential boundary exists
- [x] BRAVO feature synced to current developer
- [x] Operations agent tests pass (self-test 2248/2248)
- [x] Docker E2E passes (виконано вручну; CI job написано, не прогнано в GitHub Actions)
- [x] readiness works
- [x] restart policy works
- [x] offline grace fixed (never-heartbeated стан)
- [x] UI malformed payload cannot crash page
- [x] current CI green (локальний прогін; сам workflow не виконувався в GitHub Actions)

## 17. Fleet readiness: **READY** (з тими самими застереженнями)

- [x] durable event outbox
- [x] eventId
- [x] idempotent API ingestion
- [x] occurredAt
- [x] retry/backoff
- [x] credential revocation lifecycle
- [x] auditable admin actions
- [x] automated DB restore verification
- [x] protected main / required CI (застосовано реально на GitHub)

## 18. Rollback notes

- Кожен агент — окремі, атомарні коміти в межах свого merge-коміту; `git revert <merge-sha>` відкочує роботу одного агента без впливу на інші (перевірено структурою — merge-коміти чисті, без конфліктних правок поза заявленою областю).
- Міграції API — forward-only (немає `down`-кроків); відкат схеми вимагає restore з backup (`docs/backup-restore.md`), не автоматичного down-migration.
- Branch protection на `main` можна тимчасово послабити через `gh api` команди, задокументовані в `docs/REPOSITORY_GOVERNANCE.md`.

## 19. Точні наступні дії

1. Власник переглядає й мержить PR для `fix/operations-production-hardening` → `main` (bsystem-operations).
2. Власник переглядає `feat/ops-reliable-telemetry` (BRAVO-Toolkit) і вирішує: merge в `developer` напряму, чи спершу rebase на подальші зміни `developer` (18+ комітів з моменту дивергенції продовжують надходити).
3. Реальний прогін GitHub Actions на відкритому PR — перша фактична перевірка нових CI jobs у справжньому середовищі раннера.
4. Вирішити LICENSE decision point.
5. Розглянути підвищення `required_approving_review_count` після додавання другого рев'ювера.
6. Наскрізний ручний тест реального BRAVO-агента проти розгорнутого bsystem-operations стенду (не лише self-test з моком) перед пілотом на реальному сервері.
