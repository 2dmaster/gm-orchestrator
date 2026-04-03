import { useState, useEffect, useCallback } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { useWebSocket } from "./hooks/useWebSocket";
import { useTasks } from "./hooks/useTasks";
import { useOrchestrator } from "./hooks/useOrchestrator";
import CommandPalette from "./components/CommandPalette";
import Wizard from "./pages/Wizard";
import Dashboard from "./pages/Dashboard";
import Sprint from "./pages/Sprint";
import Settings from "./pages/Settings";
import type { Epic } from "./types";

function AppInner() {
  const navigate = useNavigate();
  const ws = useWebSocket();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [epics, setEpics] = useState<Epic[]>([]);
  const orchestrator = useOrchestrator(ws);
  const { tasks } = useTasks(projectId, ws);

  // Fetch project ID on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/status");
        if (!res.ok) return;
        const data = await res.json();
        if (data.config?.activeProjectId) {
          setProjectId(data.config.activeProjectId);
        }
      } catch {
        // Server not ready
      }
    })();
  }, []);

  // Fetch epics when projectId is available
  useEffect(() => {
    if (!projectId) return;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/epics`);
        if (!res.ok) return;
        const data = (await res.json()) as { epics: Epic[] };
        setEpics(data.epics);
      } catch {
        // non-critical
      }
    })();
  }, [projectId]);

  const handleStartSprint = useCallback(async () => {
    if (!projectId) return;
    try {
      await orchestrator.startSprint(projectId);
      navigate("/sprint");
    } catch (err) {
      toast.error((err as Error).message);
    }
  }, [projectId, orchestrator, navigate]);

  const handleStartEpic = useCallback(
    async (epicId: string) => {
      if (!projectId) return;
      try {
        await orchestrator.startEpic(projectId, epicId);
        navigate("/sprint");
      } catch (err) {
        toast.error((err as Error).message);
      }
    },
    [projectId, orchestrator, navigate]
  );

  const handleStop = useCallback(async () => {
    try {
      await orchestrator.stop();
      toast.success("Run stopped");
    } catch (err) {
      toast.error((err as Error).message);
    }
  }, [orchestrator]);

  return (
    <>
      <CommandPalette
        projectId={projectId}
        isRunning={orchestrator.isRunning}
        onStartSprint={handleStartSprint}
        onStop={handleStop}
        tasks={tasks}
        epics={epics}
        onStartEpic={handleStartEpic}
      />
      <Routes>
        <Route path="/" element={<Wizard />} />
        <Route path="/wizard" element={<Wizard />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/sprint" element={<Sprint />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
      <Toaster richColors position="bottom-right" />
    </>
  );
}

export default function App() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppInner />
    </div>
  );
}
