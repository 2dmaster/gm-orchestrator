// ─── Notification Types ──────────────────────────────────────────────────

export type NotificationEvent =
  | 'task_done'
  | 'task_failed'
  | 'sprint_complete'
  | 'epic_complete'
  | 'error'
  | 'test';

export interface NotificationPayload {
  event: NotificationEvent;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface NotificationPort {
  send(payload: NotificationPayload): Promise<void>;
  test(): Promise<void>;
}

// ─── Config ──────────────────────────────────────────────────────────────

export interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  chatId: string;
}

export interface WebhookConfig {
  enabled: boolean;
  url: string;
  headers?: Record<string, string>;
}

export interface DesktopConfig {
  enabled: boolean;
}

export interface NotificationConfig {
  telegram?: TelegramConfig;
  webhook?: WebhookConfig;
  desktop?: DesktopConfig;
}
