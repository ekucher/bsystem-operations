import type { IconTier } from './icons';
import type { EventCategory, ServerStatus, Severity } from './types';

// Дашборд призначений для операторів — увесь текст, що потрапляє на
// екран (не лише статичні написи, а й значення enum-полів з бекенду),
// має бути українською.

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  backup: 'Резервне копіювання',
  maintenance: 'Обслуговування',
  health: 'Стан',
};

const ALL_CATEGORY_LABELS: Record<string, string> = {
  ...CATEGORY_LABELS,
  heartbeat: 'сигнал життя',
};

export function categoryLabel(category: string): string {
  return ALL_CATEGORY_LABELS[category] ?? category;
}

const SERVER_STATUS_LABELS: Record<ServerStatus, string> = {
  pending: 'очікує підтвердження',
  approved: 'підтверджено',
  revoked: 'відкликано',
};

export function serverStatusLabel(status: string): string {
  return SERVER_STATUS_LABELS[status as ServerStatus] ?? status;
}

const SEVERITY_LABELS: Record<Severity, string> = {
  SUCCESS: 'успішно',
  WARNING: 'попередження',
  ERROR: 'помилка',
  CRITICAL: 'критично',
};

export function severityLabel(severity: string | undefined): string {
  if (!severity) {
    return '—';
  }
  return SEVERITY_LABELS[severity as Severity] ?? severity;
}

const STAGE_STATUS_LABELS: Record<string, string> = {
  OK: 'ок',
  SKIPPED: 'пропущено',
  WARNING: 'попередження',
  WARN: 'попередження',
  ERROR: 'помилка',
  FAIL: 'помилка',
};

export function stageStatusLabel(status: string): string {
  return STAGE_STATUS_LABELS[status] ?? status;
}

export function onlineLabel(isOnline: boolean): string {
  return isOnline ? 'онлайн' : 'офлайн';
}

// Component-теги, які реальні агенти (BRAVO.Archive/Maintenance/Health)
// зараз надсилають у payload.component — довільний рядок з боку агента,
// тому невідомі значення показуємо як є, а не приховуємо.
const COMPONENT_LABELS: Record<string, string> = {
  Archive: 'Архів',
  Maintenance: 'Обслуговування',
  Health: 'Стан',
};

export function componentLabel(component: string): string {
  return COMPONENT_LABELS[component] ?? component;
}

// IconTier (success/warning/critical/skipped/pending — 5 форм іконок) і
// CSS-класи пігулок (success/warning/critical/neutral/offline — 5
// кольорових варіантів) навмисно різні набори: 'skipped' і 'pending'
// мають власну форму іконки, але обидва рендеряться нейтральним сірим
// пігулки. 'offline' — окремий колір без відповідної форми іконки
// (позначається через onlineTier/isOnline напряму, не через цю функцію).
export function pillClassForTier(tier: IconTier): string {
  switch (tier) {
    case 'success':
      return 'success';
    case 'warning':
      return 'warning';
    case 'critical':
      return 'critical';
    default:
      return 'neutral';
  }
}

// Іконка бейджа кодує той самий статус, що й колір/текст — оператор, що
// сканує багато рядків, розпізнає форму швидше за текст.
export function severityTier(severity: string | undefined): IconTier {
  switch (severity) {
    case 'SUCCESS':
      return 'success';
    case 'WARNING':
      return 'warning';
    case 'ERROR':
    case 'CRITICAL':
      return 'critical';
    default:
      return 'pending';
  }
}

export function stageTier(status: string): IconTier {
  switch (status) {
    case 'OK':
      return 'success';
    case 'WARNING':
    case 'WARN':
      return 'warning';
    case 'ERROR':
    case 'FAIL':
      return 'critical';
    case 'SKIPPED':
      return 'skipped';
    default:
      return 'pending';
  }
}

export function serverStatusTier(status: string): IconTier {
  switch (status) {
    case 'approved':
      return 'success';
    case 'revoked':
      return 'skipped';
    default:
      return 'pending';
  }
}

// "очікує підтвердження" (pending) навмисно жовта, а не нейтральна сіра
// (як інші 'pending'-тьєри) — це стан, що потребує дії адміністратора,
// тож має впадати в очі так само, як інші попередження.
export function serverStatusPillClass(status: string): string {
  const tier = serverStatusTier(status);
  return tier === 'pending' ? 'warning' : pillClassForTier(tier);
}

export function onlineTier(isOnline: boolean): IconTier {
  return isOnline ? 'success' : 'skipped';
}

// Розпізнані поля EventPayload.details (поза stages) — з відомим,
// людяним лейблом рендеряться як список "мітка: значення"; усе інше
// (майбутні поля агента, яких тут ще немає) лишається сирим JSON, щоб
// нічого не губилось мовчки.
const KNOWN_DETAIL_LABELS: Record<string, string> = {
  issueCount: 'Проблем',
  okCount: 'Успішно',
  warnCount: 'Попереджень',
  errorCount: 'Помилок',
  skippedCount: 'Пропущено',
  failCount: 'Провалено',
  durationMs: 'Тривалість',
  generationId: 'ID генерації',
  publishedComponentCount: 'Опубліковано компонентів',
  snapshotSetId: 'ID знімку',
  failedPath: 'Шлях помилки',
  isPrivilegeFailure: 'Помилка прав доступу',
};

export function detailLabel(key: string): string | null {
  return KNOWN_DETAIL_LABELS[key] ?? null;
}

export function formatDetailValue(key: string, value: unknown): string {
  if (key === 'durationMs' && typeof value === 'number') {
    return `${(value / 1000).toFixed(1)} с`;
  }
  if (typeof value === 'boolean') {
    return value ? 'так' : 'ні';
  }
  return String(value);
}
