# BSYSTEM Operations

Operations — модуль моніторингу флоту серверів BRAVO-Toolkit (резервне
копіювання, обслуговування LIMS/VetOffice, статус ключових служб) у складі
платформи BSYSTEM. Замінює ручний аналіз повідомлень у Discord на
централізований dashboard з історією подій.

## Статус

Версія v1, **standalone**: працює як окремий застосунок за власною
адресою, без реєстрації в Module Registry BSYSTEM-HUB і без SSO через
authentik — обидва ще не розгорнуті в продакшн. Автентифікація v1 —
локальні облікові записи (Etap 3); міграція на authentik OIDC SSO та
інтеграція з HUB заплановані окремим етапом після їхнього виходу в прод.
Офлайн-алертинг (Etap 4) сповіщає в наявний Discord alerts-канал —
окремої нової інфраструктури сповіщень не додано.

## Структура репозиторію

```text
api/   — backend (Node.js + TypeScript), REST API прийому подій від
         агентів BRAVO-Toolkit, зберігання стану/історії, GET /health
ui/    — dashboard (React + TypeScript + Vite): login, overview
         (лічильники + сортовний/фільтрований список ~50 серверів,
         periodic polling, approve pending-серверів) і detail
         (поточний стан backup/maintenance/health, статус 3 служб,
         історія подій)
```

Монорепозиторій навмисно поєднує backend і frontend цього модуля
(окреме архітектурне рішення — один життєвий цикл на ранній стадії).

## Розробка

```bash
npm install
npm run typecheck
npm run build
npm test
```

Локальний запуск обох частин разом (наприклад, у Docker Desktop) —
`docker-compose.yml`: скопіюйте кореневий `.env.example` → `.env` й
задайте реальний `OPERATIONS_BOOTSTRAP_SECRET` — без нього `docker
compose up` одразу відмовиться стартувати (`variable is not set`,
навмисно: базовий compose-файл більше не має слабкого дефолту на цю
змінну). `COOKIE_SECURE` базовий `docker-compose.yml` не підставляє
взагалі — лишається production-безпечний дефолт `api/src/config.ts`
(`true`). Для локальної розробки по http без TLS скопіюйте
`docker-compose.override.yml.example` → `docker-compose.override.yml`
(лишається local-only, у `.gitignore`, docker compose підхоплює його
автоматично) — там `COOKIE_SECURE=false` і закоментований прямий
host-порт для API.

`docker compose up --build -d` піднімає `ui` на `:8082` — це єдина
опублікована на хост адреса за замовчуванням: nginx (`ui`) проксіює
`/api/*` до `api`-сервіса напряму по внутрішній Docker-мережі
(`api:8080`), тож API в базовому `docker-compose.yml` не публікує порт
на хост. Прямий доступ до API з хоста (curl/Postman, в обхід nginx) —
через закоментовану секцію `ports` у
`docker-compose.override.yml.example`. Перший обліковий запис у щойно
піднятому контейнері створюється скомпільованим CLI (не `npm run`, якого
немає в production-образі): `docker compose exec api node
dist/cli/create-admin.js --username <ім'я> --password <пароль> --role admin`.

Окремо `api/` без Docker — `api/.env.example` → `.env`, потім
`npm run dev --workspace=api`. Перший обліковий запис створюється окремо
через `npm run create-admin --workspace=api`
(див. розділ "Автентифікація" нижче) — БД не має дефолтних облікових
записів.

## API

`GET /health` — liveness (контракт Module Registry, ТЗ §27): не звертається
до БД, відповідає `200`, поки живий сам процес; містить `revision`
(git SHA збірки з `GIT_SHA`, `"unknown"` якщо не задано білдом). `GET
/ready` — readiness: реально виконує запит до SQLite, повертає `503`,
якщо БД недоступна; саме цей маршрут використовує `HEALTHCHECK` в
`api/Dockerfile`, а не `/health`.

Контракт — `api/docs/openapi.yaml`. Потік self-enrollment (Etap 1):

