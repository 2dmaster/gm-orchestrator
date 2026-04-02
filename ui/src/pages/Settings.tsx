import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import PermissionToggle from "../components/PermissionToggle";

// ─── Types ──────────────────────────────────────────────────────────────

interface Permissions {
  readFiles: boolean;
  writeFiles: boolean;
  runTests: boolean;
  gitCommit: boolean;
  gitPush: boolean;
  npmPublish: boolean;
  customCommands: string;
}

interface Notifications {
  telegramBotToken: string;
  telegramChatId: string;
  webhookUrl: string;
  webhookHeaders: string;
  desktopNotifications: boolean;
}

interface SettingsState {
  // Connection
  baseUrl: string;
  projectId: string;
  apiKey: string;
  // Execution
  timeoutMinutes: number;
  maxRetries: number;
  pollInterval: number;
  // Permissions
  permissions: Permissions;
  // Notifications
  notifications: Notifications;
}

const DEFAULT_STATE: SettingsState = {
  baseUrl: "",
  projectId: "",
  apiKey: "",
  timeoutMinutes: 30,
  maxRetries: 2,
  pollInterval: 3,
  permissions: {
    readFiles: true,
    writeFiles: true,
    runTests: true,
    gitCommit: true,
    gitPush: false,
    npmPublish: false,
    customCommands: "",
  },
  notifications: {
    telegramBotToken: "",
    telegramChatId: "",
    webhookUrl: "",
    webhookHeaders: "",
    desktopNotifications: false,
  },
};

// ─── Section Header ─────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <h2 className="text-lg font-mono text-accent border-b border-gray-700 pb-2 mb-4">
      {title}
    </h2>
  );
}

// ─── Toast ──────────────────────────────────────────────────────────────

