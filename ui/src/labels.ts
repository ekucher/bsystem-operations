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
