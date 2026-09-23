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

Локальний запуск обох частин разом — `docker-compose.yml` (потребує
`OPERATIONS_BOOTSTRAP_SECRET` в оточенні, інакше використовує
dev-заглушку — див. `docker-compose.yml`). Окремо `api/` —
`api/.env.example` → `.env`, потім `npm run dev --workspace=api`. Перший
обліковий запис створюється окремо через `npm run create-admin`
(див. розділ "Автентифікація" нижче) — БД не має дефолтних облікових
записів.

## API

Контракт — `api/docs/openapi.yaml`. Потік self-enrollment (Etap 1):

1. Агент генерує GUID, викликає `POST /api/v1/enroll` з
   `bootstrapSecret` → сервер отримує статус `pending`.
2. Адміністратор підтверджує сервер у dashboard (approve-кнопка на
   overview) або напряму `POST /api/v1/admin/servers/{id}/approve`
   (сесія з роллю `admin`).
3. Агент поллить `GET /api/v1/enroll/{id}` (`X-Bootstrap-Secret`) —
   API-ключ повертається **рівно один раз** одразу після approve
   (reveal-once).
4. Далі агент відправляє `POST /api/v1/events` і `POST /api/v1/heartbeat`
   з `X-Api-Key`.

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

## Пов'язані джерела

- Технічне завдання платформи BSYSTEM (Operations, §3.7) — визначає
  предметну область модуля.
- `bsystem-hub` — портал платформи, майбутня точка інтеграції (deep-link,
  Module Registry) після виходу в продакшн.
- BRAVO-Toolkit (`modules/BRAVO.Notifications`) — джерело подій
  (Archive/BazaSync, Maintenance, Health), які цей модуль приймає від
  агента на кожному сервері.