function Toast({
  message,
  type,
  onDismiss,
}: {
  message: string;
  type: "success" | "error";
  onDismiss: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div
      className={`fixed top-4 right-4 z-50 px-4 py-3 rounded font-mono text-sm border transition-opacity ${
        type === "success"
          ? "bg-green-500/10 border-green-500/30 text-green-400"
          : "bg-red-500/10 border-red-500/30 text-red-400"
      }`}
    >
      <div className="flex items-center gap-3">
        <span>{message}</span>
        <button
          onClick={onDismiss}
          className="text-current opacity-60 hover:opacity-100"
        >
          x
        </button>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

function isValidUrl(str: string): boolean {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

// ─── Main Settings ──────────────────────────────────────────────────────

export default function Settings() {
  const navigate = useNavigate();
  const [state, setState] = useState<SettingsState>(DEFAULT_STATE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<
    "idle" | "testing" | "success" | "error"
  >("idle");
  const [testingNotification, setTestingNotification] = useState<string | null>(
    null
  );
  const [showApiKey, setShowApiKey] = useState(false);

  // Load current config on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/config");
        if (res.ok) {
          const data = await res.json();
          setState({
            baseUrl: data.baseUrl ?? "",
            projectId: data.projectId ?? "",
            apiKey: data.apiKey ?? "",
            timeoutMinutes: Math.round((data.timeoutMs ?? 1800000) / 60000),
            maxRetries: data.maxRetries ?? 2,
            pollInterval: Math.round((data.pauseMs ?? 3000) / 1000),
            permissions: {
              readFiles: true,
              writeFiles: data.permissions?.writeFiles ?? true,
              runTests: data.permissions?.runTests ?? true,
              gitCommit: data.permissions?.gitCommit ?? true,
              gitPush: data.permissions?.gitPush ?? false,
              npmPublish: data.permissions?.npmPublish ?? false,
              customCommands: data.permissions?.customCommands ?? "",
            },
            notifications: {
              telegramBotToken: data.notifications?.telegramBotToken ?? "",
              telegramChatId: data.notifications?.telegramChatId ?? "",
              webhookUrl: data.notifications?.webhookUrl ?? "",
              webhookHeaders: data.notifications?.webhookHeaders ?? "",
              desktopNotifications:
                data.notifications?.desktopNotifications ?? false,
            },
          });
        }
      } catch {
        // Failed to load config — use defaults
      }
      setLoading(false);
    })();
  }, []);

  const showToast = useCallback(
    (message: string, type: "success" | "error") => {
      setToast({ message, type });
    },
    []
  );

  // ─── Connection test ────────────────────────────────────────────────

  const handleTestConnection = useCallback(async () => {
    if (!state.baseUrl) {
      showToast("GraphMemory URL is required", "error");
      return;
    }
    if (!isValidUrl(state.baseUrl)) {
      showToast("Invalid URL format", "error");
      return;
    }
    setConnectionStatus("testing");
    try {
      const res = await fetch("/api/projects");
      if (res.ok) {
        setConnectionStatus("success");
        showToast("Connection successful", "success");
      } else {
        setConnectionStatus("error");
        showToast("Connection failed — server returned an error", "error");
      }
    } catch {
      setConnectionStatus("error");
      showToast("Connection failed — could not reach server", "error");
    }
  }, [state.baseUrl, showToast]);

  // ─── Notification test ──────────────────────────────────────────────

  const handleTestNotification = useCallback(
    async (channel: string) => {
      setTestingNotification(channel);
      try {
        const res = await fetch("/api/notifications/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel }),
        });
        if (res.ok) {
          showToast(`Test ${channel} notification sent`, "success");
        } else {
          const data = await res
            .json()
            .catch(() => ({ error: `HTTP ${res.status}` }));
          showToast(
            data.error ?? `Test ${channel} notification failed`,
            "error"
          );
        }
      } catch {
        showToast(`Failed to send test ${channel} notification`, "error");
      }
      setTestingNotification(null);
    },
    [showToast]
  );

  // ─── Validation ─────────────────────────────────────────────────────

  const validate = useCallback((): string | null => {
    if (!state.baseUrl.trim()) return "GraphMemory URL is required";
    if (!isValidUrl(state.baseUrl)) return "Invalid GraphMemory URL format";
    if (!state.projectId.trim()) return "Project ID is required";
    if (state.timeoutMinutes < 1 || state.timeoutMinutes > 1440)
      return "Timeout must be between 1 and 1440 minutes";
    if (state.maxRetries < 0 || state.maxRetries > 10)
      return "Max retries must be between 0 and 10";
    if (state.pollInterval < 1 || state.pollInterval > 60)
      return "Poll interval must be between 1 and 60 seconds";
    if (
      state.notifications.webhookUrl &&
      !isValidUrl(state.notifications.webhookUrl)
    )
      return "Invalid webhook URL format";
    return null;
  }, [state]);

  // ─── Save ───────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    const err = validate();
    if (err) {
      showToast(err, "error");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        baseUrl: state.baseUrl.trim(),
        projectId: state.projectId.trim(),
        apiKey: state.apiKey || undefined,
        timeoutMs: state.timeoutMinutes * 60000,
        pauseMs: state.pollInterval * 1000,
        maxRetries: state.maxRetries,
        permissions: state.permissions,
        notifications: state.notifications,
      };
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res
          .json()
          .catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      showToast("Settings saved", "success");
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to save settings",
        "error"
      );
    }
    setSaving(false);
  }, [state, validate, showToast]);

  // ─── Update helpers ─────────────────────────────────────────────────

  const updateField = useCallback(
    <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
      setState((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const updatePermissions = useCallback((p: Permissions) => {
    setState((prev) => ({ ...prev, permissions: p }));
  }, []);

  const updateNotifications = useCallback((n: Notifications) => {
    setState((prev) => ({ ...prev, notifications: n }));
  }, []);

  // ─── Loading state ──────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ─── Render ─────────────────────────────────────────────────────────

  const inputClass =
    "w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded font-mono text-sm text-text placeholder:text-gray-600 focus:border-accent focus:outline-none";
  const labelClass = "text-text/60 font-mono text-xs";

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-mono text-accent">Settings</h1>
            <p className="text-text/40 font-mono text-xs mt-1">
              Configuration management
            </p>
          </div>
          <button
            onClick={() => navigate("/dashboard")}
            className="px-4 py-2 bg-gray-800 border border-gray-700 text-text font-mono text-sm rounded hover:border-gray-600 transition-colors"
          >
            Back to Dashboard
          </button>
        </div>

        <div className="space-y-8">
          {/* ─── Connection Section ─────────────────────────────────── */}
          <section>
            <SectionHeader title="Connection" />
            <div className="space-y-4">
              <div className="space-y-2">
                <label className={labelClass}>GraphMemory URL</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={state.baseUrl}
                    onChange={(e) => updateField("baseUrl", e.target.value)}
                    placeholder="http://localhost:3100"
                    className={`flex-1 ${inputClass}`}
                  />
                  <button
                    onClick={handleTestConnection}
                    disabled={connectionStatus === "testing"}
                    className={`shrink-0 px-4 py-2 font-mono text-sm rounded border transition-colors ${
                      connectionStatus === "success"
                        ? "bg-green-500/10 border-green-500/30 text-green-400"
                        : connectionStatus === "error"
                          ? "bg-red-500/10 border-red-500/30 text-red-400"
                          : "bg-accent/20 border-accent text-accent hover:bg-accent/30"
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {connectionStatus === "testing" ? (
                      <span className="flex items-center gap-2">
                        <span className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                        Testing...
                      </span>
                    ) : connectionStatus === "success" ? (
                      "Connected"
                    ) : connectionStatus === "error" ? (
                      "Failed — Retry"
                    ) : (
                      "Test Connection"
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className={labelClass}>Project ID</label>
                <input
                  type="text"
                  value={state.projectId}
                  onChange={(e) => updateField("projectId", e.target.value)}
                  placeholder="my-project"
                  className={inputClass}
                />
              </div>
            </div>
          </section>

          {/* ─── API Key Section ────────────────────────────────────── */}
          <section>
            <SectionHeader title="API Key" />
            <div className="space-y-2">
              <label className={labelClass}>
                GraphMemory API Key (if applicable)
              </label>
              <div className="flex gap-2">
                <input
                  type={showApiKey ? "text" : "password"}
                  value={state.apiKey}
                  onChange={(e) => updateField("apiKey", e.target.value)}
                  placeholder="Enter API key..."
                  className={`flex-1 ${inputClass}`}
                />
                <button
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="shrink-0 px-3 py-2 bg-gray-800 border border-gray-700 text-text/60 font-mono text-sm rounded hover:border-gray-600 transition-colors"
                >
                  {showApiKey ? "Hide" : "Show"}
                </button>
              </div>
            </div>
          </section>

          {/* ─── Execution Section ──────────────────────────────────── */}
          <section>
            <SectionHeader title="Execution" />
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className={labelClass}>Timeout (minutes)</label>
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={state.timeoutMinutes}
                  onChange={(e) =>
                    updateField(
                      "timeoutMinutes",
                      parseInt(e.target.value, 10) || 0
                    )
                  }
                  className={inputClass}
                />
              </div>
              <div className="space-y-2">
                <label className={labelClass}>Max retries</label>
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={state.maxRetries}
                  onChange={(e) =>
                    updateField(
                      "maxRetries",
                      parseInt(e.target.value, 10) || 0
                    )
                  }
                  className={inputClass}
                />
              </div>
              <div className="space-y-2">
                <label className={labelClass}>Poll interval (seconds)</label>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={state.pollInterval}
                  onChange={(e) =>
                    updateField(
                      "pollInterval",
                      parseInt(e.target.value, 10) || 0
                    )
                  }
                  className={inputClass}
                />
              </div>
            </div>
          </section>

          {/* ─── Permissions Section ────────────────────────────────── */}
          <section>
            <SectionHeader title="Permissions" />
            <p className="text-text/60 font-mono text-xs mb-3">
              Configure what Claude Code is allowed to do during autonomous runs.
            </p>
            <div className="space-y-1 border border-gray-700 rounded p-4">
              <PermissionToggle
                label="Read files"
                description="Always enabled"
                checked={true}
                disabled={true}
                onChange={() => {}}
              />
              <PermissionToggle
                label="Write files"
                checked={state.permissions.writeFiles}
                onChange={(v) =>
                  updatePermissions({ ...state.permissions, writeFiles: v })
                }
              />
              <PermissionToggle
                label="Run tests"
                description="npm test, pytest, etc."
                checked={state.permissions.runTests}
                onChange={(v) =>
                  updatePermissions({ ...state.permissions, runTests: v })
                }
              />
              <PermissionToggle
                label="Git commit"
                checked={state.permissions.gitCommit}
                onChange={(v) =>
                  updatePermissions({ ...state.permissions, gitCommit: v })
                }
              />
              <PermissionToggle
                label="Git push"
                checked={state.permissions.gitPush}
                onChange={(v) =>
                  updatePermissions({ ...state.permissions, gitPush: v })
                }
              />
              <PermissionToggle
                label="npm/pip publish"
                checked={state.permissions.npmPublish}
                onChange={(v) =>
                  updatePermissions({ ...state.permissions, npmPublish: v })
                }
              />
            </div>
            <div className="space-y-2 mt-4">
              <label className={labelClass}>
                Custom command whitelist (comma-separated)
              </label>
              <input
                type="text"
                value={state.permissions.customCommands}
                onChange={(e) =>
                  updatePermissions({
                    ...state.permissions,
                    customCommands: e.target.value,
                  })
                }
                placeholder="e.g. make build, cargo test"
                className={inputClass}
              />
            </div>
          </section>

          {/* ─── Notifications Section ──────────────────────────────── */}
          <section>
            <SectionHeader title="Notifications" />
            <div className="space-y-4">
              {/* Telegram */}
              <div className="space-y-3 border border-gray-700 rounded p-4">
                <div className="flex items-center justify-between">
                  <p className="text-text/80 font-mono text-sm">Telegram</p>
                  <button
                    onClick={() => handleTestNotification("telegram")}
                    disabled={
                      testingNotification === "telegram" ||
                      !state.notifications.telegramBotToken ||
                      !state.notifications.telegramChatId
                    }
                    className="px-3 py-1 bg-accent/20 border border-accent text-accent font-mono text-xs rounded hover:bg-accent/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {testingNotification === "telegram"
                      ? "Sending..."
                      : "Send Test"}
                  </button>
                </div>
                <input
                  type="text"
                  value={state.notifications.telegramBotToken}
                  onChange={(e) =>
                    updateNotifications({
                      ...state.notifications,
                      telegramBotToken: e.target.value,
                    })
                  }
                  placeholder="Bot token"
                  className={inputClass}
                />
                <input
                  type="text"
                  value={state.notifications.telegramChatId}
                  onChange={(e) =>
                    updateNotifications({
                      ...state.notifications,
                      telegramChatId: e.target.value,
                    })
                  }
                  placeholder="Chat ID"
                  className={inputClass}
                />
              </div>

              {/* Webhook */}
              <div className="space-y-3 border border-gray-700 rounded p-4">
                <div className="flex items-center justify-between">
                  <p className="text-text/80 font-mono text-sm">Webhook</p>
                  <button
                    onClick={() => handleTestNotification("webhook")}
                    disabled={
                      testingNotification === "webhook" ||
                      !state.notifications.webhookUrl
                    }
                    className="px-3 py-1 bg-accent/20 border border-accent text-accent font-mono text-xs rounded hover:bg-accent/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {testingNotification === "webhook"
                      ? "Sending..."
                      : "Send Test"}
                  </button>
                </div>
                <input
                  type="text"
                  value={state.notifications.webhookUrl}
                  onChange={(e) =>
                    updateNotifications({
                      ...state.notifications,
                      webhookUrl: e.target.value,
                    })
                  }
                  placeholder="https://example.com/webhook"
                  className={inputClass}
                />
                <input
                  type="text"
                  value={state.notifications.webhookHeaders}
                  onChange={(e) =>
                    updateNotifications({
                      ...state.notifications,
                      webhookHeaders: e.target.value,
                    })
                  }
                  placeholder='Headers (JSON), e.g. {"Authorization": "Bearer ..."}'
                  className={inputClass}
                />
              </div>

              {/* Desktop */}
              <div className="border border-gray-700 rounded p-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <PermissionToggle
                      label="Desktop notifications"
                      checked={state.notifications.desktopNotifications}
                      onChange={(v) =>
                        updateNotifications({
                          ...state.notifications,
                          desktopNotifications: v,
                        })
                      }
                    />
                  </div>
                  <button
                    onClick={() => handleTestNotification("desktop")}
                    disabled={
                      testingNotification === "desktop" ||
                      !state.notifications.desktopNotifications
                    }
                    className="shrink-0 ml-4 px-3 py-1 bg-accent/20 border border-accent text-accent font-mono text-xs rounded hover:bg-accent/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {testingNotification === "desktop"
                      ? "Sending..."
                      : "Send Test"}
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* ─── Save Button ───────────────────────────────────────── */}
          <div className="flex justify-end pt-4 border-t border-gray-700">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-8 py-2 bg-accent text-bg font-mono text-sm rounded hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {saving && (
                <span className="w-4 h-4 border-2 border-bg border-t-transparent rounded-full animate-spin" />
              )}
              Save Settings
            </button>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  );
}
