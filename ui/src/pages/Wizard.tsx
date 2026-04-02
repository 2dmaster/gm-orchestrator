import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import PermissionToggle from "../components/PermissionToggle";

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

// ─── Step Indicator ─────────────────────────────────────────────────────

function StepIndicator({ current }: { current: Step }) {
  const idx = STEPS.indexOf(current);
  return (
    <div className="flex items-center gap-2 mb-8">
      {STEPS.map((step, i) => (
        <div key={step} className="flex items-center gap-2">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-mono border transition-colors ${
              i < idx
                ? "bg-accent/20 border-accent text-accent"
                : i === idx
                  ? "bg-accent border-accent text-bg font-bold"
                  : "bg-gray-800 border-gray-700 text-gray-500"
            }`}
          >
            {i < idx ? "\u2713" : i + 1}
          </div>
          {i < STEPS.length - 1 && (
            <div
              className={`w-8 h-px ${i < idx ? "bg-accent" : "bg-gray-700"}`}
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
    <div className="space-y-6">
      <h2 className="text-xl font-mono text-accent">Welcome</h2>
      <p className="text-text/80 font-mono text-sm leading-relaxed">
        gm-orchestrator runs Claude Code sessions autonomously to complete your
        GraphMemory tasks. This wizard will help you connect to a GraphMemory
        server, choose a project, and configure permissions.
      </p>
      <button
        onClick={onNext}
        className="px-6 py-2 bg-accent text-bg font-mono text-sm rounded hover:bg-accent/90 transition-colors"
      >
        Next
      </button>
    </div>
  );
}

// ─── Discover Step ──────────────────────────────────────────────────────

function DiscoverStep({
  servers,
  loading,
  manualUrl,
  onManualUrlChange,
  onManualAdd,
  onNext,
  onBack,
}: {
  servers: GMServer[];
  loading: boolean;
  manualUrl: string;
  onManualUrlChange: (url: string) => void;
  onManualAdd: () => void;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-mono text-accent">Discover Servers</h2>

      {loading ? (
        <div className="flex items-center gap-3 text-text/60 font-mono text-sm">
          <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          Scanning for GraphMemory servers...
        </div>
      ) : servers.length > 0 ? (
        <div className="space-y-2">
          <p className="text-text/60 font-mono text-xs">
            Found {servers.length} server{servers.length > 1 ? "s" : ""}:
          </p>
          {servers.map((s) => (
            <div
              key={s.url}
              className="flex items-center justify-between px-4 py-3 bg-gray-800/50 border border-gray-700 rounded font-mono text-sm"
            >
              <span className="text-text">{s.url}</span>
              <span className="text-accent text-xs">
                {s.projects.length} project{s.projects.length !== 1 ? "s" : ""}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-text/60 font-mono text-sm">
            No GraphMemory servers found. Enter a URL manually:
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={manualUrl}
              onChange={(e) => onManualUrlChange(e.target.value)}
              placeholder="http://localhost:3000"
              className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded font-mono text-sm text-text placeholder:text-gray-600 focus:border-accent focus:outline-none"
            />
            <button
              onClick={onManualAdd}
              disabled={!manualUrl.trim()}
              className="px-4 py-2 bg-accent/20 border border-accent text-accent font-mono text-sm rounded hover:bg-accent/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="px-6 py-2 bg-gray-800 border border-gray-700 text-text font-mono text-sm rounded hover:border-gray-600 transition-colors"
        >
          Back
        </button>
        <button
          onClick={onNext}
          disabled={loading || servers.length === 0}
          className="px-6 py-2 bg-accent text-bg font-mono text-sm rounded hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Next
        </button>
      </div>
    </div>
  );
}

// ─── Select Project Step ────────────────────────────────────────────────

function SelectStep({
  servers,
  selectedServer,
  selectedProject,
  onSelectServer,
  onSelectProject,
  onNext,
  onBack,
}: {
  servers: GMServer[];
  selectedServer: string;
  selectedProject: string;
  onSelectServer: (url: string) => void;
  onSelectProject: (id: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const server = servers.find((s) => s.url === selectedServer);
  const projects = server?.projects ?? [];

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-mono text-accent">Select Project</h2>

      {servers.length > 1 && (
        <div className="space-y-2">
          <label className="text-text/60 font-mono text-xs">Server</label>
          <select
            value={selectedServer}
            onChange={(e) => {
              onSelectServer(e.target.value);
              onSelectProject("");
            }}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded font-mono text-sm text-text focus:border-accent focus:outline-none"
          >
            {servers.map((s) => (
              <option key={s.url} value={s.url}>
                {s.url}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="space-y-2">
        <label className="text-text/60 font-mono text-xs">Project</label>
        {projects.length > 0 ? (
          <select
            value={selectedProject}
            onChange={(e) => onSelectProject(e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded font-mono text-sm text-text focus:border-accent focus:outline-none"
          >
            <option value="">-- select a project --</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id} ({p.taskCount} tasks)
              </option>
            ))}
          </select>
        ) : (
          <p className="text-text/40 font-mono text-sm">
            No projects found on this server.
          </p>
        )}
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="px-6 py-2 bg-gray-800 border border-gray-700 text-text font-mono text-sm rounded hover:border-gray-600 transition-colors"
        >
          Back
        </button>
        <button
          onClick={onNext}
          disabled={!selectedProject}
          className="px-6 py-2 bg-accent text-bg font-mono text-sm rounded hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Next
        </button>
      </div>
    </div>
  );
}

// ─── Permissions Step ───────────────────────────────────────────────────

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
    <div className="space-y-6">
      <h2 className="text-xl font-mono text-accent">Permissions</h2>
      <p className="text-text/60 font-mono text-xs">
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
          checked={permissions.writeFiles}
          onChange={(v) => onChange({ ...permissions, writeFiles: v })}
        />
        <PermissionToggle
          label="Run tests"
          description="npm test, pytest, etc."
          checked={permissions.runTests}
          onChange={(v) => onChange({ ...permissions, runTests: v })}
        />
        <PermissionToggle
          label="Git commit"
          checked={permissions.gitCommit}
          onChange={(v) => onChange({ ...permissions, gitCommit: v })}
        />
        <PermissionToggle
          label="Git push"
          checked={permissions.gitPush}
          onChange={(v) => onChange({ ...permissions, gitPush: v })}
        />
        <PermissionToggle
          label="npm/pip publish"
          checked={permissions.npmPublish}
          onChange={(v) => onChange({ ...permissions, npmPublish: v })}
        />
      </div>

      <div className="space-y-2">
        <label className="text-text/60 font-mono text-xs">
          Custom command whitelist (comma-separated)
        </label>
        <input
          type="text"
          value={permissions.customCommands}
          onChange={(e) =>
            onChange({ ...permissions, customCommands: e.target.value })
          }
          placeholder="e.g. make build, cargo test"
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded font-mono text-sm text-text placeholder:text-gray-600 focus:border-accent focus:outline-none"
        />
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="px-6 py-2 bg-gray-800 border border-gray-700 text-text font-mono text-sm rounded hover:border-gray-600 transition-colors"
        >
          Back
        </button>
        <button
          onClick={onNext}
          className="px-6 py-2 bg-accent text-bg font-mono text-sm rounded hover:bg-accent/90 transition-colors"
        >
          Next
        </button>
      </div>
    </div>
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
    <div className="space-y-6">
      <h2 className="text-xl font-mono text-accent">Notifications</h2>
      <p className="text-text/60 font-mono text-xs">
        Optional — configure how you want to be notified about run progress.
      </p>

      <div className="space-y-4">
        <div className="space-y-3 border border-gray-700 rounded p-4">
          <p className="text-text/80 font-mono text-sm">Telegram</p>
          <input
            type="text"
            value={notifications.telegramBotToken}
            onChange={(e) =>
              onChange({ ...notifications, telegramBotToken: e.target.value })
            }
            placeholder="Bot token"
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded font-mono text-sm text-text placeholder:text-gray-600 focus:border-accent focus:outline-none"
          />
          <input
            type="text"
            value={notifications.telegramChatId}
            onChange={(e) =>
              onChange({ ...notifications, telegramChatId: e.target.value })
            }
            placeholder="Chat ID"
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded font-mono text-sm text-text placeholder:text-gray-600 focus:border-accent focus:outline-none"
          />
        </div>

        <div className="space-y-3 border border-gray-700 rounded p-4">
          <p className="text-text/80 font-mono text-sm">Webhook</p>
          <input
            type="text"
            value={notifications.webhookUrl}
            onChange={(e) =>
              onChange({ ...notifications, webhookUrl: e.target.value })
            }
            placeholder="https://example.com/webhook"
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded font-mono text-sm text-text placeholder:text-gray-600 focus:border-accent focus:outline-none"
          />
        </div>

        <div className="border border-gray-700 rounded p-4">
          <PermissionToggle
            label="Desktop notifications"
            checked={notifications.desktopNotifications}
            onChange={(v) =>
              onChange({ ...notifications, desktopNotifications: v })
            }
          />
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="px-6 py-2 bg-gray-800 border border-gray-700 text-text font-mono text-sm rounded hover:border-gray-600 transition-colors"
        >
          Back
        </button>
        <button
          onClick={onNext}
          className="px-6 py-2 bg-gray-800 border border-gray-700 text-text font-mono text-sm rounded hover:border-gray-600 transition-colors"
        >
          Skip
        </button>
        <button
          onClick={onNext}
          className="px-6 py-2 bg-accent text-bg font-mono text-sm rounded hover:bg-accent/90 transition-colors"
        >
          Next
        </button>
      </div>
    </div>
  );
}

// ─── Done Step ──────────────────────────────────────────────────────────

function DoneStep({
  saving,
  error,
  onSave,
  onBack,
}: {
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-mono text-accent">Ready to Go</h2>
      <p className="text-text/80 font-mono text-sm">
        Your configuration is ready. Click below to save and start using
        gm-orchestrator.
      </p>

      {error && (
        <div className="px-4 py-3 bg-red-500/10 border border-red-500/30 rounded font-mono text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={onBack}
          disabled={saving}
          className="px-6 py-2 bg-gray-800 border border-gray-700 text-text font-mono text-sm rounded hover:border-gray-600 transition-colors disabled:opacity-50"
        >
          Back
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          className="px-6 py-2 bg-accent text-bg font-mono text-sm rounded hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {saving && (
            <div className="w-4 h-4 border-2 border-bg border-t-transparent rounded-full animate-spin" />
          )}
          Save & Start
        </button>
      </div>
    </div>
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

  // Selection state
  const [selectedServer, setSelectedServer] = useState("");
  const [selectedProject, setSelectedProject] = useState("");

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
          if (data.config?.projectId) {
            navigate("/dashboard", { replace: true });
            return;
          }
        }
      } catch {
        // Server not ready — stay on wizard
      }
      setCheckingConfig(false);
    })();
  }, [navigate]);

  // Auto-discover servers when entering the discover step
  const discoverServers = useCallback(async () => {
    setDiscoverLoading(true);
    try {
      const res = await fetch("/api/projects");
      if (res.ok) {
        const data = await res.json();
        const found: GMServer[] = data.servers ?? [];
        setServers(found);
        if (found.length > 0 && !selectedServer) {
          setSelectedServer(found[0].url);
        }
      }
    } catch {
      // Discovery failed — user can enter manually
    }
    setDiscoverLoading(false);
  }, [selectedServer]);

  useEffect(() => {
    if (step === "discover") {
      discoverServers();
    }
  }, [step, discoverServers]);

  const handleManualAdd = useCallback(() => {
    const url = manualUrl.trim().replace(/\/+$/, "");
    if (!url) return;
    const port = parseInt(new URL(url).port || "3000", 10);
    setServers((prev) => {
      if (prev.some((s) => s.url === url)) return prev;
      return [...prev, { url, port, projects: [] }];
    });
    if (!selectedServer) setSelectedServer(url);
    setManualUrl("");
  }, [manualUrl, selectedServer]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const server = servers.find((s) => s.url === selectedServer);
      const config = {
        baseUrl: server?.url ?? selectedServer,
        projectId: selectedProject,
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
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save config");
    }
    setSaving(false);
  }, [servers, selectedServer, selectedProject, permissions, notifications, navigate]);

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
        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="w-full max-w-lg">
        <h1 className="text-2xl font-mono text-accent mb-2">gm-orchestrator</h1>
        <p className="text-text/40 font-mono text-xs mb-6">Setup Wizard</p>

        <StepIndicator current={step} />

        {step === "welcome" && <WelcomeStep onNext={goNext} />}

        {step === "discover" && (
          <DiscoverStep
            servers={servers}
            loading={discoverLoading}
            manualUrl={manualUrl}
            onManualUrlChange={setManualUrl}
            onManualAdd={handleManualAdd}
            onNext={goNext}
            onBack={goBack}
          />
        )}

        {step === "select" && (
          <SelectStep
            servers={servers}
            selectedServer={selectedServer}
            selectedProject={selectedProject}
            onSelectServer={setSelectedServer}
            onSelectProject={setSelectedProject}
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