1. Агент генерує GUID, викликає `POST /api/v1/enroll` з
   `X-Bootstrap-Secret` (заголовок — єдиний канонічний транспорт для
   обох `/enroll`-маршрутів) → сервер отримує статус `pending`, а
   відповідь містить одноразово видане `claimToken` (агент має його
   зберегти — саме воно потім прив'язує поллінг до ЦЬОГО enrollment).
2. Адміністратор підтверджує сервер у dashboard (approve-кнопка на
   overview) або напряму `POST /api/v1/admin/servers/{id}/approve`
   (сесія з роллю `admin`).
3. Агент поллить `GET /api/v1/enroll/{id}` з ОБОМА заголовками —
   `X-Bootstrap-Secret` і `X-Enrollment-Claim` (значення claimToken).
   API-ключ доступний протягом обмеженого TTL-вікна (5 хв) після
   approve/reissue — не reveal-once: той самий claim може повторно
   прочитати ключ у межах вікна, якщо перша відповідь загубилась.
4. Далі агент відправляє `POST /api/v1/events` і `POST /api/v1/heartbeat`
   з `X-Api-Key`.
5. Адміністратор може `POST /api/v1/admin/servers/{id}/revoke` (пending
   або approved → revoked, ключ одразу перестає працювати) або
   `POST /api/v1/admin/servers/{id}/reissue` (нова пара ключа; controlled
   un-revoke, якщо сервер був revoked) — обидва лише для ролі `admin`,
   пишуть аудит-рядок в `admin_actions`.

`GET /api/v1/admin/servers` і `GET /api/v1/admin/servers/{id}` (Etap 3) —
збагачені дані для dashboard: `isOnline` (розраховується з
`last_heartbeat_at` + `HEARTBEAT_EXPECTED_INTERVAL_MINUTES` ×
`HEARTBEAT_MISSED_THRESHOLD`) і `latestByCategory` (останній
backup/maintenance/health-запис на сервер). Історія подій зберігається
90 днів (`EVENT_RETENTION_DAYS`), старіші видаляються фоновою задачею.

## Автентифікація (Etap 3)

Адмін-маршрути (`/api/v1/admin/*`, `/api/v1/auth/me`,
`/api/v1/auth/logout`) вимагають сесії локального облікового запису —
`httpOnly`-cookie `ops_session`, видається `POST /api/v1/auth/login`.
Роль (`admin` | `viewer`) — окреме поле від джерела автентифікації, щоб
пізніше мігрувати на authentik OIDC без переписування RBAC-перевірок;
`viewer` бачить overview/detail, `admin` додатково може підтверджувати
pending-сервери.

Self-registration відсутня навмисно. Перший (і будь-який наступний)
обліковий запис створюється CLI:

```bash
npm run create-admin --workspace=api -- --username <ім'я> --password <пароль> [--role admin|viewer]
```

Пароль зберігається як `scrypt`-хеш (`node:crypto`, без зовнішніх
залежностей). Сесія живе `SESSION_TTL_HOURS` (дефолт 24) і завжди
`Secure`-cookie, якщо явно не вимкнено `COOKIE_SECURE=false` (лише для
локальної розробки по http).

## Офлайн-алертинг (Etap 4)

Фонова перевірка (`OFFLINE_CHECK_INTERVAL_MINUTES`, дефолт 5 хв) обчислює
`isOnline` для кожного `approved`-сервера тим самим правилом, що й
overview/detail (`HEARTBEAT_EXPECTED_INTERVAL_MINUTES` ×
`HEARTBEAT_MISSED_THRESHOLD`), і надсилає повідомлення в наявний Discord
alerts-канал через `DISCORD_ALERTS_WEBHOOK_URL` при переході сервера
офлайн і при відновленні. Поле `servers.offline_alerted_at` — дедуп-мітка
поточного офлайн-епізоду: без неї кожен тик перевірки повторно алертив
би вже відомий офлайн-сервер. Мітка встановлюється/скидається лише після
успішної відправки в Discord — невдала відправка не змінює стан, і
наступний тик повторить спробу. Незаданий `DISCORD_ALERTS_WEBHOOK_URL` =
алертинг вимкнено (fail-safe no-op, той самий підхід, що й
`OPERATIONS_BOOTSTRAP_SECRET`), не помилка запуску. `pending`-сервери
(ще не підтверджені) ніколи не алертяться.

## Пілотний ролаут (Etap 5)

План — `docs/ETAP5_PILOT_ROLLOUT_PLAN.md`: розгортання Operations API
на production-хості, пілот на 1 сервері найнижчого ризику, контрольована
перевірка heartbeat/events/офлайн-алертингу, критерії успіху перед
розширенням на решту флоту.

## Пов'язані джерела

- Технічне завдання платформи BSYSTEM (Operations, §3.7) — визначає
  предметну область модуля.
- `bsystem-hub` — портал платформи, майбутня точка інтеграції (deep-link,
  Module Registry) після виходу в продакшн.
- BRAVO-Toolkit (`modules/BRAVO.Notifications`) — джерело подій
  (Archive/BazaSync, Maintenance, Health), які цей модуль приймає від
  агента на кожному сервері.
