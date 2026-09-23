// Etap 4 (grilling: offline-детекція -> наявний Discord alerts-канал,
// не нова інфраструктура сповіщень). Node 22 (CI/Dockerfile target) has
// a native global fetch — no http-client dependency needed for a single
// POST.
export async function sendDiscordAlert(webhookUrl: string, content: string): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    throw new Error(`Discord webhook responded ${res.status}`);
  }
}
