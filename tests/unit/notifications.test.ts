import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createNotifier } from '../../src/infra/notifications/index.js';
import { TelegramNotifier } from '../../src/infra/notifications/telegram.js';
import { WebhookNotifier } from '../../src/infra/notifications/webhook.js';
import { DesktopNotifier } from '../../src/infra/notifications/desktop.js';
import type { NotificationPayload, NotificationConfig } from '../../src/infra/notifications/types.js';
import type { Logger } from '../../src/infra/logger.js';

// ── Helpers ──────────────────────────────────────────────────────────────

const mockLogger: Logger = {
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  skip: vi.fn(),
  section: vi.fn(),
  task: vi.fn(),
  taskResult: vi.fn(),
};

const samplePayload: NotificationPayload = {
  event: 'task_done',
  title: 'Task complete',
  body: 'fix-auth-bug is done',
  data: { taskId: 'fix-auth-bug' },
};

// ── Telegram ─────────────────────────────────────────────────────────────

describe('TelegramNotifier', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends formatted message to Telegram API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 }),
    );

    const notifier = new TelegramNotifier({
      enabled: true,
      botToken: 'test-token',
      chatId: '12345',
    });

    await notifier.send(samplePayload);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://api.telegram.org/bottest-token/sendMessage');
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.chat_id).toBe('12345');
    expect(body.parse_mode).toBe('Markdown');
    expect(body.text).toContain('✅');
    expect(body.text).toContain('Task complete');
  });

  it('throws on API error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Unauthorized', { status: 401 }),
    );

    const notifier = new TelegramNotifier({
      enabled: true,
      botToken: 'bad-token',
      chatId: '12345',
    });

    await expect(notifier.send(samplePayload)).rejects.toThrow('Telegram API error 401');
  });

  it('uses correct emoji per event type', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 }),
    );

    const notifier = new TelegramNotifier({
      enabled: true,
      botToken: 'tok',
      chatId: '1',
    });

    await notifier.send({ ...samplePayload, event: 'error' });
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.text).toContain('🚨');
  });
});

// ── Webhook ──────────────────────────────────────────────────────────────

describe('WebhookNotifier', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('posts JSON payload to configured URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 }),
    );

    const notifier = new WebhookNotifier({
      enabled: true,
      url: 'https://hooks.example.com/notify',
      headers: { Authorization: 'Bearer secret' },
    });

    await notifier.send(samplePayload);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://hooks.example.com/notify');
    const headers = (opts as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer secret');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.event).toBe('task_done');
  });

  it('retries once on failure then throws', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => Promise.resolve(new Response('Server Error', { status: 500 })),
    );

    const notifier = new WebhookNotifier({
      enabled: true,
      url: 'https://hooks.example.com/notify',
    });

    await expect(notifier.send(samplePayload)).rejects.toThrow('Webhook error 500');
    expect(fetchSpy).toHaveBeenCalledTimes(2); // original + 1 retry
  });

  it('test() sends a test event', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 }),
    );

    const notifier = new WebhookNotifier({
      enabled: true,
      url: 'https://hooks.example.com/notify',
    });

    await notifier.test();

    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.event).toBe('test');
  });
});

// ── Desktop ──────────────────────────────────────────────────────────────

describe('DesktopNotifier', () => {
  it('calls node-notifier with title and message', async () => {
    const mockNotify = vi.fn();
    vi.doMock('node-notifier', () => ({
      default: { notify: mockNotify },
    }));

    // Re-import to pick up the mock
    const { DesktopNotifier: MockedDesktop } = await import(
      '../../src/infra/notifications/desktop.js'
    );

    const notifier = new MockedDesktop();
    await notifier.send(samplePayload);

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Task complete',
        message: 'fix-auth-bug is done',
      }),
    );

    vi.doUnmock('node-notifier');
  });
});

// ── Dispatcher ───────────────────────────────────────────────────────────

describe('createNotifier (dispatcher)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(mockLogger.warn).mockClear();
    vi.mocked(mockLogger.success).mockClear();
  });

  it('dispatches to all enabled channels in parallel', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 }),
    );

    const config: NotificationConfig = {
      telegram: { enabled: true, botToken: 'tok', chatId: '1' },
      webhook: { enabled: true, url: 'https://hooks.example.com/notify' },
    };

    const dispatcher = createNotifier(config, mockLogger);
    await dispatcher.dispatch(samplePayload);

    // Both telegram and webhook should have been called
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('logs failures without throwing', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    const config: NotificationConfig = {
      telegram: { enabled: true, botToken: 'tok', chatId: '1' },
    };

    const dispatcher = createNotifier(config, mockLogger);
    // Should NOT throw
    await dispatcher.dispatch(samplePayload);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('telegram'),
    );
  });

  it('skips disabled channels', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 }),
    );

    const config: NotificationConfig = {
      telegram: { enabled: false, botToken: 'tok', chatId: '1' },
      webhook: { enabled: true, url: 'https://hooks.example.com/notify' },
    };

    const dispatcher = createNotifier(config, mockLogger);
    await dispatcher.dispatch(samplePayload);

    expect(fetchSpy).toHaveBeenCalledOnce(); // only webhook
  });

  it('does nothing when no channels are enabled', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 }),
    );

    const dispatcher = createNotifier({}, mockLogger);
    await dispatcher.dispatch(samplePayload);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
