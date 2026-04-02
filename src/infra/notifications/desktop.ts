import type { NotificationPayload, NotificationPort } from './types.js';

export class DesktopNotifier implements NotificationPort {
  async send(payload: NotificationPayload): Promise<void> {
    const notifier = await import('node-notifier');
    notifier.default.notify({
      title: payload.title,
      message: payload.body,
      sound: true,
    });
  }

  async test(): Promise<void> {
    await this.send({
      event: 'test',
      title: 'gm-orchestrator connected',
      body: 'Desktop notifications are working.',
    });
  }
}
