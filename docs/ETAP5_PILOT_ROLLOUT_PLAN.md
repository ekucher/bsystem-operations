# Etap 5 — план пілотного ролауту і real-server acceptance

Статус: **PLANNED**, виконання не розпочато. Цей документ — план і
чек-лист, не звіт про виконані дії.

## Мета

Підтвердити на одному реальному продакшн-сервері BRAVO-Toolkit, що
повний ланцюжок Operations (enrollment → heartbeat → events →
dashboard → офлайн-алертинг) працює коректно в реальному оточенні, перш
ніж розширювати ролаут на решту флоту (~50 серверів). Мінімізувати
ризик — 1 сервер найнижчого ризику, повна спостережуваність, чіткий
rollback.

## Ухвалені рішення (для цього плану)

- Хостинг Operations API: власний Windows/Linux сервер, self-hosted,
  `docker-compose.yml` з репозиторію.
- Масштаб пілоту: 1 сервер, найнижчого ризику (не production-критичний,
  не з найбільшим інституційним навантаженням).
- Гілка BRAVO-Toolkit `feature/bsystem-operations-foundation`
  мержиться в `developer` через PR **до** початку пілоту — пілотний
  сервер отримує агента зі стандартного гілкового потоку, а не з
  feature-гілки напряму.

## Відкриті рішення (потребують власника перед стартом)

Ці пункти не можна вивести з коду репозиторію — потрібне явне рішення
власника перед виконанням відповідного кроку:

1. **Конкретний хост для Operations API** — яка саме машина/сервер,
   внутрішня адреса чи DNS-ім'я.
2. **TLS/reverse-proxy** — `COOKIE_SECURE` за замовчуванням вимагає
   HTTPS; потрібен або reverse-proxy (nginx/Caddy) з сертифікатом, або
   явний `COOKIE_SECURE=false` **лише** якщо трафік лишається у
   довіреній внутрішній мережі (не рекомендовано для production).
3. **Який саме сервер — пілот** — конкретний hostname/institution_code
   найнижчого ризику визначає власник.
4. **`OPERATIONS_BOOTSTRAP_SECRET`, `DISCORD_ALERTS_WEBHOOK_URL`** —
   реальні значення для production-оточення (не dev-заглушки).
5. **Резервне копіювання БД Operations API** (`operations.sqlite3`) —
   чи входить в існуючий BRAVO backup-периметр, чи потрібен окремий
   механізм.

Виконання Etap 5 без цих рішень неможливе — кроки нижче позначають, де
саме кожне з них потрібне.

## Кроки

### 1. Підготовка коду (без mutation-дій без дозволу)

- [ ] Відкрити PR `feature/bsystem-operations-foundation` → `developer`
      у BRAVO-Toolkit, дочекатись зеленого CI.
- [ ] Merge PR **лише за явним дозволом власника** (`.claude/rules/02-git.md`).
- [ ] Підтвердити `bsystem-operations` `main` у стані з Etap 0-4
      (поточний HEAD `0714491`, CI зелений) — вже виконано.

### 2. Розгортання Operations API (production)

- [ ] Обрати/підготувати хост (відкрите рішення №1).
- [ ] Налаштувати reverse-proxy + TLS, або свідомо задокументувати
      рішення про внутрішню мережу (відкрите рішення №2).
- [ ] Скопіювати `api/.env.example` → `.env` на хості, заповнити
      реальними значеннями: `OPERATIONS_BOOTSTRAP_SECRET`,
      `DISCORD_ALERTS_WEBHOOK_URL`, `COOKIE_SECURE` (true за замовчуванням),
      `SESSION_TTL_HOURS`, `HEARTBEAT_EXPECTED_INTERVAL_MINUTES`,
      `OFFLINE_CHECK_INTERVAL_MINUTES`.
- [ ] `docker-compose up -d` (api + ui), перевірити `GET /health`.
- [ ] Створити перший обліковий запис:
      `npm run create-admin --workspace=api -- --username <ім'я> --password <пароль> --role admin`.
- [ ] Увійти в UI, підтвердити login/logout працюють з реальним
      TLS-сертифікатом (cookie `Secure` не блокує сесію).
- [ ] Задокументувати механізм backup БД (відкрите рішення №5) —
      мінімум ручний бекап `operations.sqlite3` перед пілотом.

### 3. Вибір і підготовка пілотного сервера

- [ ] Власник визначає конкретний сервер (відкрите рішення №3):
      критерії — не критичний для операційної діяльності установи,
      представляє product type (LIMS або VetOffice — обидва варти
      окремого пілоту, якщо можливо послідовно), стабільна мережа до
      хосту Operations API.
- [ ] Підтвердити на сервері: `developer`-версія BRAVO-Toolkit з
      промерженим Etap 2 (`BRAVO.Operations`), `operationsReportingSettings`
      присутній у конфіг-шарі.
