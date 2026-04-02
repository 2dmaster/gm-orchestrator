import { useState, useEffect, useCallback } from "react";
import { Loader2, Check, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import Shell from "../components/Shell";

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
  baseUrl: string;
  projectId: string;
  apiKey: string;
  timeoutMinutes: number;
  maxRetries: number;
  pollInterval: number;
  permissions: Permissions;
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

function isValidUrl(str: string): boolean {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

function PermRow({ label, description, checked, disabled, onChange }: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className={`flex items-center justify-between py-2.5 ${disabled ? "opacity-60" : ""}`}>
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

// ─── Main ───────────────────────────────────────────────────────────────

export default function Settings() {
  const [state, setState] = useState<SettingsState>(DEFAULT_STATE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testingNotification, setTestingNotification] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/config");
        if (res.ok) {
          const data = await res.json();
          setProjectId(data.projectId ?? null);
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
              desktopNotifications: data.notifications?.desktopNotifications ?? false,
            },
          });
        }
      } catch { /* use defaults */ }
      setLoading(false);
    })();
  }, []);

  const handleTestConnection = useCallback(async () => {
    if (!state.baseUrl || !isValidUrl(state.baseUrl)) {
      toast.error("Enter a valid GraphMemory URL first");
      return;
    }
    setConnectionStatus("testing");
    try {
      const res = await fetch("/api/projects");
      if (res.ok) {
        setConnectionStatus("success");
        toast.success("Connection successful");
      } else {
        setConnectionStatus("error");
        toast.error("Connection failed");
      }
    } catch {
      setConnectionStatus("error");
      toast.error("Connection failed — could not reach server");
    }
  }, [state.baseUrl]);

  const handleTestNotification = useCallback(async (channel: string) => {
    setTestingNotification(channel);
    try {
      const res = await fetch("/api/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      if (res.ok) {
        toast.success(`Test ${channel} notification sent`);
      } else {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        toast.error(data.error ?? `Test ${channel} notification failed`);
      }
    } catch {
      toast.error(`Failed to send test ${channel} notification`);
    }
    setTestingNotification(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!state.baseUrl.trim()) { toast.error("GraphMemory URL is required"); return; }
    if (!isValidUrl(state.baseUrl)) { toast.error("Invalid GraphMemory URL"); return; }
    if (!state.projectId.trim()) { toast.error("Project ID is required"); return; }

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
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      toast.success("Settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save settings");
    }
    setSaving(false);
  }, [state]);

  const updateField = useCallback(<K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
    setState((prev) => ({ ...prev, [key]: value }));
  }, []);

  const updatePermissions = useCallback((p: Permissions) => {
    setState((prev) => ({ ...prev, permissions: p }));
  }, []);

  const updateNotifications = useCallback((n: Notifications) => {
    setState((prev) => ({ ...prev, notifications: n }));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <Shell projectId={projectId} taskCount={0}>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          <h1 className="text-xl font-semibold">Settings</h1>

          <Tabs defaultValue="connection">
            <TabsList>
              <TabsTrigger value="connection">Connection</TabsTrigger>
              <TabsTrigger value="permissions">Permissions</TabsTrigger>
              <TabsTrigger value="notifications">Notifications</TabsTrigger>
            </TabsList>

            {/* ─── Connection Tab ─────────────────────────────────────── */}
            <TabsContent value="connection" className="space-y-4 pt-4">
              <Card>
                <CardContent className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>GraphMemory URL</Label>
                    <div className="flex gap-2">
                      <Input
                        value={state.baseUrl}
                        onChange={(e) => updateField("baseUrl", e.target.value)}
                        placeholder="http://localhost:3000"
                        className="font-mono text-sm"
                      />
                      <Button
                        variant={connectionStatus === "success" ? "secondary" : connectionStatus === "error" ? "destructive" : "secondary"}
                        onClick={handleTestConnection}
                        disabled={connectionStatus === "testing"}
                        className="shrink-0 gap-1.5"
                      >
                        {connectionStatus === "testing" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        {connectionStatus === "success" && <Check className="w-3.5 h-3.5" />}
                        {connectionStatus === "error" && <X className="w-3.5 h-3.5" />}
                        {connectionStatus === "testing" ? "Testing..." : connectionStatus === "success" ? "Connected" : connectionStatus === "error" ? "Retry" : "Test"}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Project ID</Label>
                    <Input
                      value={state.projectId}
                      onChange={(e) => updateField("projectId", e.target.value)}
                      placeholder="my-project"
                      className="font-mono text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>API Key</Label>
                    <div className="flex gap-2">
                      <Input
                        type={showApiKey ? "text" : "password"}
                        value={state.apiKey}
                        onChange={(e) => updateField("apiKey", e.target.value)}
                        placeholder="Enter API key..."
                        className="font-mono text-sm"
                      />
                      <Button variant="ghost" size="sm" onClick={() => setShowApiKey(!showApiKey)}>
                        {showApiKey ? "Hide" : "Show"}
                      </Button>
                    </div>
                  </div>

                  <Separator />

                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs">Timeout (min)</Label>
                      <Input
                        type="number"
                        min={1}
                        max={1440}
                        value={state.timeoutMinutes}
                        onChange={(e) => updateField("timeoutMinutes", parseInt(e.target.value, 10) || 0)}
                        className="font-mono text-sm"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Max retries</Label>
                      <Input
                        type="number"
                        min={0}
                        max={10}
                        value={state.maxRetries}
                        onChange={(e) => updateField("maxRetries", parseInt(e.target.value, 10) || 0)}
                        className="font-mono text-sm"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Poll interval (s)</Label>
                      <Input
                        type="number"
                        min={1}
                        max={60}
                        value={state.pollInterval}
                        onChange={(e) => updateField("pollInterval", parseInt(e.target.value, 10) || 0)}
                        className="font-mono text-sm"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-end">
                <Button onClick={handleSave} disabled={saving} className="gap-2">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save
                </Button>
              </div>
            </TabsContent>

            {/* ─── Permissions Tab ────────────────────────────────────── */}
            <TabsContent value="permissions" className="space-y-4 pt-4">
              <Card>
                <CardContent className="py-4">
                  <div className="divide-y divide-border">
                    <PermRow label="Read files" description="Always enabled" checked={true} disabled={true} onChange={() => {}} />
                    <PermRow label="Write files" description="Create and modify files" checked={state.permissions.writeFiles} onChange={(v) => updatePermissions({ ...state.permissions, writeFiles: v })} />
                    <PermRow label="Run tests" description="npm test, pytest, etc." checked={state.permissions.runTests} onChange={(v) => updatePermissions({ ...state.permissions, runTests: v })} />
                    <PermRow label="Git commit" description="Stage and commit changes" checked={state.permissions.gitCommit} onChange={(v) => updatePermissions({ ...state.permissions, gitCommit: v })} />
                    <PermRow label="Git push" description="Push to remote repository" checked={state.permissions.gitPush} onChange={(v) => updatePermissions({ ...state.permissions, gitPush: v })} />
                    <PermRow label="npm publish" description="Publish packages to registry" checked={state.permissions.npmPublish} onChange={(v) => updatePermissions({ ...state.permissions, npmPublish: v })} />
                  </div>

                  <div className="space-y-2 mt-4">
                    <Label className="text-xs">Custom command whitelist (comma-separated)</Label>
                    <Input
                      value={state.permissions.customCommands}
                      onChange={(e) => updatePermissions({ ...state.permissions, customCommands: e.target.value })}
                      placeholder="e.g. make build, cargo test"
                      className="font-mono text-sm"
                    />
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-end">
                <Button onClick={handleSave} disabled={saving} className="gap-2">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save
                </Button>
              </div>
            </TabsContent>

            {/* ─── Notifications Tab ──────────────────────────────────── */}
            <TabsContent value="notifications" className="space-y-4 pt-4">
              {/* Telegram */}
              <Card>
                <CardContent className="py-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">Telegram</Label>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleTestNotification("telegram")}
                      disabled={testingNotification === "telegram" || !state.notifications.telegramBotToken || !state.notifications.telegramChatId}
                      className="text-xs"
                    >
                      {testingNotification === "telegram" ? "Sending..." : "Send test"}
                    </Button>
                  </div>
                  <Input
                    value={state.notifications.telegramBotToken}
                    onChange={(e) => updateNotifications({ ...state.notifications, telegramBotToken: e.target.value })}
                    placeholder="Bot token"
                    className="font-mono text-sm"
                  />
                  <Input
                    value={state.notifications.telegramChatId}
                    onChange={(e) => updateNotifications({ ...state.notifications, telegramChatId: e.target.value })}
                    placeholder="Chat ID"
                    className="font-mono text-sm"
                  />
                </CardContent>
              </Card>

              {/* Webhook */}
              <Card>
                <CardContent className="py-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">Webhook</Label>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleTestNotification("webhook")}
                      disabled={testingNotification === "webhook" || !state.notifications.webhookUrl}
                      className="text-xs"
                    >
                      {testingNotification === "webhook" ? "Sending..." : "Send test"}
                    </Button>
                  </div>
                  <Input
                    value={state.notifications.webhookUrl}
                    onChange={(e) => updateNotifications({ ...state.notifications, webhookUrl: e.target.value })}
                    placeholder="https://example.com/webhook"
                    className="font-mono text-sm"
                  />
                  <Input
                    value={state.notifications.webhookHeaders}
                    onChange={(e) => updateNotifications({ ...state.notifications, webhookHeaders: e.target.value })}
                    placeholder='Headers JSON: {"Authorization": "Bearer ..."}'
                    className="font-mono text-sm"
                  />
                </CardContent>
              </Card>

              {/* Desktop */}
              <Card>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Desktop notifications</p>
                      <p className="text-xs text-muted-foreground">Browser push notifications</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleTestNotification("desktop")}
                        disabled={testingNotification === "desktop" || !state.notifications.desktopNotifications}
                        className="text-xs"
                      >
                        {testingNotification === "desktop" ? "Sending..." : "Send test"}
                      </Button>
                      <Switch
                        checked={state.notifications.desktopNotifications}
                        onCheckedChange={(v) => updateNotifications({ ...state.notifications, desktopNotifications: v })}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-end">
                <Button onClick={handleSave} disabled={saving} className="gap-2">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </Shell>
  );
}
