import type { NotificationPayload, NotificationPort, TelegramConfig } from './types.js';

const EVENT_EMOJI: Record<string, string> = {
  task_done: '✅',
  task_failed: '❌',
  sprint_complete: '🏁',
  epic_complete: '🎯',
  error: '🚨',
  test: '🔔',
};

export class TelegramNotifier implements NotificationPort {
  private readonly apiUrl: string;
  private readonly chatId: string;

  constructor(config: TelegramConfig) {
    this.apiUrl = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
    this.chatId = config.chatId;
  }

  async send(payload: NotificationPayload): Promise<void> {
    const emoji = EVENT_EMOJI[payload.event] ?? '📋';
    const text = `${emoji} *${payload.title}*\n\n${payload.body}`;

    const res = await fetch(this.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: this.chatId,
        text,
        parse_mode: 'Markdown',
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Telegram API error ${res.status}: ${body}`);
    }
  }

  async test(): Promise<void> {
    await this.send({
      event: 'test',
      title: 'gm-orchestrator connected',
      body: '🔔 Telegram notifications are working.',
    });
  }
}
