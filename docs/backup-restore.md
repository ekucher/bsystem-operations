# Backup / restore для operations.sqlite3

## Чому не `cp`/`copy` файлу

`operations.sqlite3` працює в режимі WAL (`journal_mode = WAL`, див.
`api/src/db.ts`). У WAL-режимі частина недавно записаних даних лежить у
файлі `operations.sqlite3-wal`, а не в основному файлі бази. Простий
файловий copy (`cp operations.sqlite3 backup.sqlite3` /
`Copy-Item operations.sqlite3 backup.sqlite3`) під час активних записів
може:

- скопіювати основний файл і `-wal` файл у різні моменти часу одне
  відносно одного, тобто отримати несумісний знімок;
- пропустити дані, які в момент копіювання ще лежать лише в `-wal` і не
  були перенесені (checkpoint) в основний файл;
- у гіршому випадку дати файл, який не проходить
  `PRAGMA integrity_check`.

Це стосується будь-якого copy, зробленого поки процес API живий і може
писати в базу — тобто практично завжди в production.

## Канонічний спосіб бекапу: SQLite Online Backup API

Скрипт `api/src/cli/backup.ts` використовує `db.backup()` з
`better-sqlite3` — це обгортка над SQLite Online Backup API. Він створює
консистентний знімок бази, коректно координуючись із будь-якими
паралельними writer'ами (WAL checkpoint він враховує сам), навіть якщо
API-процес в цей момент активно пише в базу.

### Використання

```bash
npm run backup --workspace=api -- --out /path/to/backups/operations-2026-09-24T120000Z.sqlite3
```

Скрипт читає шлях до live-бази з тієї ж змінної оточення, що й сам API
(`DB_PATH`, див. `api/src/config.ts`), відкриває її (це також прожене
міграції — нешкідливо, якщо схема вже актуальна) і записує консистентний
знімок за вказаним `--out` шляхом.

Рекомендований шаблон імені файлу: `operations-<ISO8601-timestamp>.sqlite3`
(як у прикладі вище) — сортується лексикографічно за часом, легко
знайти найновіший.

### Cron-приклад (Linux host)

```cron
# щодня о 02:15
15 2 * * * cd /opt/bsystem-operations && DB_PATH=/opt/bsystem-operations/data/operations.sqlite3 \
  npm run backup --workspace=api -- --out /opt/backups/operations-$(date -u +\%Y-\%m-\%dT\%H\%M\%SZ).sqlite3
```

Після локального бекапу — скопіювати off-host (масштаб системи: десятки
серверів, окрема інфраструктура для цього не виправдана):

```bash
rclone copy /opt/backups remote:bsystem-operations-backups --max-age 25h
# або: scp /opt/backups/operations-*.sqlite3 backup-host:/srv/backups/bsystem-operations/
```

## Restore

Оскільки backup-файл — це вже повноцінна, консистентна SQLite база (не
дамп SQL), restore — це:

1. Зупинити API-процес (щоб він не тримав відкритим старий `DB_PATH` і
   не переписав його після restore).
2. Замінити (або підкласти під новим шляхом і оновити `DB_PATH`) робочий
   файл файлом бекапу:
   ```bash
   cp /opt/backups/operations-2026-09-24T021500Z.sqlite3 /opt/bsystem-operations/data/operations.sqlite3
   rm -f /opt/bsystem-operations/data/operations.sqlite3-wal /opt/bsystem-operations/data/operations.sqlite3-shm
   ```
   (видалення `-wal`/`-shm` файлів старої бази обов'язкове — інакше
   SQLite спробує застосувати WAL-записи, що відносяться до вже
   замінених даних).
3. Опційно перевірити перед стартом API:
   ```bash
   sqlite3 /opt/bsystem-operations/data/operations.sqlite3 "PRAGMA integrity_check;"
   ```
4. Запустити API. `openDb()` прожене міграції автоматично — якщо бекап
   старіший за поточний код, база доміграється до актуальної версії
   так само, як і для будь-якої іншої бази старого формату (див.
   `api/src/migrations.ts`).

Автоматизований тест цього повного циклу (backup → зіпсувати/замінити
live-копію → restore → `integrity_check` → перечитати дані через
`OperationsRepository`) — `api/src/db.backup-restore.test.ts`.

## RPO / RTO / retention

Масштаб системи — десятки серверів, невелика (мегабайти — низькі
десятки мегабайт) SQLite-база. Це не виправдовує окрему backup-
інфраструктуру; cron + `.backup()` + off-host copy достатньо.

- **RPO (Recovery Point Objective):** дорівнює інтервалу між бекапами.
  При щоденному cron (02:15) — до 24 годин втрачених даних у гіршому
  випадку (інцидент стався за хвилину до наступного запланованого
  бекапу). Якщо для операційних подій (backup/maintenance/health
  агентів) прийнятний менший RPO — зменшити інтервал cron (наприклад,
  раз на 4 години); вартість — лінійна за розміром бази, яка тут мала.
- **RTO (Recovery Time Objective):** для бази такого класу (десятки
  серверів, місяці історії подій з 90-денним retention — реально
  одиниці-низькі десятки МБ) restore — це copy файлу (секунди) +
  рестарт процесу API (секунди). Реалістичний RTO: **кілька хвилин**,
  переважно операторський час (зупинити/запустити сервіс, знайти
  потрібний backup-файл), а не час самої операції копіювання.
- **Retention:** зберігати щоденні бекапи **30 днів**, після чого
  ротація (видалення старіших). Приклад ротації поруч із cron-job:
  ```bash
  find /opt/backups -name 'operations-*.sqlite3' -mtime +30 -delete
  ```
  За потреби довшого горизонту — зберігати додатково 1
  бекап/тиждень за останні 6 місяців; для поточного масштабу системи
  це поки не обов'язково.
- **Off-host copy:** бекап, що лежить лише на тому ж хості, що й
  live-база, не захищає від відмови диска/хоста цілком. Обов'язково
  копіювати кожен бекап (або хоча б найновіший щоденний) на окремий
  хост/сховище (`rclone`/`scp`, як у прикладі вище) одразу після
  створення.
