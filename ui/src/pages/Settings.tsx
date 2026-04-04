import { useState, useEffect, useCallback, useRef } from "react";
import {
  Loader2, Check, X, Plus, Pencil, Trash2, Globe, Radio,
  Server, RefreshCw,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import Shell from "../components/Shell";
import type { ProjectOverview, OrchestratorConfig, ProjectEntry } from "../types";

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

interface ServerStatus {
  online: boolean;
  probing: boolean;
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
  webhookHeaders: string;
  desktopNotifications: boolean;
}

// Group projects by baseUrl for the server-centric view
interface ServerGroup {
  baseUrl: string;
  projects: ProjectEntry[];
}

function groupByServer(projects: ProjectEntry[]): ServerGroup[] {
  const map = new Map<string, ProjectEntry[]>();
  for (const p of projects) {
    const list = map.get(p.baseUrl) ?? [];
    list.push(p);
    map.set(p.baseUrl, list);
  }
  return [...map.entries()].map(([baseUrl, projs]) => ({ baseUrl, projects: projs }));
}

function isValidUrl(str: string): boolean {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

// ─── Sub-components ─────────────────────────────────────────────────────

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

function StatusBadge({ online, probing }: { online: boolean; probing: boolean }) {
  if (probing) {
    return (
      <Badge variant="outline" className="gap-1 text-xs">
        <Loader2 className="w-3 h-3 animate-spin" /> probing
      </Badge>
    );
  }
  return online ? (
    <Badge variant="outline" className="gap-1 text-xs text-[var(--color-done)] border-[var(--color-done)]/30">
      <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-done)]" /> online
    </Badge>
  ) : (
    <Badge variant="outline" className="gap-1 text-xs text-destructive border-destructive/30">
      <div className="w-1.5 h-1.5 rounded-full bg-destructive" /> offline
    </Badge>
  );
}

// ─── Main ───────────────────────────────────────────────────────────────

