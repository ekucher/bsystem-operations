# Репозиторна governance (F12)

Статус: гілкова протекція на `main` уже застосована через `gh api`
(перевірено — обліковий запис мав `ADMIN`-доступ до репозиторію,
`gh repo view --json viewerPermission` → `"ADMIN"`). Цей документ фіксує
ЩО саме застосовано і як це відтворити/змінити вручну, а також відкриті
рішення власника.

## Що застосовано (branch protection на `main`)

Команда, яка фактично виконана:

```bash
gh api -X PUT repos/ekucher/bsystem-operations/branches/main/protection \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["api", "ui", "openapi-lint", "supply-chain", "docker-e2e"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
```

Результат:

- `main` вимагає відкритий PR перед merge (прямий push, включно з боку
  адміністратора — `enforce_admins: true`, заблоковано).
- Перед merge мають пройти всі 5 job'ів `.github/workflows/ci.yml`:
  `api`, `ui`, `openapi-lint`, `supply-chain`, `docker-e2e`
  (`required_status_checks.strict: true` — гілка також має бути
  up-to-date з `main` перед merge).
- Force-push і видалення `main` заблоковано
  (`allow_force_pushes: false`, `allow_deletions: false`).
- `required_approving_review_count: 0` — свідомо, а не проґавлено:
  репозиторій має єдиного власника (`git log --format='%an <%ae>' | sort -u`
  → один автор), і GitHub не дозволяє автору схвалити власний PR, тож
  `required_approving_review_count: 1` заблокувало б власника від
  будь-якого merge без залучення другого учасника, якого не існує. PR
  усе одно обов'язковий (документує зміну, ганяє CI) — просто не вимагає
  approve від когось, кого немає.

### Як змінити/перевірити пізніше

```bash
# Перевірити поточний стан:
gh api repos/ekucher/bsystem-operations/branches/main/protection

# Підняти вимогу до 1 approve, коли з'явиться другий maintainer:
gh api -X PATCH repos/ekucher/bsystem-operations/branches/main/protection/required_pull_request_reviews \
  -f required_approving_review_count=1

# Додати codeowner-review вимогу (після появи реальної команди в CODEOWNERS):
gh api -X PATCH repos/ekucher/bsystem-operations/branches/main/protection/required_pull_request_reviews \
  -F require_code_owner_reviews=true
```

Якщо в майбутньому `gh`-токен власника втратить `ADMIN`-права на
репозиторій (наприклад, при передачі репозиторію в організацію) —
еквівалентні дії вручну через GitHub UI: **Settings → Branches → Branch
protection rules → Add rule** для `main`, увімкнути "Require a pull
request before merging", "Require status checks to pass before merging"
(вибрати `api`/`ui`/`openapi-lint`/`supply-chain`/`docker-e2e`), "Do not
allow bypassing the above settings", і зняти "Allow force pushes"/"Allow
deletions" (за замовчуванням і так вимкнено для нового правила).

## SECURITY.md і CODEOWNERS

Обидва додані цим самим комітом:

- `SECURITY.md` — як повідомити про вразливість, без вигаданого
  enterprise SLA (проєкт pilot-стадії, один власник).
- `.github/CODEOWNERS` — `* @ekucher`, обґрунтовано тим самим `git log`
  аналізом вище.

## Відкрите рішення власника: LICENSE

**Файл `LICENSE` у репозиторії відсутній.** Це явно зафіксовано тут як
decision point, а не мовчки проігноровано і не вигадано (жодного
ліцензійного тексту цим завданням не додано):

- Якщо репозиторій має лишатись приватним внутрішнім інструментом
  BSYSTEM — відсутність LICENSE узгоджена (за замовчуванням "all rights
  reserved", що для внутрішнього коду й так природний стан).
- Якщо планується публікація коду (навіть у межах організації, як
  read-only приклад) — власнику варто явно обрати ліцензію (напр. MIT,
  Apache-2.0, або внутрішню proprietary-ліцензію BSYSTEM, якщо така
  існує) і додати `LICENSE` у корінь репозиторію.
- `redocly.yaml` (F8) явно вимикає правило `info-license` в
  `api/docs/openapi.yaml` з посиланням саме на цей нерозв'язаний пункт —
  коли LICENSE буде обрано, варто також заповнити `info.license` в
  OpenAPI-специфікації і прибрати це вимкнення правила.

## Секрети репозиторію (не входить в обсяг цього документа)

`docker-e2e` (F6) і `supply-chain` (F9, gitleaks) job'и в CI не
потребують жодних GitHub Secrets, доданих вручну — `docker-e2e`
генерує одноразовий bootstrap-секрет прямо в job'і (`openssl rand -hex
32`), а `gitleaks/gitleaks-action` використовує вбудований
`GITHUB_TOKEN`. Жодних додаткових Settings → Secrets кроків не потрібно
для того, що додано цим завданням.
