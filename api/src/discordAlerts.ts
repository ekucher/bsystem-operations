// Etap 4 (grilling: offline-детекція -> наявний Discord alerts-канал,
// не нова інфраструктура сповіщень). Node 22 (CI/Dockerfile target) has
// a native global fetch — no http-client dependency needed for a single
// POST.

// D7 (Wave 2 hardening): bound how long a single webhook call can hang.
// 10s is generous for a plain POST to Discord under normal conditions but
// short enough that a hung/black-holed webhook host cannot stall an
// offline-check tick indefinitely — especially now that runOfflineCheck
// can be sending several of these in a row for a large fleet (see D6's
// single-flight guard, which exists precisely because this call can now
// take a while).
const REQUEST_TIMEOUT_MS = 10_000;

// D8: Discord's rate-limit response caps how long we're willing to honor
// a single retry-after wait for. This is a best-effort secondary
// notification channel, not a guaranteed-delivery system — if Discord
// asks for a genuinely long backoff, giving up and logging is preferable
// to blocking the offline-check tick for that long.
const MAX_RATE_LIMIT_WAIT_MS = 10_000;
const DEFAULT_RATE_LIMIT_WAIT_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postAlert(webhookUrl: string, content: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // D9: an alert message embeds server hostname/institution strings
      // (see offlineMonitor.ts's formatOfflineMessage/formatRecoveryMessage)
      // that this codebase doesn't fully control the shape of. Suppressing
      // all mention parsing means a hostname or payload string that
      // happens to look like `@everyone`/a role mention can never actually
      // ping anyone in the alerts channel.
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

// D8: Discord documents two ways a 429 communicates its cooldown for a
// webhook POST — the `Retry-After` response header (seconds) and, when
// the response body is JSON, a `retry_after` field (seconds, sometimes
// fractional) in that body. The header is authoritative and cheap to
// read; the body is only consulted as a fallback since reading it
// consumes the response stream.
async function readRetryAfterMs(res: Response): Promise<number> {
  const header = res.headers.get('retry-after');
  if (header !== null) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }
  }
  try {
    const body = (await res.json()) as { retry_after?: number };
    if (typeof body.retry_after === 'number' && Number.isFinite(body.retry_after) && body.retry_after >= 0) {
      return body.retry_after * 1000;
    }
  } catch {
    // No JSON body, or it didn't parse — fall through to the default.
  }
  return DEFAULT_RATE_LIMIT_WAIT_MS;
}

export async function sendDiscordAlert(webhookUrl: string, content: string): Promise<void> {
  const res = await postAlert(webhookUrl, content);
  if (res.status === 429) {
    // D8: a SINGLE bounded retry, not a retry loop — if Discord rate
    // limits us twice in a row for the same alert, give up and let the
    // caller's existing failure handling (offlineMonitor.ts: log and
    // leave the dedup marker untouched so the next tick retries) take
    // over, rather than this function looping on its own.
    const waitMs = Math.min(await readRetryAfterMs(res), MAX_RATE_LIMIT_WAIT_MS);
    await sleep(waitMs);
    const retryRes = await postAlert(webhookUrl, content);
    if (!retryRes.ok) {
      throw new Error(`Discord webhook responded ${retryRes.status} after rate-limit retry`);
    }
    return;
  }
  if (!res.ok) {
    throw new Error(`Discord webhook responded ${res.status}`);
  }
}