- [ ] Увімкнути `operationsReportingSettings.Enabled=$true` (opt-in,
      вимкнено за замовчуванням) в `BRAVO.local.config` цього сервера.
- [ ] Заповнити `operationsReportingSettings.ProductType`,
      `OperationsApiUrl`, `OperationsBootstrapSecret` (значення з кроку 2).

### 4. Enrollment пілотного сервера

- [ ] Запустити enrollment (агент генерує GUID, `POST /enroll`) —
      сервер з'являється в dashboard зі статусом `pending`.
- [ ] Адміністратор підтверджує (`Approve` в UI або
      `POST /admin/servers/{id}/approve`).
- [ ] Підтвердити reveal-once API-ключ отримано агентом і збережено
      (наступний polling `GET /enroll/{id}` більше не повертає ключ).
- [ ] Перевірити статус сервера в dashboard → `approved`.

### 5. Heartbeat і events — реальний потік

- [ ] Реєстрація `BRAVO_OPERATIONS_HEARTBEAT.ps1` як заплановане
      завдання на пілотному сервері — **вручну** (Task Scheduler
      реєстрація для heartbeat визнана окремою задачею поза Etap 2,
      див. [[bravo-bsystem-operations-fleet-monitoring]]).
- [ ] Підтвердити heartbeat приходить, `isOnline=true` в overview.
- [ ] Дочекатись/спровокувати реальну подію Archive/Maintenance/Health
      (наступний штатний backup-цикл або ручний запуск) — підтвердити
      подія з'явилась у `latestByCategory` та історії подій на
      ServerDetailPage.
- [ ] Порівняти вміст події з відповідним Discord-повідомленням (якщо
      Discord-канал і Operations лишаються паралельними джерелами на
      час пілоту) — підтвердити відсутність розбіжностей.

### 6. Офлайн-алертинг — контрольований тест

- [ ] Свідомо зупинити heartbeat-задачу на пілотному сервері
      (Task Scheduler disable), дочекатись `HEARTBEAT_EXPECTED_INTERVAL_MINUTES × HEARTBEAT_MISSED_THRESHOLD` +
      один цикл `OFFLINE_CHECK_INTERVAL_MINUTES`.
- [ ] Підтвердити alert прийшов у Discord alerts-канал, `isOnline=false`
      в dashboard, `offline_alerted_at` заповнено (перевірка через
      dashboard/логи API, не пряме читання БД на проді без потреби).
- [ ] Увімкнути heartbeat-задачу назад, підтвердити recovery-alert і
      скидання `offline_alerted_at`.

### 7. Критерії успіху пілоту

Пілот вважається успішним, якщо протягом узгодженого періоду
спостереження (рекомендація: **7 днів** безперервної роботи):

- жодної втраченої/дубльованої події;
- heartbeat стабільний без хибних офлайн-спрацювань;
- офлайн-алертинг і recovery-алертинг підтверджені контрольованим
  тестом (крок 6) і, за наявності, реальним інцидентом;
- dashboard коректно відображає стан без ручного втручання;
- жодного P0/P1-дефекту, знайденого під час пілоту, не лишилось
  невирішеним.

### 8. Rollback-план

Якщо пілот виявляє блокуючу проблему:

- `operationsReportingSettings.Enabled=$false` на пілотному сервері —
  агент одразу припиняє звітування, Discord/існуюча сповіщувальна
  логіка не зачеплена (Operations — адитивний шар, не заміна).
- Дані пілотного сервера в Operations API лишаються для діагностики
  (не видаляються автоматично).
- Rollback не вимагає відкату коду BRAVO-Toolkit чи Operations API —
  лише конфігураційне вимкнення на стороні агента.

### 9. Наступний крок після успішного пілоту

Розширення на решту флоту (~50 серверів) — **окрема задача поза Etap 5**,
вимагає окремого плану хвиль ролауту (батчами, не всі 50 одночасно) і
окремого рішення власника про темп. Не починати без успішного
завершення критеріїв кроку 7.

## Обмеження цього плану

- Кроки 2-6 вимагають доступу до реальної інфраструктури (хост
  Operations API, продакшн-сервер BRAVO-Toolkit), якого асистент не
  має — виконання цих кроків вимагає участі власника або віддаленого
  доступу, наданого явно.
- CI/локальна валідація (Etap 0-4) підтверджує коректність коду, але
  **не замінює** real-server acceptance для поведінки, залежної від
  Windows Task Scheduler, реальної мережі, TLS і реального BAZA/backup
  циклу — узгоджено з `.claude/rules/04-testing-validation.md` /
  `.claude/rules/07-bravo-runtime-invariants.md` політикою BRAVO-Toolkit.
