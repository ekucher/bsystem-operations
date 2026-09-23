# BSYSTEM Operations

Operations — модуль моніторингу флоту серверів BRAVO-Toolkit (резервне
копіювання, обслуговування LIMS/VetOffice, статус ключових служб) у складі
платформи BSYSTEM. Замінює ручний аналіз повідомлень у Discord на
централізований dashboard з історією подій.

## Статус

Версія v1, **standalone**: працює як окремий застосунок за власною
адресою, без реєстрації в Module Registry BSYSTEM-HUB і без SSO через
authentik — обидва ще не розгорнуті в продакшн. Автентифікація v1 —
локальні облікові записи; міграція на authentik OIDC SSO та інтеграція з
HUB заплановані окремим етапом після їхнього виходу в прод.

## Структура репозиторію

```text
api/   — backend (Node.js + TypeScript), REST API прийому подій від
         агентів BRAVO-Toolkit, зберігання стану/історії, GET /health
ui/    — dashboard (React + TypeScript + Vite), overview- та
         detailed-режими перегляду стану серверів
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
`OPERATIONS_BOOTSTRAP_SECRET`/`ADMIN_API_KEY` в оточенні, інакше
використовує dev-заглушки — див. `docker-compose.yml`). Окремо `api/` —
`api/.env.example` → `.env`, потім `npm run dev --workspace=api`.

## API (Etap 1)

Контракт — `api/docs/openapi.yaml`. Потік self-enrollment:

1. Агент генерує GUID, викликає `POST /api/v1/enroll` з
   `bootstrapSecret` → сервер отримує статус `pending`.
2. Адміністратор підтверджує сервер:
   `POST /api/v1/admin/servers/{id}/approve` (`X-Admin-Key`).
3. Агент поллить `GET /api/v1/enroll/{id}` (`X-Bootstrap-Secret`) —
   API-ключ повертається **рівно один раз** одразу після approve
   (reveal-once).
4. Далі агент відправляє `POST /api/v1/events` і `POST /api/v1/heartbeat`
   з `X-Api-Key`.

`GET /api/v1/admin/servers` і `GET /api/v1/admin/servers/{id}` — дані для
майбутнього dashboard (Etap 3). Історія подій зберігається 90 днів
(`EVENT_RETENTION_DAYS`), старіші видаляються фоновою задачею.

Автентифікація адмін-маршрутів (`X-Admin-Key`) — інтерим-рішення v1;
Etap 3 замінює її локальними обліковими записами з RBAC-роллю.

## Пов'язані джерела

- Технічне завдання платформи BSYSTEM (Operations, §3.7) — визначає
  предметну область модуля.
- `bsystem-hub` — портал платформи, майбутня точка інтеграції (deep-link,
  Module Registry) після виходу в продакшн.
- BRAVO-Toolkit (`modules/BRAVO.Notifications`) — джерело подій
  (Archive/BazaSync, Maintenance, Health), які цей модуль приймає від
  агента на кожному сервері.
