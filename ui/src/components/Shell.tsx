import { useLocation, Link } from "react-router-dom";
import { LayoutDashboard, Play, Settings, Hexagon, Command } from "lucide-react";
import { Separator } from "@/components/ui/separator";

const NAV_ITEMS = [
  { path: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { path: "/sprint", label: "Run", icon: Play },
  { path: "/settings", label: "Settings", icon: Settings },
] as const;

interface ShellProps {
  projectId: string | null;
  taskCount: number;
  children: React.ReactNode;
}

export default function Shell({ projectId, taskCount, children }: ShellProps) {
  const location = useLocation();

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 bg-card border-r border-border flex flex-col">
        {/* Logo */}
        <div className="px-4 py-5 flex items-center gap-2">
          <Hexagon className="w-5 h-5 text-primary" strokeWidth={1.5} />
          <span className="font-mono text-sm font-semibold">gm-orchestrator</span>
        </div>

        <Separator />

        {/* Nav */}
        <nav className="flex-1 py-3">
          {NAV_ITEMS.map(({ path, label, icon: Icon }) => {
            const active = location.pathname === path;
            return (
              <Link
                key={path}
                to={path}
                className={`flex items-center gap-3 px-4 py-2 text-sm transition-colors ${
                  active
                    ? "border-l-2 border-primary bg-muted text-foreground font-medium"
                    : "border-l-2 border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </Link>
            );
          })}
        </nav>

        <Separator />

        {/* Bottom: project info + Cmd+K hint */}
        <div className="px-4 py-4 space-y-2">
          {projectId && (
            <div>
              <p className="text-xs font-mono font-medium truncate">{projectId}</p>
              <p className="text-[10px] text-muted-foreground">{taskCount} tasks</p>
            </div>
          )}
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Command className="w-3 h-3" />
            <span>Cmd+K</span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}
