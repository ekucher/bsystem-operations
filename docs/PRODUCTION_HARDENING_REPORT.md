# BSYSTEM Operations — Production Hardening Report

Дата: 2026-09-25 (Wave 2 доповнення; Wave 1 — 2026-09-24)
Lead Agent: Claude (Sonnet 5), сесія `session_01Srqagc1Fs9avhEAiTXABrj`
Wave 2 Agent G (фінальний, contract-audit + real cross-repo E2E): Claude (Sonnet 5)

Цей документ покриває **дві хвилі** роботи над тим самим репозиторієм:
- **Wave 1** (розділи позначені як історичні нижче) — початковий production-hardening
  прохід, змерджений через PR #2 (`fix/operations-production-hardening` → `main`).
- **Wave 2** (цей прохід) — hardening другого порядку: 6 паралельних агентів (A–F) +
  фінальний Lead-агент (G), що (1) закрили 12 нерозв'язаних GitHub review-тредів на вже
  змердженому PR #2 і 10 P0/P1 + 11 P2 блокерів з майстер-задачі, (2) провели
  contract-parity аудит OpenAPI, і (3) провели **реальний** (не-mock) наскрізний
  E2E-тест між цим репозиторієм і BRAVO-Toolkit-агентом — і саме цей реальний прогін
  знайшов справжній, 100%-відтворюваний баг (див. розділ 11 і 16), який жоден
  mocked-self-test не міг би виявити.

## 1. Executive Summary

**Wave 1** закрила початкові P0/P1/P2 знахідки production-readiness рев'ю: витік
credential-хешів у публічному API, слабкі production-дефолти в docker-compose,
відсутність rate-limiting/timing-safe auth, небезпечні DB-міграції (`CREATE TABLE IF
NOT EXISTS` замість versioning), відсутній durable outbox на боці BRAVO-агента,
reveal-once API-ключі без recovery-шляху. Змерджено через PR #2 на `main`.

**Wave 2** — другий hardening прохід поверх уже змердженого PR #2: 6 паралельних
агентів (A–F) закрили решту 10 P0/P1 + 11 P2 блокерів з майстер-задачі й усі 12
нерозв'язаних GitHub review-тредів (enrollment claim, тепер agent-generated замість
server-rotated; nginx Host-header проксі-фікс під non-default порти; атомарні
approve/revoke/reissue + audit-transactions; fail-closed DB-міграції; коректне
event-ordering за `occurred_at`; hardened Discord-алертинг; повний BRAVO-агент
rewrite під новий enrollment-протокол з durable outbox). Lead особисто перевірив
кожен diff і незалежно перепрогнав тести.

**Wave 2, Agent G (цей прохід)** зробив три речі, які ще залишались невиконаними:
(G1/G2) contract-parity аудит `api/docs/openapi.yaml` проти `api/src/routes/*.ts` —
розходжень **не знайдено** (спека вже була оновлена й покрита тестом раніше в межах
Wave 2, агентом A); (G3) реальний, без жодного HTTP-моку, наскрізний E2E-прогін
BRAVO-агента (Windows PowerShell 5.1, справжній `Invoke-WebRequest`, справжній
Windows Credential Manager) проти живого `docker compose`-стенду цього репозиторію —
і цей прогін **знайшов і виправив справжній, 100%-відтворюваний production-баг** у
BRAVO-агенті, який self-test (мокає HTTP) фізично не міг виявити (див. розділ 11).

## 2. Baseline та фінальні SHA

