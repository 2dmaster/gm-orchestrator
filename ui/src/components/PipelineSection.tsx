import { useState } from "react";
import { Play, Square, ChevronDown, ChevronRight, ArrowRight, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { Pipeline, PipelineRun, PipelineStageStatus } from "../types";

interface PipelineSectionProps {
  pipelines: Pipeline[];
  pipelineRuns: PipelineRun[];
  onStart: (pipelineId: string) => Promise<void>;
  onStop: (pipelineRunId: string) => Promise<void>;
}

const STAGE_STATUS_COLORS: Record<PipelineStageStatus, string> = {
  queued: "bg-muted text-muted-foreground",
  running: "bg-primary/20 text-primary border-primary/40",
  done: "bg-green-500/15 text-green-400 border-green-500/40",
  failed: "bg-red-500/15 text-red-400 border-red-500/40",
  cancelled: "bg-muted text-muted-foreground border-muted",
};

const RUN_STATUS_COLORS: Record<string, string> = {
  running: "text-primary",
  done: "text-green-400",
  failed: "text-red-400",
  cancelled: "text-muted-foreground",
};

function StageNode({
  stageId,
  status,
}: {
  stageId: string;
  status?: PipelineStageStatus;
}) {
  const s = status ?? "queued";
  return (
    <div
      className={`px-3 py-1.5 rounded-md border text-xs font-medium ${STAGE_STATUS_COLORS[s]} ${
        s === "running" ? "animate-pulse" : ""
      }`}
    >
      {stageId}
    </div>
  );
}

function PipelineDAG({
  pipeline,
  run,
}: {
  pipeline: Pipeline;
  run?: PipelineRun;
}) {
  // Build topological layers for horizontal layout
  const stages = pipeline.stages;
  // Calculate layers via BFS from roots
  const layers: string[][] = [];
  const stageLayer = new Map<string, number>();
  const roots = stages.filter((s) => !s.after?.length);

  // Assign layers
  for (const root of roots) {
    stageLayer.set(root.id, 0);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const stage of stages) {
      if (stageLayer.has(stage.id)) continue;
      const deps = stage.after ?? [];
      if (deps.every((d) => stageLayer.has(d))) {
        const maxDepLayer = Math.max(...deps.map((d) => stageLayer.get(d) ?? 0));
        stageLayer.set(stage.id, maxDepLayer + 1);
        changed = true;
      }
    }
  }

  // Group by layer
  for (const [id, layer] of stageLayer) {
    while (layers.length <= layer) layers.push([]);
    layers[layer]!.push(id);
  }

  // Get stage run status
  const stageStatus = new Map<string, PipelineStageStatus>();
  if (run) {
    for (const sr of run.stages) {
      stageStatus.set(sr.stageId, sr.status);
    }
  }

  return (
    <div className="flex items-center gap-2 overflow-x-auto py-2">
      {layers.map((layer, i) => (
        <div key={i} className="flex flex-col gap-1.5 items-center">
          {layer.map((stageId) => (
            <StageNode
              key={stageId}
              stageId={stageId}
              status={stageStatus.get(stageId)}
            />
          ))}
          {i < layers.length - 1 && (
            <div className="absolute" style={{ display: "none" }} />
          )}
        </div>
      ))}
      {/* Arrows between layers */}
      {layers.length > 1 &&
        layers.slice(0, -1).map((_, i) => (
          <ArrowRight
            key={`arrow-${i}`}
            className="w-3.5 h-3.5 text-muted-foreground shrink-0"
            style={{ order: i * 2 + 1 }}
          />
        ))}
    </div>
  );
}

function PipelineCard({
  pipeline,
  runs,
  onStart,
  onStop,
}: {
  pipeline: Pipeline;
  runs: PipelineRun[];
  onStart: (pipelineId: string) => Promise<void>;
  onStop: (pipelineRunId: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [starting, setStarting] = useState(false);

  const activeRun = runs.find(
    (r) => r.pipelineId === pipeline.id && r.status === "running"
  );
  const isRunning = !!activeRun;

  const handleStart = async () => {
    setStarting(true);
    try {
      await onStart(pipeline.id);
      toast.success(`Pipeline "${pipeline.name}" started`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    if (!activeRun) return;
    try {
      await onStop(activeRun.id);
      toast.success(`Pipeline "${pipeline.name}" stopped`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between">
          <button
            type="button"
            className="flex items-center gap-2 min-w-0"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            )}
            <CardTitle className="text-sm font-medium truncate">
              {pipeline.name}
            </CardTitle>
            <Badge variant="outline" className="text-xs shrink-0">
              {pipeline.stages.length} stage{pipeline.stages.length !== 1 ? "s" : ""}
            </Badge>
            {isRunning && (
              <Badge variant="outline" className={`text-xs shrink-0 ${RUN_STATUS_COLORS["running"]}`}>
                running
              </Badge>
            )}
          </button>

          <div className="flex items-center gap-1.5 shrink-0">
            {isRunning ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-red-400 hover:text-red-300"
                onClick={handleStop}
              >
                <Square className="w-3.5 h-3.5 mr-1" />
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-primary hover:text-primary/80"
                onClick={handleStart}
                disabled={starting}
              >
                {starting ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5 mr-1" />
                )}
                Run
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 px-4 pb-3">
          <PipelineDAG pipeline={pipeline} run={activeRun} />

          {/* Stage details */}
          <div className="mt-3 space-y-1">
            {pipeline.stages.map((stage) => {
              const stageRun = activeRun?.stages.find(
                (s) => s.stageId === stage.id
              );
              return (
                <div
                  key={stage.id}
                  className="flex items-center gap-2 text-xs text-muted-foreground"
                >
                  <span className="font-mono w-24 truncate">{stage.id}</span>
                  <span className="text-muted-foreground/60">
                    {stage.projectId}/{stage.epicId}
                  </span>
                  {stage.after?.length ? (
                    <span className="text-muted-foreground/40">
                      after: {stage.after.join(", ")}
                    </span>
                  ) : null}
                  {stageRun && (
                    <Badge
                      variant="outline"
                      className={`text-[10px] ml-auto ${STAGE_STATUS_COLORS[stageRun.status]}`}
                    >
                      {stageRun.status}
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

export default function PipelineSection({
  pipelines,
  pipelineRuns,
  onStart,
  onStop,
}: PipelineSectionProps) {
  if (pipelines.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">Pipelines</h2>
      {pipelines.map((pipeline) => (
        <PipelineCard
          key={pipeline.id}
          pipeline={pipeline}
          runs={pipelineRuns}
          onStart={onStart}
          onStop={onStop}
        />
      ))}
    </div>
  );
}
