import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Play,
  Settings,
  Square,
  Wand2,
  Search,
} from "lucide-react";
import {
  CommandDialog,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import type { Task, Epic } from "../types";

interface CommandPaletteProps {
  projectId: string | null;
  isRunning: boolean;
  onStartSprint: () => void;
  onStop: () => void;
  tasks: Task[];
  epics: Epic[];
  onStartEpic: (epicId: string) => void;
}

export default function CommandPalette({
  projectId,
  isRunning,
  onStartSprint,
  onStop,
  tasks,
  epics,
  onStartEpic,
}: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  // Global Cmd+K / Ctrl+K listener
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const runAction = useCallback(
    (fn: () => void) => {
      fn();
      setOpen(false);
    },
    []
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <Command>
        <CommandInput placeholder="Type a command or search..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>

          {/* Navigation */}
          <CommandGroup heading="Navigation">
            <CommandItem onSelect={() => runAction(() => navigate("/dashboard"))}>
              <LayoutDashboard className="w-4 h-4" />
              <span>View Dashboard</span>
            </CommandItem>
            <CommandItem onSelect={() => runAction(() => navigate("/sprint"))}>
              <Play className="w-4 h-4" />
              <span>View Run</span>
            </CommandItem>
            <CommandItem onSelect={() => runAction(() => navigate("/settings"))}>
              <Settings className="w-4 h-4" />
              <span>Open Settings</span>
            </CommandItem>
            <CommandItem onSelect={() => runAction(() => navigate("/wizard"))}>
              <Wand2 className="w-4 h-4" />
              <span>Setup Wizard</span>
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />

          {/* Actions */}
          <CommandGroup heading="Actions">
            {!isRunning && projectId && (
              <CommandItem onSelect={() => runAction(onStartSprint)}>
                <Play className="w-4 h-4 text-primary" />
                <span>Run All Tasks</span>
                <CommandShortcut>run</CommandShortcut>
              </CommandItem>
            )}
            {isRunning && (
              <CommandItem onSelect={() => runAction(onStop)}>
                <Square className="w-4 h-4 text-destructive" />
                <span>Stop Current Run</span>
                <CommandShortcut>stop</CommandShortcut>
              </CommandItem>
            )}
          </CommandGroup>

          {/* Epics */}
          {epics.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Run Epic">
                {epics.map((epic) => (
                  <CommandItem
                    key={epic.id}
                    onSelect={() => runAction(() => onStartEpic(epic.id))}
                    disabled={isRunning}
                  >
                    <Play className="w-4 h-4 text-primary" />
                    <span>{epic.title}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          {/* Task search */}
          {tasks.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Tasks">
                {tasks.map((task) => (
                  <CommandItem
                    key={task.id}
                    onSelect={() => setOpen(false)}
                  >
                    <Search className="w-4 h-4 text-muted-foreground" />
                    <span className="truncate">{task.title}</span>
                    <CommandShortcut>{task.status}</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
