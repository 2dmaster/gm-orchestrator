import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Hexagon, Loader2, Check, ArrowLeft, ArrowRight, Square, CheckSquare } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────────────────────

interface GMServerProject {
  id: string;
  taskCount: number;
  epicCount: number;
}

interface GMServer {
  url: string;
  port: number;
  projects: GMServerProject[];
}

/** A project selection combining the server URL with the project ID. */
interface SelectedProject {
  serverUrl: string;
  projectId: string;
}

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
  desktopNotifications: boolean;
}

type Step = "welcome" | "discover" | "select" | "permissions" | "notifications" | "done";

const STEPS: Step[] = ["welcome", "discover", "select", "permissions", "notifications", "done"];

const STEP_LABELS: Record<Step, string> = {
  welcome: "Welcome",
  discover: "Connect",
  select: "Projects",
  permissions: "Permissions",
  notifications: "Notify",
  done: "Done",
};

// ─── Step Indicator ─────────────────────────────────────────────────────

function StepIndicator({ current }: { current: Step }) {
  const idx = STEPS.indexOf(current);
  return (
    <div className="flex items-center justify-center gap-1 mb-8">
      {STEPS.map((step, i) => (
        <div key={step} className="flex items-center gap-1">
          <div className="flex flex-col items-center gap-1">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium border transition-all ${
                i < idx
                  ? "bg-primary/20 border-primary text-primary"
                  : i === idx
                    ? "bg-primary border-primary text-primary-foreground font-bold"
                    : "bg-muted border-border text-muted-foreground"
              }`}
            >
              {i < idx ? <Check className="w-3.5 h-3.5" /> : i + 1}
            </div>
            <span className={`text-[10px] ${i <= idx ? "text-foreground" : "text-muted-foreground"}`}>
              {STEP_LABELS[step]}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div
              className={`w-6 h-px mb-4 ${i < idx ? "bg-primary" : "bg-border"}`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Welcome Step ───────────────────────────────────────────────────────

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <Card className="max-w-md mx-auto">
      <CardContent className="flex flex-col items-center text-center py-10 space-y-6">
        <Hexagon className="w-14 h-14 text-primary" strokeWidth={1.5} />
        <div className="space-y-2">
          <h2 className="text-xl font-mono font-semibold">gm-orchestrator</h2>
          <p className="text-sm text-muted-foreground">
            Autonomous AI run orchestrator for GraphMemory.
          </p>
          <p className="text-xs text-muted-foreground">
            Set up takes 60 seconds.
          </p>
        </div>
        <Button onClick={onNext} className="gap-2">
          Get started <ArrowRight className="w-4 h-4" />
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Discover Step ──────────────────────────────────────────────────────

function DiscoverStep({
  servers,
  loading,
  manualUrl,
  manualProbing,
  onManualUrlChange,
  onManualAdd,
  onNext,
  onBack,
}: {
  servers: GMServer[];
  loading: boolean;
  manualUrl: string;
  manualProbing: boolean;
  onManualUrlChange: (url: string) => void;
  onManualAdd: () => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect GraphMemory</CardTitle>
        <CardDescription>
          {loading ? "Scanning localhost..." : `Found ${servers.length} server${servers.length !== 1 ? "s" : ""}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-3 text-muted-foreground text-sm py-4">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            Scanning for GraphMemory servers...
          </div>
        ) : servers.length > 0 ? (
          <div className="space-y-2">
            {servers.map((s) => (
              <div
                key={s.url}
                className="flex items-center justify-between px-4 py-3 bg-muted/50 border border-border rounded-lg text-sm"
              >
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[var(--color-done)]" />
                  <span className="font-mono text-sm">{s.url}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {s.projects.length} project{s.projects.length !== 1 ? "s" : ""}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Or enter URL manually:</Label>
          <div className="flex gap-2">
            <Input
              value={manualUrl}
              onChange={(e) => onManualUrlChange(e.target.value)}
              placeholder="http://localhost:3000"
              className="font-mono text-sm"
            />
            <Button
              variant="secondary"
              onClick={onManualAdd}
              disabled={!manualUrl.trim() || manualProbing}
            >
              {manualProbing ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add"}
            </Button>
          </div>
        </div>

        <div className="flex justify-between pt-2">
          <Button variant="ghost" onClick={onBack} className="gap-1">
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>
          <Button
            onClick={onNext}
            disabled={loading || servers.length === 0}
            className="gap-1"
          >
            Continue <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Select Projects Step (multi-project checkboxes) ────────────────────

function SelectStep({
  servers,
  selectedProjects,
  onToggleProject,
  onSelectAll,
  onDeselectAll,
  onNext,
  onBack,
}: {
  servers: GMServer[];
  selectedProjects: SelectedProject[];
  onToggleProject: (serverUrl: string, projectId: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const isSelected = (serverUrl: string, projectId: string) =>
    selectedProjects.some((sp) => sp.serverUrl === serverUrl && sp.projectId === projectId);

  const totalProjects = servers.reduce((sum, s) => sum + s.projects.length, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Select projects</CardTitle>
        <CardDescription>
          Choose one or more GraphMemory projects to orchestrate.
          {selectedProjects.length > 0 && (
            <span className="ml-1 text-primary font-medium">
              {selectedProjects.length} selected
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {totalProjects > 1 && (
          <div className="flex gap-2 text-xs">
            <button
              type="button"
              onClick={onSelectAll}
              className="text-primary hover:underline"
            >
              Select all
            </button>
            <span className="text-muted-foreground">/</span>
            <button
              type="button"
              onClick={onDeselectAll}
              className="text-muted-foreground hover:underline"
            >
              Deselect all
            </button>
          </div>
        )}

        {servers.map((server) => (
          <div key={server.url} className="space-y-2">
            {servers.length > 1 && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="w-2 h-2 rounded-full bg-[var(--color-done)]" />
                <span className="font-mono">{server.url}</span>
              </div>
            )}

            {server.projects.length > 0 ? (
              server.projects.map((p) => {
                const checked = isSelected(server.url, p.id);
                return (
                  <button
                    key={`${server.url}::${p.id}`}
                    type="button"
                    onClick={() => onToggleProject(server.url, p.id)}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border text-sm text-left transition-colors ${
                      checked
                        ? "border-primary bg-primary/10"
                        : "border-border bg-muted/30 hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {checked ? (
                        <CheckSquare className="w-4 h-4 text-primary" />
                      ) : (
                        <Square className="w-4 h-4 text-muted-foreground" />
                      )}
                      <span className="font-mono">{p.id}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {p.taskCount} tasks &middot; {p.epicCount} epics
                    </span>
                  </button>
                );
              })
            ) : (
              <p className="text-sm text-muted-foreground py-2">
                No projects found on this server.
              </p>
            )}
          </div>
        ))}

        <div className="flex justify-between pt-2">
          <Button variant="ghost" onClick={onBack} className="gap-1">
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>
          <Button onClick={onNext} disabled={selectedProjects.length === 0} className="gap-1">
            Continue <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Permissions Step ───────────────────────────────────────────────────

interface PermissionItemProps {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}

function PermissionItem({ label, description, checked, disabled, onChange }: PermissionItemProps) {
  return (
    <div className={`flex items-center justify-between py-2.5 ${disabled ? "opacity-60" : ""}`}>
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  );
}

function PermissionsStep({
  permissions,
  onChange,
  onNext,
  onBack,
}: {
  permissions: Permissions;
  onChange: (p: Permissions) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>What can Claude do?</CardTitle>
        <CardDescription>Configure permissions for autonomous runs.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="divide-y divide-border">
          <PermissionItem label="Read files" description="Always enabled" checked={true} disabled={true} onChange={() => {}} />
          <PermissionItem label="Write files" description="Create and modify files" checked={permissions.writeFiles} onChange={(v) => onChange({ ...permissions, writeFiles: v })} />
          <PermissionItem label="Run tests" description="npm test, pytest, etc." checked={permissions.runTests} onChange={(v) => onChange({ ...permissions, runTests: v })} />
          <PermissionItem label="Git commit" description="Stage and commit changes" checked={permissions.gitCommit} onChange={(v) => onChange({ ...permissions, gitCommit: v })} />
          <PermissionItem label="Git push" description="Push to remote repository" checked={permissions.gitPush} onChange={(v) => onChange({ ...permissions, gitPush: v })} />
          <PermissionItem label="npm publish" description="Publish packages to registry" checked={permissions.npmPublish} onChange={(v) => onChange({ ...permissions, npmPublish: v })} />
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">
            Custom command whitelist (comma-separated)
          </Label>
          <Input
            value={permissions.customCommands}
            onChange={(e) => onChange({ ...permissions, customCommands: e.target.value })}
            placeholder="e.g. make build, cargo test"
            className="font-mono text-sm"
          />
        </div>

        <div className="flex justify-between pt-2">
          <Button variant="ghost" onClick={onBack} className="gap-1">
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>
          <Button onClick={onNext} className="gap-1">
            Continue <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Notifications Step ─────────────────────────────────────────────────

function NotificationsStep({
  notifications,
  onChange,
  onNext,
  onBack,
}: {
  notifications: Notifications;
  onChange: (n: Notifications) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>Optional — configure how to be notified about run progress.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3 rounded-lg border border-border p-4">
          <Label className="text-sm font-medium">Telegram</Label>
          <Input
            value={notifications.telegramBotToken}
            onChange={(e) => onChange({ ...notifications, telegramBotToken: e.target.value })}
            placeholder="Bot token"
            className="font-mono text-sm"
          />
          <Input
            value={notifications.telegramChatId}
            onChange={(e) => onChange({ ...notifications, telegramChatId: e.target.value })}
            placeholder="Chat ID"
            className="font-mono text-sm"
          />
        </div>

        <div className="space-y-3 rounded-lg border border-border p-4">
          <Label className="text-sm font-medium">Webhook</Label>
          <Input
            value={notifications.webhookUrl}
            onChange={(e) => onChange({ ...notifications, webhookUrl: e.target.value })}
            placeholder="https://example.com/webhook"
            className="font-mono text-sm"
          />
        </div>

        <div className="rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Desktop notifications</p>
              <p className="text-xs text-muted-foreground">Browser push notifications</p>
            </div>
            <Switch
              checked={notifications.desktopNotifications}
              onCheckedChange={(v) => onChange({ ...notifications, desktopNotifications: v })}
            />
          </div>
        </div>

        <div className="flex justify-between pt-2">
          <Button variant="ghost" onClick={onBack} className="gap-1">
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onNext}>Skip</Button>
            <Button onClick={onNext} className="gap-1">
              Continue <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Done Step ──────────────────────────────────────────────────────────

function DoneStep({
  selectedProjects,
  servers,
  totalTaskCount,
  saving,
  error,
  onSave,
  onBack,
}: {
  selectedProjects: SelectedProject[];
  servers: GMServer[];
  totalTaskCount: number;
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onBack: () => void;
}) {
  return (
    <Card className="max-w-md mx-auto">
      <CardContent className="flex flex-col items-center text-center py-10 space-y-6">
        <div className="w-14 h-14 rounded-full bg-[var(--color-done)]/20 flex items-center justify-center">
          <Check className="w-7 h-7 text-[var(--color-done)]" />
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">You&apos;re ready</h2>
          <p className="text-sm text-muted-foreground">
            {selectedProjects.length} project{selectedProjects.length !== 1 ? "s" : ""} selected
          </p>
          <div className="space-y-1">
            {selectedProjects.map((sp) => {
              const server = servers.find((s) => s.url === sp.serverUrl);
              const project = server?.projects.find((p) => p.id === sp.projectId);
              return (
                <p key={`${sp.serverUrl}::${sp.projectId}`} className="text-xs text-muted-foreground font-mono">
                  {sp.projectId} &middot; {sp.serverUrl}
                  {project ? ` (${project.taskCount} tasks)` : ""}
                </p>
              );
            })}
          </div>
          <p className="text-sm text-muted-foreground">
            {totalTaskCount} tasks waiting
          </p>
        </div>

        {error && (
          <div className="w-full px-4 py-3 rounded-lg bg-destructive/10 border border-destructive/30 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <Button variant="ghost" onClick={onBack} disabled={saving} className="gap-1">
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>
          <Button onClick={onSave} disabled={saving} className="gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Go to Dashboard <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Wizard ────────────────────────────────────────────────────────

export default function Wizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("welcome");
  const [checkingConfig, setCheckingConfig] = useState(true);

  // Discovery state
  const [servers, setServers] = useState<GMServer[]>([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [manualUrl, setManualUrl] = useState("");

  // Selection state (multi-project)
  const [selectedProjects, setSelectedProjects] = useState<SelectedProject[]>([]);

  // Permissions state
  const [permissions, setPermissions] = useState<Permissions>({
    readFiles: true,
    writeFiles: true,
    runTests: true,
    gitCommit: true,
    gitPush: false,
    npmPublish: false,
    customCommands: "",
  });

  // Notifications state
  const [notifications, setNotifications] = useState<Notifications>({
    telegramBotToken: "",
    telegramChatId: "",
    webhookUrl: "",
    desktopNotifications: false,
  });

  // Save state
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Check if config already exists — redirect to dashboard if so
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/status");
        if (res.ok) {
          const data = await res.json();
          if (data.config?.activeProjectId && !data.setupRequired) {
            try {
              const projectRes = await fetch(`/api/projects/${data.config.activeProjectId}/tasks?limit=1`);
              if (projectRes.ok) {
                navigate("/dashboard", { replace: true });
                return;
              }
            } catch {
              // GM server not reachable — stay on wizard
            }
          }
        }
      } catch {
        // Server not ready — stay on wizard
      }
      setCheckingConfig(false);
    })();
  }, [navigate]);

  // Auto-discover servers once when first entering the discover step
  const discoveredRef = useRef(false);

  useEffect(() => {
    if (step !== "discover" || discoveredRef.current) return;
    discoveredRef.current = true;
    setDiscoverLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/projects");
        if (res.ok) {
          const data = await res.json();
          const found: GMServer[] = data.servers ?? [];
          setServers((prev) => {
            const merged = [...prev];
            for (const s of found) {
              if (!merged.some((m) => m.url === s.url)) {
                merged.push(s);
              }
            }
            return merged;
          });
          // Servers are available for multi-project selection in the next step
        }
      } catch {
        // Discovery failed — user can enter manually
      }
      setDiscoverLoading(false);
    })();
  }, [step]);

  const [manualProbing, setManualProbing] = useState(false);

  const handleManualAdd = useCallback(async () => {
    const url = manualUrl.trim().replace(/\/+$/, "");
    if (!url) return;
    try {
      new URL(url);
    } catch {
      toast.error("Invalid URL");
      return;
    }
    setManualProbing(true);
    try {
      const res = await fetch("/api/projects/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (res.ok) {
        const data = await res.json() as { server: GMServer };
        setServers((prev) => {
          const existing = prev.findIndex((s) => s.url === data.server.url);
          if (existing >= 0) {
            const updated = [...prev];
            updated[existing] = data.server;
            return updated;
          }
          return [...prev, data.server];
        });
        setManualUrl("");
        toast.success(`Found ${data.server.projects.length} project(s)`);
      } else {
        const err = await res.json().catch(() => ({ error: "Connection failed" }));
        toast.error(err.error ?? "No GraphMemory server found at this URL");
      }
    } catch {
      toast.error("Could not reach server");
    }
    setManualProbing(false);
  }, [manualUrl]);

  const handleToggleProject = useCallback((serverUrl: string, projectId: string) => {
    setSelectedProjects((prev) => {
      const exists = prev.some((sp) => sp.serverUrl === serverUrl && sp.projectId === projectId);
      if (exists) {
        return prev.filter((sp) => !(sp.serverUrl === serverUrl && sp.projectId === projectId));
      }
      return [...prev, { serverUrl, projectId }];
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    const all: SelectedProject[] = [];
    for (const server of servers) {
      for (const project of server.projects) {
        all.push({ serverUrl: server.url, projectId: project.id });
      }
    }
    setSelectedProjects(all);
  }, [servers]);

  const handleDeselectAll = useCallback(() => {
    setSelectedProjects([]);
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const projects = selectedProjects.map((sp) => ({
        baseUrl: sp.serverUrl,
        projectId: sp.projectId,
      }));
      const activeProjectId = selectedProjects.length > 0 ? selectedProjects[0].projectId : undefined;
      const config = {
        projects,
        activeProjectId,
        permissions,
        notifications,
      };
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      toast.success("Configuration saved!");
      navigate("/dashboard", { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save config";
      setSaveError(msg);
      toast.error(msg);
    }
    setSaving(false);
  }, [selectedProjects, permissions, notifications, navigate]);

  const goNext = useCallback(() => {
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]);
  }, [step]);

  const goBack = useCallback(() => {
    const idx = STEPS.indexOf(step);
    if (idx > 0) setStep(STEPS[idx - 1]);
  }, [step]);

  if (checkingConfig) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  // Calculate total task count for done step
  const totalTaskCount = selectedProjects.reduce((sum, sp) => {
    const server = servers.find((s) => s.url === sp.serverUrl);
    const project = server?.projects.find((p) => p.id === sp.projectId);
    return sum + (project?.taskCount ?? 0);
  }, 0);

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="w-full max-w-lg">
        <StepIndicator current={step} />

        {step === "welcome" && <WelcomeStep onNext={goNext} />}

        {step === "discover" && (
          <DiscoverStep
            servers={servers}
            loading={discoverLoading}
            manualUrl={manualUrl}
            manualProbing={manualProbing}
            onManualUrlChange={setManualUrl}
            onManualAdd={handleManualAdd}
            onNext={goNext}
            onBack={goBack}
          />
        )}

        {step === "select" && (
          <SelectStep
            servers={servers}
            selectedProjects={selectedProjects}
            onToggleProject={handleToggleProject}
            onSelectAll={handleSelectAll}
            onDeselectAll={handleDeselectAll}
            onNext={goNext}
            onBack={goBack}
          />
        )}

        {step === "permissions" && (
          <PermissionsStep
            permissions={permissions}
            onChange={setPermissions}
            onNext={goNext}
            onBack={goBack}
          />
        )}

        {step === "notifications" && (
          <NotificationsStep
            notifications={notifications}
            onChange={setNotifications}
            onNext={goNext}
            onBack={goBack}
          />
        )}

        {step === "done" && (
          <DoneStep
            selectedProjects={selectedProjects}
            servers={servers}
            totalTaskCount={totalTaskCount}
            saving={saving}
            error={saveError}
            onSave={handleSave}
            onBack={goBack}
          />
        )}
      </div>
    </div>
  );
}
