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

Монорепозиторій навмисно poєднує backend і frontend цього модуля
(окреме архітектурне рішення — один життєвий цикл на ранній стадії).

## Розробка

```bash
npm install
npm run typecheck
npm run build
```

Локальний запуск кожної частини — див. `api/README.md` і `ui/README.md`
(за наявності) або `docker-compose.yml` для запуску обох разом.

## Пов'язані джерела

- Технічне завдання платформи BSYSTEM (Operations, §3.7) — визначає
  предметну область модуля.
- `bsystem-hub` — портал платформи, майбутня точка інтеграції (deep-link,
  Module Registry) після виходу в продакшн.
- BRAVO-Toolkit (`modules/BRAVO.Notifications`) — джерело подій
  (Archive/BazaSync, Maintenance, Health), які цей модуль приймає від
  агента на кожному сервері.
