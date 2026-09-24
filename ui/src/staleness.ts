export interface HeartbeatConfig {
  expectedMinutes: number;
  missedThreshold: number;
}

export type StaleLevel = 'ok' | 'warn' | 'critical';

// "Офлайн" (isOnline=false) вже означає, що минуло понад
// expectedMinutes*missedThreshold відколи сервер востаннє відповів — та
// сама умова, що бекенд використовує для isOnline. WARN тут завжди про
// вже прострочені сервери; CRITICAL підвищує це до помітно довшого
// мовчання (4x того ж вікна), щоб відрізнити щойно пропущений цикл від
// справжнього тривалого збою.
export function computeStaleLevel(
  lastHeartbeatAt: string | null,
  isOnline: boolean,
  config: HeartbeatConfig | null,
): StaleLevel {
  if (isOnline || !lastHeartbeatAt || !config) {
    return 'ok';
  }
  const missedWindowMinutes = config.expectedMinutes * config.missedThreshold;
  if (missedWindowMinutes <= 0) {
    return 'ok';
  }
  const minutesSince = (Date.now() - new Date(lastHeartbeatAt).getTime()) / 60_000;
  return minutesSince > missedWindowMinutes * 4 ? 'critical' : 'warn';
}
