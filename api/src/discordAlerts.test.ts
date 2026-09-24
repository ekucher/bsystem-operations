import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendDiscordAlert } from './discordAlerts.js';

const WEBHOOK_URL = 'https://discord.test/webhook';

describe('sendDiscordAlert', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('sends a single POST with allowed_mentions suppressed (D9) on success', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await sendDiscordAlert(WEBHOOK_URL, 'hello @everyone');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { content: string; allowed_mentions: { parse: string[] } };
    expect(body.content).toBe('hello @everyone');
    expect(body.allowed_mentions).toEqual({ parse: [] });
  });

  it('aborts and rejects when the webhook does not respond within the timeout (D7)', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('This operation was aborted', 'AbortError'));
          });
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const pending = sendDiscordAlert(WEBHOOK_URL, 'slow webhook').catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).name).toBe('AbortError');
  });

  it('retries once after a 429 using the Retry-After header, then succeeds (D8)', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'rate limited', retry_after: 0.5 }), {
        status: 429,
        headers: { 'Retry-After': '2' },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = sendDiscordAlert(WEBHOOK_URL, 'rate limited alert');
    await vi.advanceTimersByTimeAsync(2_000);
    await pending;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after a single retry if the retry also fails', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '1' } }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = sendDiscordAlert(WEBHOOK_URL, 'still failing').catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await pending;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('500');
  });

  it('throws on a non-429, non-ok response without retrying', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendDiscordAlert(WEBHOOK_URL, 'boom')).rejects.toThrow('500');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