export default function Settings() {
  // Config state
  const [config, setConfig] = useState<OrchestratorConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState<string>("");

  // Server statuses: baseUrl → status
  const [serverStatuses, setServerStatuses] = useState<Map<string, ServerStatus>>(new Map());

  // Project overview data for task/epic counts
  const [overviews, setOverviews] = useState<Map<string, ProjectOverview>>(new Map());

  // Permissions & notifications (stored separately in config)
  const [permissions, setPermissions] = useState<Permissions>({
    readFiles: true, writeFiles: true, runTests: true,
    gitCommit: true, gitPush: false, npmPublish: false, customCommands: "",
  });
  const [notifications, setNotifications] = useState<Notifications>({
    telegramBotToken: "", telegramChatId: "",
    webhookUrl: "", webhookHeaders: "", desktopNotifications: false,
  });
  const [testingNotification, setTestingNotification] = useState<string | null>(null);

  // Add server form
  const [showAddServer, setShowAddServer] = useState(false);
  const [newServerUrl, setNewServerUrl] = useState("");
  const [probing, setProbing] = useState(false);
  const [discoveredProjects, setDiscoveredProjects] = useState<GMServerProject[]>([]);
  const [selectedNewProjects, setSelectedNewProjects] = useState<Set<string>>(new Set());

  // Edit state
  const [editingServerUrl, setEditingServerUrl] = useState<string | null>(null);
  const [editServerValue, setEditServerValue] = useState("");
  const [editingLabel, setEditingLabel] = useState<string | null>(null); // projectId
  const [editLabelValue, setEditLabelValue] = useState("");

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<{ type: "server" | "project"; baseUrl: string; projectId?: string } | null>(null);

  const probedRef = useRef(new Set<string>());

  // ─── Load config ──────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      try {
        const [configRes, statusRes] = await Promise.all([
          fetch("/api/config"),
          fetch("/api/status"),
        ]);
        if (configRes.ok) {
          const data = await configRes.json() as OrchestratorConfig & {
            permissions?: Permissions;
            notifications?: Notifications;
          };
          setConfig(data);
          if (data.permissions) setPermissions({ ...permissions, ...data.permissions });
          if (data.notifications) setNotifications({ ...notifications, ...data.notifications });
        }
        if (statusRes.ok) {
          const data = await statusRes.json() as { version?: string };
          if (data.version) setVersion(data.version);
        }
      } catch { /* use defaults */ }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Probe servers on load ────────────────────────────────────────────

  const probeServerUrl = useCallback(async (baseUrl: string) => {
    setServerStatuses((prev) => {
      const next = new Map(prev);
      next.set(baseUrl, { online: false, probing: true, projects: [] });
      return next;
    });
    try {
      const res = await fetch("/api/projects/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: baseUrl }),
      });
      if (res.ok) {
        const data = await res.json() as { server: GMServer };
        setServerStatuses((prev) => {
          const next = new Map(prev);
          next.set(baseUrl, { online: true, probing: false, projects: data.server.projects });
          return next;
        });
      } else {
        setServerStatuses((prev) => {
          const next = new Map(prev);
          next.set(baseUrl, { online: false, probing: false, projects: [] });
          return next;
        });
      }
    } catch {
      setServerStatuses((prev) => {
        const next = new Map(prev);
        next.set(baseUrl, { online: false, probing: false, projects: [] });
        return next;
      });
    }
  }, []);

  useEffect(() => {
    if (!config) return;
    const urls = new Set(config.projects.map((p) => p.baseUrl));
    for (const url of urls) {
      if (!probedRef.current.has(url)) {
        probedRef.current.add(url);
        probeServerUrl(url);
      }
    }
  }, [config, probeServerUrl]);

  // ─── Fetch overview for task/epic counts ──────────────────────────────

  useEffect(() => {
    if (!config || config.projects.length === 0) return;
    (async () => {
      try {
        const res = await fetch("/api/projects/overview");
        if (res.ok) {
          const data = await res.json() as { projects: ProjectOverview[] };
          const map = new Map<string, ProjectOverview>();
          for (const p of data.projects) map.set(p.projectId, p);
          setOverviews(map);
        }
      } catch { /* ignore */ }
    })();
  }, [config]);

  // ─── Save config ──────────────────────────────────────────────────────

  const saveConfig = useCallback(async (patch: Partial<OrchestratorConfig & { permissions?: Permissions; notifications?: Notifications }>) => {
    setSaving(true);
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const updated = await res.json() as OrchestratorConfig;
      setConfig(updated);
      toast.success("Settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    }
    setSaving(false);
  }, []);

  // ─── Connection handlers ──────────────────────────────────────────────

  const handleProbeNewServer = useCallback(async () => {
    const url = newServerUrl.trim().replace(/\/+$/, "");
    if (!url || !isValidUrl(url)) {
      toast.error("Enter a valid URL");
      return;
    }
    setProbing(true);
    setDiscoveredProjects([]);
    setSelectedNewProjects(new Set());
    try {
      const res = await fetch("/api/projects/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (res.ok) {
        const data = await res.json() as { server: GMServer };
        setDiscoveredProjects(data.server.projects);
        setSelectedNewProjects(new Set(data.server.projects.map((p) => p.id)));
        toast.success(`Found ${data.server.projects.length} project(s)`);
      } else {
        const err = await res.json().catch(() => ({ error: "Connection failed" }));
        toast.error(err.error ?? "No GraphMemory server found");
      }
    } catch {
      toast.error("Could not reach server");
    }
    setProbing(false);
  }, [newServerUrl]);

  const handleAddServerConfirm = useCallback(async () => {
    if (!config || selectedNewProjects.size === 0) return;
    const url = newServerUrl.trim().replace(/\/+$/, "");
    const newEntries: ProjectEntry[] = [...selectedNewProjects].map((id) => ({
      baseUrl: url,
      projectId: id,
    }));
    const existingIds = new Set(config.projects.map((p) => `${p.baseUrl}::${p.projectId}`));
    const toAdd = newEntries.filter((e) => !existingIds.has(`${e.baseUrl}::${e.projectId}`));
    if (toAdd.length === 0) {
      toast.error("All selected projects are already configured");
      return;
    }
    const projects = [...config.projects, ...toAdd];
    const activeProjectId = config.activeProjectId ?? projects[0]?.projectId;
    await saveConfig({ projects, activeProjectId });
    setShowAddServer(false);
    setNewServerUrl("");
    setDiscoveredProjects([]);
    setSelectedNewProjects(new Set());
    probedRef.current.add(url);
    probeServerUrl(url);
  }, [config, selectedNewProjects, newServerUrl, saveConfig, probeServerUrl]);

  const handleEditServerUrl = useCallback(async (oldUrl: string) => {
    if (!config) return;
    const newUrl = editServerValue.trim().replace(/\/+$/, "");
    if (!newUrl || !isValidUrl(newUrl)) {
      toast.error("Enter a valid URL");
      return;
    }
    if (newUrl === oldUrl) {
      setEditingServerUrl(null);
      return;
    }
    const projects = config.projects.map((p) =>
      p.baseUrl === oldUrl ? { ...p, baseUrl: newUrl } : p
    );
    await saveConfig({ projects });
    setEditingServerUrl(null);
    probedRef.current.delete(oldUrl);
    probedRef.current.add(newUrl);
    probeServerUrl(newUrl);
  }, [config, editServerValue, saveConfig, probeServerUrl]);

  const handleRemoveServer = useCallback(async (baseUrl: string) => {
    if (!config) return;
    const remaining = config.projects.filter((p) => p.baseUrl !== baseUrl);
    if (remaining.length === 0) {
      toast.error("Cannot remove the last server — at least one project must remain");
      setDeleteTarget(null);
      return;
    }
    const activeProjectId = remaining.some((p) => p.projectId === config.activeProjectId)
      ? config.activeProjectId
      : remaining[0]?.projectId;
    await saveConfig({ projects: remaining, activeProjectId });
    setDeleteTarget(null);
  }, [config, saveConfig]);

  const handleRemoveProject = useCallback(async (baseUrl: string, projectId: string) => {
    if (!config) return;
    const remaining = config.projects.filter(
      (p) => !(p.baseUrl === baseUrl && p.projectId === projectId)
    );
    if (remaining.length === 0) {
      toast.error("Cannot remove the last project");
      setDeleteTarget(null);
      return;
    }
    const activeProjectId = remaining.some((p) => p.projectId === config.activeProjectId)
      ? config.activeProjectId
      : remaining[0]?.projectId;
    await saveConfig({ projects: remaining, activeProjectId });
    setDeleteTarget(null);
  }, [config, saveConfig]);

  const handleEditLabel = useCallback(async (projectId: string) => {
    if (!config) return;
    const projects = config.projects.map((p) =>
      p.projectId === projectId ? { ...p, label: editLabelValue.trim() || undefined } : p
    );
    await saveConfig({ projects });
    setEditingLabel(null);
  }, [config, editLabelValue, saveConfig]);

  const handleSetActive = useCallback(async (projectId: string) => {
    if (!config || config.activeProjectId === projectId) return;
    await saveConfig({ activeProjectId: projectId });
  }, [config, saveConfig]);

  const handleRefreshServer = useCallback((baseUrl: string) => {
    probedRef.current.delete(baseUrl);
    probeServerUrl(baseUrl);
  }, [probeServerUrl]);

  // ─── Config handlers ──────────────────────────────────────────────────

  const handleSaveConfig = useCallback(async () => {
    if (!config) return;
    await saveConfig({
      timeoutMs: config.timeoutMs,
      pauseMs: config.pauseMs,
      maxRetries: config.maxRetries,
      concurrency: config.concurrency,
      dryRun: config.dryRun,
      maxTurns: config.maxTurns,
      agentTimeoutMs: config.agentTimeoutMs,
    });
  }, [config, saveConfig]);

  const updateConfigField = useCallback(<K extends keyof OrchestratorConfig>(key: K, value: OrchestratorConfig[K]) => {
    setConfig((prev) => prev ? { ...prev, [key]: value } : prev);
  }, []);

  // ─── Notification handlers ────────────────────────────────────────────

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

  const handleSavePermissions = useCallback(async () => {
    await saveConfig({ permissions } as Partial<OrchestratorConfig & { permissions: Permissions }>);
  }, [permissions, saveConfig]);

  const handleSaveNotifications = useCallback(async () => {
    await saveConfig({ notifications } as Partial<OrchestratorConfig & { notifications: Notifications }>);
  }, [notifications, saveConfig]);

  // ─── Render ───────────────────────────────────────────────────────────

  if (loading || !config) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  const serverGroups = groupByServer(config.projects);

  return (
    <Shell projectId={config.activeProjectId ?? null} taskCount={0}>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          <h1 className="text-xl font-semibold">Settings</h1>

          <Tabs defaultValue="connections">
            <TabsList>
              <TabsTrigger value="connections">Connections</TabsTrigger>
              <TabsTrigger value="config">Config</TabsTrigger>
              <TabsTrigger value="permissions">Permissions</TabsTrigger>
              <TabsTrigger value="notifications">Notifications</TabsTrigger>
            </TabsList>

            {/* ─── Connections Tab ────────────────────────────────────── */}
            <TabsContent value="connections" className="space-y-4 pt-4">
              {/* Server list */}
              {serverGroups.map((group) => {
                const status = serverStatuses.get(group.baseUrl);
                const isEditing = editingServerUrl === group.baseUrl;

                return (
                  <Card key={group.baseUrl}>
                    <CardContent className="py-4 space-y-3">
                      {/* Server header */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <Server className="w-4 h-4 text-muted-foreground shrink-0" />
                          {isEditing ? (
                            <div className="flex gap-2 flex-1">
                              <Input
                                value={editServerValue}
                                onChange={(e) => setEditServerValue(e.target.value)}
                                className="font-mono text-sm h-8"
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleEditServerUrl(group.baseUrl);
                                  if (e.key === "Escape") setEditingServerUrl(null);
                                }}
                                autoFocus
                              />
                              <Button size="sm" variant="ghost" onClick={() => handleEditServerUrl(group.baseUrl)}>
                                <Check className="w-3.5 h-3.5" />
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditingServerUrl(null)}>
                                <X className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <span className="font-mono text-sm truncate">{group.baseUrl}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <StatusBadge
                            online={status?.online ?? false}
                            probing={status?.probing ?? false}
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRefreshServer(group.baseUrl)}
                            disabled={status?.probing}
                            className="h-7 w-7 p-0"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${status?.probing ? "animate-spin" : ""}`} />
                          </Button>
                          {!isEditing && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setEditingServerUrl(group.baseUrl);
                                setEditServerValue(group.baseUrl);
                              }}
                              className="h-7 w-7 p-0"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDeleteTarget({ type: "server", baseUrl: group.baseUrl })}
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>

                      <Separator />

                      {/* Projects under this server */}
                      <div className="space-y-1">
                        {group.projects.map((proj) => {
                          const overview = overviews.get(proj.projectId);
                          const isActive = config.activeProjectId === proj.projectId;
                          const isEditingLbl = editingLabel === proj.projectId;

                          return (
                            <div
                              key={proj.projectId}
                              className={`flex items-center justify-between px-3 py-2 rounded-md transition-colors ${
                                isActive ? "bg-primary/10 border border-primary/20" : "hover:bg-muted/50"
                              }`}
                            >
                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                <button
                                  type="button"
                                  onClick={() => handleSetActive(proj.projectId)}
                                  className="shrink-0"
                                  title={isActive ? "Active project" : "Set as active"}
                                >
                                  <Radio
                                    className={`w-4 h-4 ${isActive ? "text-primary fill-primary" : "text-muted-foreground"}`}
                                  />
                                </button>
                                <div className="min-w-0">
                                  {isEditingLbl ? (
                                    <div className="flex gap-1">
                                      <Input
                                        value={editLabelValue}
                                        onChange={(e) => setEditLabelValue(e.target.value)}
                                        className="font-mono text-sm h-7 w-40"
                                        placeholder={proj.projectId}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") handleEditLabel(proj.projectId);
                                          if (e.key === "Escape") setEditingLabel(null);
                                        }}
                                        autoFocus
                                      />
                                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleEditLabel(proj.projectId)}>
                                        <Check className="w-3 h-3" />
                                      </Button>
                                    </div>
                                  ) : (
                                    <>
                                      <p className="text-sm font-medium truncate">
                                        {proj.label || proj.projectId}
                                        {proj.label && (
                                          <span className="ml-1.5 text-xs text-muted-foreground font-mono">
                                            {proj.projectId}
                                          </span>
                                        )}
                                      </p>
                                      {overview && (
                                        <p className="text-xs text-muted-foreground">
                                          {overview.taskCounts.total} tasks &middot; {overview.epicCount} epics
                                          {overview.error && (
                                            <span className="ml-1 text-destructive">({overview.error})</span>
                                          )}
                                        </p>
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {isActive && (
                                  <Badge variant="outline" className="text-[10px] mr-1">active</Badge>
                                )}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0"
                                  onClick={() => {
                                    setEditingLabel(proj.projectId);
                                    setEditLabelValue(proj.label ?? "");
                                  }}
                                >
                                  <Pencil className="w-3 h-3" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                                  onClick={() => setDeleteTarget({
                                    type: "project",
                                    baseUrl: proj.baseUrl,
                                    projectId: proj.projectId,
                                  })}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}

              {/* Add server section */}
              {showAddServer ? (
                <Card>
                  <CardContent className="py-4 space-y-4">
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-muted-foreground" />
                      <Label className="text-sm font-medium">Add GraphMemory Server</Label>
                    </div>

                    <div className="flex gap-2">
                      <Input
                        value={newServerUrl}
                        onChange={(e) => setNewServerUrl(e.target.value)}
                        placeholder="http://localhost:3000"
                        className="font-mono text-sm"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleProbeNewServer();
                        }}
                        autoFocus
                      />
                      <Button
                        variant="secondary"
                        onClick={handleProbeNewServer}
                        disabled={probing || !newServerUrl.trim()}
                        className="shrink-0 gap-1.5"
                      >
                        {probing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        {probing ? "Probing..." : "Probe"}
                      </Button>
                    </div>

                    {/* Discovered projects */}
                    {discoveredProjects.length > 0 && (
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">
                          Select projects to add ({selectedNewProjects.size}/{discoveredProjects.length}):
                        </Label>
                        {discoveredProjects.map((p) => {
                          const selected = selectedNewProjects.has(p.id);
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => {
                                setSelectedNewProjects((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(p.id)) next.delete(p.id);
                                  else next.add(p.id);
                                  return next;
                                });
                              }}
                              className={`w-full flex items-center justify-between px-3 py-2 rounded-md border text-sm transition-colors ${
                                selected
                                  ? "border-primary bg-primary/10"
                                  : "border-border hover:bg-muted/50"
                              }`}
                            >
                              <span className="font-mono">{p.id}</span>
                              <span className="text-xs text-muted-foreground">
                                {p.taskCount} tasks &middot; {p.epicCount} epics
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setShowAddServer(false);
                          setNewServerUrl("");
                          setDiscoveredProjects([]);
                          setSelectedNewProjects(new Set());
                        }}
                      >
                        Cancel
                      </Button>
                      {discoveredProjects.length > 0 && (
                        <Button
                          onClick={handleAddServerConfirm}
                          disabled={saving || selectedNewProjects.size === 0}
                          className="gap-1.5"
                        >
                          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                          Add {selectedNewProjects.size} project{selectedNewProjects.size !== 1 ? "s" : ""}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => setShowAddServer(true)}
                  className="w-full gap-2"
                >
                  <Plus className="w-4 h-4" /> Add server
                </Button>
              )}
            </TabsContent>

            {/* ─── Config Tab ────────────────────────────────────────── */}
            <TabsContent value="config" className="space-y-4 pt-4">
              <Card>
                <CardContent className="space-y-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs">Concurrency</Label>
                      <Input
                        type="number"
                        min={1}
                        max={10}
                        value={config.concurrency}
                        onChange={(e) => updateConfigField("concurrency", parseInt(e.target.value, 10) || 1)}
                        className="font-mono text-sm"
                      />
                      <p className="text-[10px] text-muted-foreground">Max parallel Claude sessions</p>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Timeout (min)</Label>
                      <Input
                        type="number"
                        min={1}
                        max={1440}
                        value={Math.round(config.timeoutMs / 60000)}
                        onChange={(e) => updateConfigField("timeoutMs", (parseInt(e.target.value, 10) || 15) * 60000)}
                        className="font-mono text-sm"
                      />
                      <p className="text-[10px] text-muted-foreground">Per-task timeout</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs">Pause between tasks (s)</Label>
                      <Input
                        type="number"
                        min={0}
                        max={60}
                        value={Math.round(config.pauseMs / 1000)}
                        onChange={(e) => updateConfigField("pauseMs", (parseInt(e.target.value, 10) || 0) * 1000)}
                        className="font-mono text-sm"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Max retries</Label>
                      <Input
                        type="number"
                        min={0}
                        max={10}
                        value={config.maxRetries}
                        onChange={(e) => updateConfigField("maxRetries", parseInt(e.target.value, 10) || 0)}
                        className="font-mono text-sm"
                      />
                    </div>
                  </div>

                  <Separator />

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs">Max turns per task</Label>
                      <Input
                        type="number"
                        min={1}
                        max={1000}
                        value={config.maxTurns}
                        onChange={(e) => updateConfigField("maxTurns", parseInt(e.target.value, 10) || 200)}
                        className="font-mono text-sm"
                      />
                      <p className="text-[10px] text-muted-foreground">Agent SDK max turns</p>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Agent timeout (s)</Label>
                      <Input
                        type="number"
                        min={10}
                        max={3600}
                        value={Math.round(config.agentTimeoutMs / 1000)}
                        onChange={(e) => updateConfigField("agentTimeoutMs", (parseInt(e.target.value, 10) || 120) * 1000)}
                        className="font-mono text-sm"
                      />
                      <p className="text-[10px] text-muted-foreground">Per-turn timeout</p>
                    </div>
                  </div>

                  <Separator />

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Dry run</p>
                      <p className="text-xs text-muted-foreground">Simulate runs without executing Claude</p>
                    </div>
                    <Switch
                      checked={config.dryRun}
                      onCheckedChange={(v) => updateConfigField("dryRun", v)}
                    />
                  </div>

                  {version && (
                    <>
                      <Separator />
                      <p className="text-xs text-muted-foreground">
                        gm-orchestrator <span className="font-mono">v{version}</span>
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>

              <div className="flex justify-end">
                <Button onClick={handleSaveConfig} disabled={saving} className="gap-2">
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
                    <PermRow label="Write files" description="Create and modify files" checked={permissions.writeFiles} onChange={(v) => setPermissions((p) => ({ ...p, writeFiles: v }))} />
                    <PermRow label="Run tests" description="npm test, pytest, etc." checked={permissions.runTests} onChange={(v) => setPermissions((p) => ({ ...p, runTests: v }))} />
                    <PermRow label="Git commit" description="Stage and commit changes" checked={permissions.gitCommit} onChange={(v) => setPermissions((p) => ({ ...p, gitCommit: v }))} />
                    <PermRow label="Git push" description="Push to remote repository" checked={permissions.gitPush} onChange={(v) => setPermissions((p) => ({ ...p, gitPush: v }))} />
                    <PermRow label="npm publish" description="Publish packages to registry" checked={permissions.npmPublish} onChange={(v) => setPermissions((p) => ({ ...p, npmPublish: v }))} />
                  </div>

                  <div className="space-y-2 mt-4">
                    <Label className="text-xs">Custom command whitelist (comma-separated)</Label>
                    <Input
                      value={permissions.customCommands}
                      onChange={(e) => setPermissions((p) => ({ ...p, customCommands: e.target.value }))}
                      placeholder="e.g. make build, cargo test"
                      className="font-mono text-sm"
                    />
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-end">
                <Button onClick={handleSavePermissions} disabled={saving} className="gap-2">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save
                </Button>
              </div>
            </TabsContent>

            {/* ─── Notifications Tab ──────────────────────────────────── */}
            <TabsContent value="notifications" className="space-y-4 pt-4">
              <Card>
                <CardContent className="py-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">Telegram</Label>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleTestNotification("telegram")}
                      disabled={testingNotification === "telegram" || !notifications.telegramBotToken || !notifications.telegramChatId}
                      className="text-xs"
                    >
                      {testingNotification === "telegram" ? "Sending..." : "Send test"}
                    </Button>
                  </div>
                  <Input
                    value={notifications.telegramBotToken}
                    onChange={(e) => setNotifications((n) => ({ ...n, telegramBotToken: e.target.value }))}
                    placeholder="Bot token"
                    className="font-mono text-sm"
                  />
                  <Input
                    value={notifications.telegramChatId}
                    onChange={(e) => setNotifications((n) => ({ ...n, telegramChatId: e.target.value }))}
                    placeholder="Chat ID"
                    className="font-mono text-sm"
                  />
                </CardContent>
              </Card>

              <Card>
                <CardContent className="py-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">Webhook</Label>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleTestNotification("webhook")}
                      disabled={testingNotification === "webhook" || !notifications.webhookUrl}
                      className="text-xs"
                    >
                      {testingNotification === "webhook" ? "Sending..." : "Send test"}
                    </Button>
                  </div>
                  <Input
                    value={notifications.webhookUrl}
                    onChange={(e) => setNotifications((n) => ({ ...n, webhookUrl: e.target.value }))}
                    placeholder="https://example.com/webhook"
                    className="font-mono text-sm"
                  />
                  <Input
                    value={notifications.webhookHeaders}
                    onChange={(e) => setNotifications((n) => ({ ...n, webhookHeaders: e.target.value }))}
                    placeholder='Headers JSON: {"Authorization": "Bearer ..."}'
                    className="font-mono text-sm"
                  />
                </CardContent>
              </Card>

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
                        disabled={testingNotification === "desktop" || !notifications.desktopNotifications}
                        className="text-xs"
                      >
                        {testingNotification === "desktop" ? "Sending..." : "Send test"}
                      </Button>
                      <Switch
                        checked={notifications.desktopNotifications}
                        onCheckedChange={(v) => setNotifications((n) => ({ ...n, desktopNotifications: v }))}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-end">
                <Button onClick={handleSaveNotifications} disabled={saving} className="gap-2">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {deleteTarget?.type === "server" ? "Remove server" : "Remove project"}
            </DialogTitle>
            <DialogDescription>
              {deleteTarget?.type === "server"
                ? `This will remove the server at ${deleteTarget.baseUrl} and all its projects from the configuration.`
                : `This will remove project "${deleteTarget?.projectId}" from the configuration.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!deleteTarget) return;
                if (deleteTarget.type === "server") {
                  handleRemoveServer(deleteTarget.baseUrl);
                } else if (deleteTarget.projectId) {
                  handleRemoveProject(deleteTarget.baseUrl, deleteTarget.projectId);
                }
              }}
              disabled={saving}
              className="gap-1.5"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Shell>
  );
}
