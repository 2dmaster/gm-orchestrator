import type { NotificationPayload, NotificationPort, WebhookConfig } from './types.js';

export class WebhookNotifier implements NotificationPort {
  private readonly url: string;
  private readonly headers: Record<string, string>;

  constructor(config: WebhookConfig) {
    this.url = config.url;
    this.headers = {
      'Content-Type': 'application/json',
      ...config.headers,
    };
  }

  async send(payload: NotificationPayload): Promise<void> {
    const attempt = async (): Promise<void> => {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Webhook error ${res.status}: ${body}`);
      }
    };

    try {
      await attempt();
    } catch {
      // Retry once on failure
      await attempt();
    }
  }

  async test(): Promise<void> {
    await this.send({
      event: 'test',
      title: 'gm-orchestrator connected',
      body: 'Webhook notifications are working.',
    });
  }
}