| Репозиторій | Гілка | Baseline SHA (до Wave 2) | Фінальний SHA |
|---|---|---|---|
| bsystem-operations | `main` | `627a370` (= голова після Wave 1 / PR #2) | `fix/operations-hardening-wave2` @ `ce99242` (запушено на `origin`) |
| BRAVO-Toolkit | `developer` | `3e9e172` | `feat/operations-protocol-v2` @ `baba701` (**лишається лише локально**, upstream не встановлено, не запушено — навмисно, рішення Lead'а) |

Wave 1 baseline (для довідки): `main@526bbdf` (bsystem-operations),
`developer@3e9e172a4b1fc1b41da8066b105ff46dadf66cb3` (BRAVO-Toolkit).

**Важливо:** гілка `feat/operations-protocol-v2` існує **лише локально** у worktree
`E:\GitHub\bravo-toolkit-worktrees\wave2-protocol`. Вона ніколи не була запушена на
жоден remote і не має upstream-гілки. Це не помилка звіту — так і задумано; рішення
про push/PR належить власнику repo, не агентам цієї сесії.

## 3. Агентські гілки/коміти, інтегровані у Wave 2 (bsystem-operations)

Усі змерджено у `fix/operations-hardening-wave2` (база: `main@627a370`).

| Агент | Область | Ключові коміти |
|---|---|---|
| A | Enrollment Protocol v2 | `f284efe` (agent-generated claim замість server-rotated, закриває P1 з рев'ю PR #2), `3104c60` (сортування latest-event-per-category за `occurred_at`), `51a0fdd` (тести на claim/takeover/503), `a07ac47` (D5: grace period для щойно approved серверів), `2999838` (оновлення `openapi.yaml`), merge `9a292c5` |
| B | Auth/Proxy/CSRF/RateLimit | `741cb55` (nginx `$http_host` замість `$host`), `98f26b2` (`asyncHandler` для async-роутів), `bcd2ce9` (грубіший per-IP login limiter), `ff98fdf` (eager dummy password hash), `ad5bac5` (create-admin paste-fix), merge `ec2f892`, `ce99242` (фінальний фікс тесту на порт-matching CSRF) |
| C | DB Migration Correctness | `f3ccf1c` (C1/C2: чистка legacy plaintext pending keys, fail-closed на новішій схемі), `42fe327` (C3: атомарні approve/revoke/reissue + audit у одній транзакції), `61dd0c8` (C5: реальний `/ready` через `SELECT ... LIMIT 1`), merge `8d970a7` |
| D | Event time/Monitoring/Discord | `84ef518` (D6: single-flight guard offline-monitor), `208200c` (D7/D8/D9: timeout+bounded 429 retry+`allowed_mentions` для Discord), `b4106ff` (D10: try/catch навколо scheduled cleanup), `7161011` (тестові фікстури), merge `52c8c65` |
| E | Docker/Config/Runtime/CI | `6099d65` (форвардинг `EVENT_RETENTION_DAYS`/`HEARTBEAT_*`/`SESSION_TTL_HOURS` у контейнер `api`), `238b1c3` (compose↔config env parity тест), `3b47b0e` (CI: `Origin`-заголовок на same-origin викликах), merge `533c428` |
| F | BRAVO Agent Integration v2 (окремий репозиторій, див. нижче) | — |

BRAVO-Toolkit (`feat/operations-protocol-v2`, окремий репозиторій):

| Коміт | Опис |
|---|---|
| `a896db7` | durable outbox, claim-gated enrollment client, E9/E10/E11 фікси |
| `21d4402` | self-test suite для outbox/enrollment (E12) |
| `3bc6148` | Agent F: повний rewrite enrollment під agent-generated claim протокол (A1–A7) |
| `baba701` | **Agent G (цей прохід)**: фікс двох реальних багів, знайдених живим E2E — див. розділ 11 |

Lead також самостійно: закрив cross-agent конфлікти тестових фікстур, провів живий
(не-mock) Docker Compose curl-based smoke-тест API-сторони (login/enroll/approve/
poll/claim-mismatch/cross-origin-CSRF) і вирішив усі 12 раніше нерозв'язаних
GitHub review-тредів на вже змердженому PR #2 через GraphQL.

## 4. P0/P1/P2 знахідки з пост-PR#2 рев'ю — статус

Усі **10 P0/P1 + 11 P2** блокерів з майстер-задачі та всі **12** нерозв'язаних
GitHub review-тредів на PR #2 — **вирішено** роботою агентів A–F і Lead'ом
(GraphQL-резолюція тредів + незалежна верифікація діффів). Ключові приклади (повний
перелік — в оригінальних review-тредах PR #2, тепер усі `resolved`):

- P1 (enrollment claim takeover): fleet-wide bootstrap secret + відомий serverId
  раніше давали змогу перехопити чужий claim → закрито agent-generated claim
  (Agent A, `f284efe`), сервер більше ніколи не генерує/не ротує claim сам.
- P1 (nginx Host header): `requireSameOrigin()` ламався на non-default портах через
  `$host` замість `$http_host` → закрито (Agent B, `741cb55`).
- P1 (non-atomic admin actions): approve/revoke/reissue могли залишити рядок
  сервера й audit-запис неузгодженими при збої посередині → загорнуто в одну
  `db.transaction()` (Agent C, `42fe327`).
- P1 (event ordering): пізно доставлена, але фактично старіша подія могла
  перезаписати `latestByCategory` новішої → сортування за
  `COALESCE(occurred_at, created_at) DESC, ...` (Agent A, `3104c60`).
- P2 (Discord webhook): без timeout/retry-обмеження, ризик застрягання
  offline-monitor'а → timeout + bounded 429 retry + `allowed_mentions:{parse:[]}`
  (Agent D, `208200c`).
- P2 (docker-compose env parity): 4 операторські змінні документувались, але не
  форвардились у контейнер → виправлено + доданий parity-тест, що не дає цьому
  розійтися знову (Agent E, `6099d65`, `238b1c3`).

## 5. Enrollment Protocol v2 — результат

`POST /enroll` і `GET /enroll/:serverId` тепер вимагають ОБИДВА заголовки
(`X-Bootstrap-Secret` І `X-Enrollment-Claim`) — AND, не OR (перевірено тестом,
див. розділ 12). Claim генерує сам агент (GUID), сервер його ніколи не видає й не
ротує. `upsertPendingServer` хешує claim і звіряє на повторних викликах: mismatch
проти вже pending рядка → `409 {error:'claim_mismatch'}`; вже
approved/revoked → `409 {error:'already_finalized', status}`. Enrollment вимкнено
(немає bootstrap secret) → `503 {error:'enrollment_not_configured'}`, перевіряється
РАНІШЕ за перевірку секрету. `202`-відповідь POST — лише `{status}`, без
`claimToken`. Повністю підтверджено реальним E2E (розділ 11): pending → approve →
poll-retrieval apiKey → revoke → 401 → стара ключ-пара дійсно відхиляється.

## 6. Auth/Proxy/CSRF/RateLimit — результат

`ui/nginx.conf` використовує `$http_host` — same-origin перевірка коректно working
на non-default портах (підтверджено реальним E2E: UI proxy на порту `18192`,
Origin-заголовок `http://localhost:18192`, approve/revoke пройшли). Грубіший
per-IP login limiter, `asyncHandler` для async-роутів, eager dummy password hash.

## 7. DB/Migration — результат

`approveServerWithAudit`/`revokeServerWithAudit`/`reissueApiKeyWithAudit` атомарні
(одна транзакція на стан + audit-запис). Крок міграції 8 чистить legacy
TTL-less plaintext pending API keys. `runMigrations()` fail-closed на
`user_version` новіший за відомий коду. `/ready` реально виконує
`SELECT id FROM servers LIMIT 1` (підтверджено реальним E2E: `curl
http://localhost:18191/ready` → `{"status":"ok",...}` проти живої БД контейнера).

## 8. Event ordering — результат

`listLatestEventPerCategory(ForAllServers)` сортує за `COALESCE(occurred_at,
created_at) DESC, created_at DESC, id DESC`. Підтверджено реальним E2E: подія,
надіслана під час симульованого outage (`occurred_at` зафіксовано в момент
виникнення, до outbox), доставлена ПІЗНІШЕ (після відновлення API) — сервер
зберіг оригінальний `occurred_at`, а не час фактичної доставки (розділ 11, крок 8).

## 9. Monitoring/Discord — результат

`isServerOnline` використовує `last_heartbeat_at ?? approved_at` — щойно approved
сервери отримують grace period до першого heartbeat (підтверджено реальним E2E:
одразу після approve `isOnline: true`, до першого heartbeat). `offlineMonitor.ts`
має re-entrancy guard. `discordAlerts.ts` — timeout + bounded 429 retry +
`allowed_mentions:{parse:[]}` (не покрито реальним E2E цієї сесії — webhook URL не
конфігурувався, тест лишається на рівні unit-тестів агента D).

## 10. BRAVO integration — результат

`BRAVO.Operations.psm1` (`Invoke-BRAVOOperationsEnrollment`) переписано під контракт
A1–A7: свій GUID claim (`Get-BRAVOOperationsEnrollmentClaim`, персистентний,
поруч із server-id state-файлом), `X-Enrollment-Claim` на POST і GET, обробка `409
claim_mismatch` (термінально) і `503 enrollment_not_configured` (INFO, не ERROR).
Durable local outbox для events/heartbeats (переживає рестарти, exponential
backoff, dead-letter для справжніх 4xx, ніколи не дублює доставку — retried
envelope несе той самий `eventId`, який `UNIQUE(server_id, event_id)` на API
дедуплікує).

**Але:** self-test (`BRAVO_SELF_TEST.ps1`, мокає HTTP-транспорт) показував
2253/2253 PASS і НЕ виявив реального бага в цьому самому коді — див. розділ 11.
Після фіксу Agent G self-test і далі 2253/2253 PASS, 0 FAIL (перепрогнано реально
на цій машині: `BRAVO SELF-TEST — УСПІШНО`, `SELF-TEST PASSED`,
"Кількість непокинутих фікстур: 0").

## 11. Cross-repo E2E — реальний прогін (Agent G, G3)

**Це НЕ mock.** Реальний `docker compose` стенд (проєкт `opswave2e2e`, окремі
порти `18191`/`18192`/`18493` — щоб не зачепити вже запущені
`bsystem-operations-{ui,api,tls}-1` контейнери користувача, перевірено `docker ps`
до і після; вони жодного разу не зупинялись і лишились healthy впродовж усього
прогону) + реальна Windows PowerShell 5.1-сесія, що імпортує справжній
`BRAVO.Operations.psm1` з `wave2-protocol` worktree і б'є по живому API через
справжній `Invoke-WebRequest`/HTTPS (TLS-термінація через nginx-сайдкар,
той самий self-signed localhost-сертифікат, що вже довірений у сертифікатному
сховищі цієї машини з попередньої тестової сесії) — НЕ через self-test'ів
mocked-`Invoke-WebRequest`-харнес.

### Сценарій і що фактично сталося

1. **Enroll**: `Invoke-BRAVOOperationsEnrollment` → `POST /enroll` → `202
   {status:"pending"}`. Підтверджено через `GET /admin/servers`:
   `"status":"pending"`.
2. **Admin approve**: реальний виклик `POST
   /admin/servers/{id}/approve` через UI-проксі (`http://localhost:18192`,
   Origin-заголовок, справжня admin-сесія, створена через `create-admin` CLI у
   контейнері) → `{"status":"approved"}`.
3. **Poll → apiKey** — **тут перший прогін ЗЛАМАВСЯ**: повторний виклик
   `Invoke-BRAVOOperationsEnrollment` повернув `$null` замість apiKey, з логом
   `"Сервер уже фіналізований в Operations (status=невідомо)... POST /enroll
   відхилено (409 already_finalized)"`. Це і є справжній production-баг,
   знайдений виключно тому, що G3 забороняє mock HTTP — див. розділ 16 для
   повного опису причини і фіксу.
4. Після фіксу (Agent G, commit `baba701` у BRAVO-репо) — **той самий сценарій,
   повторений заново з нуля** (свіжий serverId, свіжий claim):
   - `POST /enroll` → pending.
   - admin approve → approved.
   - `Invoke-BRAVOOperationsEnrollment` → apiKey **успішно отримано й збережено**
     у Windows Credential Manager (перевірено: збережене значення == повернуте
     функцією значення).
5. **Heartbeat + event для реального**: `Send-BRAVOOperationsHeartbeat` +
   `Send-BRAVOOperationsEvent` (category=backup, severity=SUCCESS) → перевірено
   через `GET /admin/servers/{id}`: `last_heartbeat_at` оновлено, `isOnline:true`,
   подія в `latestByCategory.backup` і в `events[]` з окремими `occurred_at` і
   `created_at`.
6. **Симуляція outage**: `docker stop opswave2e2e-api-1`, потім
   `Send-BRAVOOperationsEvent` (category=health, severity=ERROR) →
   **never-throw підтверджено** (функція повернула контроль без винятку), подія
   лягла файлом у реальний on-disk `Outbox`-каталог з коректним `OccurredAtUtc` і
   `NextRetryAtUtc` (exponential backoff), `LastError: "The remote server returned
   an error: (502) Bad Gateway."`.
7. **Відновлення**: `docker start opswave2e2e-api-1`. Наступний виклик
   `Send-BRAVOOperationsHeartbeat` (після настання `NextRetryAtUtc`) викликав
   `Invoke-BRAVOOperationsOutboxDrain` → outbox-файл видалено, подія доставлена.
   На сервері: `occurred_at` = оригінальний момент outage (`21:10:17.86Z`), а НЕ
   момент фактичної доставки (`created_at` = `21:11:15.64Z`) — доказ, що
   E7/E4-семантика (`occurredAt` зберігається з моменту виникнення, не відправки)
   реально працює під час durable-outbox-циклу, а не лише в unit-тестах.
8. **Ідемпотентний replay**: той самий `eventId`, надісланий вручну ще раз
   (симуляція retry вже доставленого outbox-елемента) → `202 accepted`, але в
   БД лишилось рівно 2 рядки подій (жодного дубля) — `UNIQUE(server_id,
   event_id)` підтверджено на живих даних.
9. **Revoke**: реальний `POST /admin/servers/{id}/revoke` → `{"status":"revoked"}`.
   Подія зі старим (уже недійсним) apiKey напряму на API → реальний **401** від
   живого сервера.
10. **HttpUnauthorizedClearsStoredApiKey проти реального сервера**:
    `Send-BRAVOOperationsEvent` зі старим ключем → модуль розпізнав 401,
    очистив збережений ключ у Credential Manager (перевірено: `Get-
    BRAVOCredentialSecret` після цього повертає порожнє значення), функція
    не кинула виняток.

Усі кроки 1–10 виконано **двічі**: перший раз до фіксу (крок 3 провалився
реально, не гіпотетично), другий раз — з нуля, з новою серверною ідентичністю,
після фіксу (усі кроки пройшли).

**Не покрито цим E2E** (чесно, без прикрашання): Discord-алертинг (webhook не
налаштований), реальний Windows Server 2012-стенд (лише ця Windows 11 машина),
UI (браузерна частина) — E2E бив напряму по API/UI-nginx-проксі через curl/
PowerShell, не через реальний браузер.

## 12. OpenAPI parity — результат (G1/G2)

`api/docs/openapi.yaml` прочитано end-to-end проти `api/src/routes/enroll.ts` та
решти роутів. **Розходжень не знайдено** — специфікація вже була оновлена агентом
A у межах Wave 2 (коміт `2999838`, до старту роботи Agent G) і вже покрита
цільовим parity-тестом `api/src/openapiEnrollParity.test.ts` (7 тестів, усі
проходять — перевірено повторно цим агентом):

- `POST /enroll` і `GET /enroll/{serverId}` документують `security:
  [{bootstrapSecret: [], enrollmentClaim: []}]` — один запис з обома ключами
  (AND), не два окремі записи (що означало б OR). Перевірено тестом.
- Response-схеми включають `202`/`400`/`401`/`404`/`409`/`503`; `409` документує
  ОБИДВА варіанти (`already_finalized` і `claim_mismatch`) текстом опису;
  `503 enrollment_not_configured` — окремо задокументовано.
- `202`-відповідь POST **не** декларує поле `claimToken` — підтверджено (описано
  прямим текстом: "Claim більше НЕ повертається в тілі відповіді").
- `/events` документує `occurredAt` і `createdAt`(неявно, через опис `payload`/
  `created_at` у admin-роутах) як окремі поля з різною семантикою.
- Admin approve/revoke/reissue схеми відповідають фактичним `approveServerWithAudit`/
  `revokeServerWithAudit`/`reissueApiKeyWithAudit` (перевірено вручну проти
  `api/src/repository.ts` і `api/src/routes/admin.ts`).

Змін до `openapi.yaml` чи до `openapiEnrollParity.test.ts` **не вносилось** —
існуючий контракт і тест уже достатні для покриття, зазначеного в задачі G1/G2.

## 13. CI — результат

`.github/workflows/ci.yml` містить 5 jobs (`api`, `ui`, `openapi-lint`,
`supply-chain`, `docker-e2e`), усі з `timeout-minutes`/`permissions: contents:
read`. **CI НЕ перезапускався на GitHub для жодної Wave 2-гілки** — жодного PR
ще не відкрито (ні для `fix/operations-hardening-wave2`, ні для
`feat/operations-protocol-v2`). Усе, зазначене як "перевірено", виконано
**локально** цією сесією (vitest напряму, живий `docker compose`, живий
PowerShell 5.1) — жодного разу **не** GitHub Actions runner. Не стверджується
"CI зелений" — це б суперечило дійсності.

## 14. Тести, реально виконані

- bsystem-operations API: **139 тестів / 17 файлів** — перепрогнано цією сесією
  (`vitest run` напряму, Node на хості), усі PASS.
- bsystem-operations UI: **8 тестів / 1 файл** — перепрогнано, усі PASS.
- BRAVO-Toolkit: повний `BRAVO_SELF_TEST.ps1` — **2253/2253 PASS, 0 FAIL**,
  перепрогнано реально на цій Windows-машині ПІСЛЯ фіксу Agent G (`baba701`),
  включно з `RUNTIME_MANIFEST.json`, оновленим через
  `ci/Update-BRAVORuntimeManifest.ps1 -Apply` (integrity-gate вимагає це для
  будь-якої зміни `.psm1`).
- **Новий реальний cross-repo E2E** (Agent G, розділ 11) — виконано двічі
  (до і після фіксу), живий Docker Compose + жива Windows PowerShell 5.1-сесія,
  жодного HTTP-мока.
- `openapiEnrollParity.test.ts` — перепрогнано окремо, 7/7 PASS.

## 15. Тести, НЕ виконані / прогалини

- Жоден реальний GitHub Actions прогін для Wave 2-гілок (жодного PR не відкрито).
- Discord-алертинг не покрито реальним webhook-викликом у цьому E2E (лише
  unit-тестами агента D раніше).
- Реальний браузер (UI) не задіяний у G3 E2E — лише curl/PowerShell проти
  API/nginx-проксі напряму.
- Windows Server 2012-специфічна поведінка BRAVO-агента — лише статично й через
  self-test на цій Windows 11 машині, як і в Wave 1.
- Fleet-масштаб (декілька одночасних агентів/серверів) не тестувався — лише один
  сервер за раз у G3 E2E.

## 16. Залишкові blockers / найважливіша знахідка цієї хвилі

**Головна знахідка Wave 2 (Agent G, G3):** до фіксу `baba701`,
`Invoke-BRAVOOperationsEnrollment` **гарантовано** (не рідкісна гонитва, а
детермінований, 100%-відтворюваний шлях коду) ламала весь протокол enrollment у
реальній експлуатації:

1. Функція завжди намагається `POST /enroll` ПЕРЕД `GET /enroll/{serverId}` —
   на кожному виклику, без винятку.
2. Щойно адміністратор підтверджує (`approve`) pending-сервер, рядок сервера стає
   `approved`. Наступний-БУДЬ-ЯКИЙ виклик `Invoke-BRAVOOperationsEnrollment` для
   цього агента (доки локальний apiKey ще не збережено) спершу виконує той самий
   безумовний `POST /enroll` — і отримує `409 already_finalized` (бо сервер уже
   фіналізований), тому що що умова "чи вже маємо ключ" перевіряється лише в
   самому верху функції, а на цей момент ключа ще нема.
3. Стара реалізація трактувала `409 already_finalized` як термінальний **у
   БУДЬ-ЯКОМУ** випадку (i зокрема для `status=approved`) і повертала `$null`,
   **ніколи не доходячи** до `GET`-опитування, яке єдине повертає `apiKey`.
4. Наслідок: **жоден агент ніколи не міг отримати свій API-ключ після
   admin-approve** через звичайний періодичний виклик — прогалина в самому
   ядрі протоколу, яку self-test (2253 моканих перевірок) не виявив, бо
   мокований `Invoke-WebRequest` у self-test'і ніколи фактично не бив по
   реальному HTTP-стеку .NET/Windows PowerShell 5.1.

Другий, пов'язаний баг: `Get-BRAVOOperationsHttpErrorBody` читала тіло 409/etc
через `response.GetResponseStream().ReadToEnd()` — але справжній Windows
PowerShell 5.1 (перевірено емпірично на цій машині) вже сам вичитує цей стрім
до кінця, щоб заповнити `$ErrorRecord.ErrorDetails.Message`, тож повторне
читання завжди повертало порожній рядок. Це означало, що навіть якби гілка
above (approved vs revoked) була написана правильно з самого початку, вона все
одно ніколи не змогла б розрізнити `claim_mismatch` від `already_finalized`,
чи `approved` від `revoked`, проти реального сервера — увесь branching по тілу
помилки був мертвим кодом у production, живим лише проти self-test'ового мока.

**Обидва фікси зроблено, перевірено (self-test 2253/2253 PASS + повторний
реальний E2E проходить end-to-end), закомічено (`baba701`) на
`feat/operations-protocol-v2`, НЕ запушено.** Це найважливіший доказ, чому
правило "не mock HTTP у G3-гейті" з майстер-задачі мало сенс: 2253 mocked
перевірки пройшли, а перший же реальний HTTP-виклик проти живого сервера
зламав основний happy-path протоколу.

Інших нових P0/P1/P2 не знайдено цим проходом.

## 17. Pilot readiness (один сервер)

**READY**, з двома явними умовами:
- [x] Enrollment v2 повністю working end-to-end проти реального API (після фіксу
  `baba701`) — перевірено реальним E2E, не лише unit-тестами.
- [x] Durable outbox / idempotent delivery / revoke-lifecycle — усе перевірено
  реальним E2E.
- [x] 139/139 API + 8/8 UI + 2253/2253 BRAVO self-test — усе зелене локально.
- [ ] **Умова 1**: `feat/operations-protocol-v2` (з фіксом `baba701`) має бути
  реально розгорнута на пілотному агенті — БЕЗ цього фіксу пілот гарантовано
  зламається на першому ж admin-approve.
- [ ] **Умова 2**: жоден з двох PR ще не відкрито/не змерджено — пілот не має
  стартувати з незмерджених, нерев'юваних гілок без explicit sign-off власника.

## 18. Fleet readiness (масштаб на весь флот)

**НЕ ГОТОВО**, явно, з тих самих причин, що й Wave 1, плюс нове:
- [ ] PR для `feat/operations-protocol-v2` → `developer` ще не відкрито, тим
  паче не змерджено з protected-branch CI зеленим — це жорсткий гейт з
  майстер-задачі, і він **не виконаний**.
- [ ] Жоден реальний GitHub Actions прогін для жодної з двох Wave 2-гілок.
- [ ] Fleet-масштаб (>1 сервера одночасно) не випробувано.
- [x] Технічні передумови (durable outbox, ідемпотентність, revoke lifecycle,
  audit trail) — усі готові й перевірені на рівні одного агента.

## 19. Точні наступні дії

1. Власник відкриває PR `fix/operations-hardening-wave2` → `main`
   (bsystem-operations); гілка вже запушена на `origin`.
2. Власник відкриває PR `feat/operations-protocol-v2` → `developer`
   (BRAVO-Toolkit) — **спершу треба запушити цю локальну гілку** (з комітом
   `baba701`), що є рішенням власника, не агента.
3. Обидва PR — на рев'ю власником, **без auto-merge**.
4. Реальний прогін GitHub Actions на обох відкритих PR — перша фактична
   перевірка нових/існуючих CI jobs у справжньому середовищі раннера.
5. Після мержу BRAVO PR у `developer` з protected-branch CI зеленим — можна
   розглядати fleet-масштабування (розділ 18).
6. Розглянути покриття Discord-алертингу реальним webhook у майбутньому E2E.

## 20. Rules compliance checklist

- [x] Жодного `git push --force` — не використовувалось.
- [x] Жодних секретів не закомічено — бутстрап-секрет E2E був тестовим значенням
  у тимчасовому `.env`-файлі в scratchpad-каталозі, ніколи не в репозиторії.
- [x] Жодного тесту не вимкнено/не пропущено заради зеленого статусу.
- [x] Жодного послаблення безпекових дефолтів у продакшн-конфігурації.
- [x] G3 E2E — **реальний HTTP**, жодного мока (`Invoke-WebRequest` не
  підмінявся; self-test'овий mocked-харнес свідомо НЕ використовувався для
  цього гейту).
- [x] `feat/operations-protocol-v2` явно й неодноразово названо
  **локальною, не запушеною** гілкою — ніде не стверджується, що вона існує
  на remote.
- [x] CI **не** стверджується "зеленим" — явно зазначено, що жоден реальний
  GitHub Actions прогін для Wave 2 не відбувався.
- [x] Жоден раніше залишений review-коментар не проігноровано мовчки — усі 12
  тредів PR #2 вирішено Lead'ом через GraphQL (Wave 2, до старту роботи цього
  агента), задокументовано в розділі 3/4.
- [x] BRAVO-гілку не змержено (і тим паче не auto-змержено) у `developer` —
  лишається окремим локальним комітом на розгляд власника.
- [x] Гілку BRAVO не запушено і upstream не встановлено — рішення власника.
- [x] Реальний, знайдений через E2E, production-баг **не прихований і не
  применшений** — розділ 11/16 описують його прямо, з повним поясненням
  причини й фіксу.
- [x] Docker-контейнери користувача (`bsystem-operations-{ui,api,tls}-1`)
  жодного разу не зупинялись цією сесією; тестовий стенд `opswave2e2e-*`
  повністю розібрано (`docker compose -p opswave2e2e down -v`), підтверджено
  `docker ps -a` — лише контейнери користувача лишились у списку.

## 21. Sign-off

Wave 2 Agent G (contract audit + real cross-repo E2E) підтверджує:
- OpenAPI-специфікація вже узгоджена з кодом (жодних змін не знадобилось).
- Реальний, не-mocked, наскрізний E2E-сценарій між bsystem-operations і
  BRAVO-Toolkit агентом пройдено end-to-end, включно з durable-outbox
  outage/recovery циклом, ідемпотентною доставкою та повним
  approve→event→revoke→401 lifecycle.
- Цей самий реальний прогін знайшов і виправив production-critical баг у
  BRAVO-агенті (`baba701`), який self-test не міг виявити — саме тому
  майстер-задача вимагала реального HTTP у цьому гейті.
- Обидва репозиторії лишені у стані: bsystem-operations — чистий git status
  (без нових незакомічених змін цієї сесії, окрім цього звіту); BRAVO-Toolkit —
  один новий комітований фікс (`baba701`) на `feat/operations-protocol-v2`,
  не запушений.
- Жодних нових P0/P1 не залишилось невирішеними в межах scope цієї сесії, крім
  явно позначених "next actions" (розділ 19), що вимагають рішення власника
  (відкриття PR, push BRAVO-гілки).

Рекомендація: **готово до рев'ю власником і відкриття обох PR**; пілот на
одному сервері може стартувати після цього рев'ю, за умови розгортання агента
саме з коміту `baba701` (не `3bc6148`, який гарантовано зламається на першому
ж admin-approve).
