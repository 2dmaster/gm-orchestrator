import type { Logger } from '../logger.js';
import type { NotificationConfig, NotificationPayload, NotificationPort } from './types.js';
import { TelegramNotifier } from './telegram.js';
import { WebhookNotifier } from './webhook.js';
import { DesktopNotifier } from './desktop.js';

export type { NotificationConfig, NotificationPayload, NotificationPort } from './types.js';

export interface NotificationDispatcher {
  dispatch(payload: NotificationPayload): Promise<void>;
  testAll(): Promise<void>;
}

export function createNotifier(
  config: NotificationConfig,
  logger: Logger,
): NotificationDispatcher {
  const channels: Array<{ name: string; port: NotificationPort }> = [];

  if (config.telegram?.enabled) {
    channels.push({ name: 'telegram', port: new TelegramNotifier(config.telegram) });
  }
  if (config.webhook?.enabled) {
    channels.push({ name: 'webhook', port: new WebhookNotifier(config.webhook) });
  }
  if (config.desktop?.enabled) {
    channels.push({ name: 'desktop', port: new DesktopNotifier() });
  }

  return {
    async dispatch(payload: NotificationPayload): Promise<void> {
      if (channels.length === 0) return;

      const results = await Promise.allSettled(
        channels.map(({ port }) => port.send(payload)),
      );

      results.forEach((result, i) => {
        if (result.status === 'rejected') {
          const ch = channels[i]!;
          logger.warn(`Notification [${ch.name}] failed: ${result.reason}`);
        }
      });
    },

    async testAll(): Promise<void> {
      for (const { name, port } of channels) {
        try {
          await port.test();
          logger.success(`Notification [${name}] test OK`);
        } catch (err) {
          logger.warn(`Notification [${name}] test failed: ${err}`);
        }
      }
    },
  };
}
