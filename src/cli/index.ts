#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { GraphMemoryClient } from '../infra/gm-client.js';
import { GraphMemoryClientPool } from '../infra/gm-client-pool.js';
import { ClaudeRunner } from '../infra/claude-runner.js';
import { TaskPoller } from '../infra/task-poller.js';
import { consoleLogger } from '../infra/logger.js';
import { loadConfig, validateConfig, saveConfig } from '../infra/config.js';
import { runSprint, runEpic } from '../core/orchestrator.js';
import { createServer } from '../server/index.js';
import { createApiRouter } from '../server/api.js';
import { createWebSocketServer } from '../server/ws.js';
import { createRunnerService } from '../server/runner-service.js';
import { discoverServers } from '../infra/gm-discovery.js';
import type { OrchestratorConfig } from '../core/types.js';
import { getActiveProject } from '../core/types.js';

// Read version from package.json once at startup
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8')) as { version: string };
const APP_VERSION = packageJson.version;

// ── Arg parsing ───────────────────────────────────────────────────────────

interface ParsedArgs {
  command: string | null;
  epicId: string | null;
  overrides: Partial<OrchestratorConfig> & { configPath?: string };
  printConfig: boolean;
  headless: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const result: ParsedArgs = {
    command: null,
    epicId: null,
    overrides: {},
    printConfig: false,
    headless: false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!result.command && !a.startsWith('-')) { result.command = a; continue; }
    if (result.command === 'epic' && !result.epicId && !a.startsWith('-')) { result.epicId = a; continue; }

    switch (a) {
      case '--dry-run': result.overrides.dryRun = true; break;
      case '--config': result.printConfig = true; break;
      case '--headless': result.headless = true; break;
      case '--help': case '-h': printHelp(); process.exit(0); break;
      case '--config-path': result.overrides.configPath = args[++i]!; break;
      case '--project': case '-p': {
        const pid = args[++i]!;
        result.overrides.activeProjectId = pid;
        // Will be merged into projects array by loadConfig/mergeConfigs
        if (!result.overrides.projects) result.overrides.projects = [];
        const existing = result.overrides.projects.find((p) => p.projectId === pid);
        if (!existing) result.overrides.projects.push({ baseUrl: 'http://localhost:3000', projectId: pid });
        break;
      }
      case '--tag': case '-t': result.overrides.tag = args[++i]!; break;
      case '--timeout': result.overrides.timeoutMs = Number(args[++i]!) * 60_000; break;
      case '--retries': result.overrides.maxRetries = Number(args[++i]!); break;
    }
  }

  return result;
}

function printHelp(): void {
  console.log(`
gm-orchestrator — tokenless Claude Code orchestrator for GraphMemory

USAGE
  gm-orchestrator [command] [options]

COMMANDS
  serve                Start the web UI + API server on :4242 (default)
  sprint               Run all todo/in_progress tasks sorted by priority
  epic <epicId>        Run all tasks in an epic
  status               Show task counts (no Claude sessions spawned)

OPTIONS
  --project, -p <id>   GraphMemory project ID  (or GM_PROJECT_ID env)
  --tag, -t <tag>      Filter tasks by tag
  --timeout <min>      Per-task timeout in minutes (default: 15)
  --retries <n>        Retries on timeout/error (default: 1)
  --dry-run            Preview prompts, don't spawn Claude
  --headless           Run in CLI-only mode (skip server, require command)
  --config             Print resolved config and exit
  --config-path <path> Explicit path to config JSON file

CONFIG FILE  (.gm-orchestrator.json)
  {
    "projects": [
      { "baseUrl": "http://localhost:3000", "projectId": "my-app", "label": "My App" }
    ],
    "activeProjectId": "my-app",
    "concurrency": 1,
    "timeoutMs": 900000,
    "maxRetries": 1,
    "claudeArgs": []
  }

  Legacy format (auto-migrated):
  { "baseUrl": "http://localhost:3000", "projectId": "my-app" }

ENV VARS
  GM_BASE_URL / GM_PROJECT_ID / GM_API_KEY / GM_TIMEOUT_MS
`);
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { command, epicId, overrides, printConfig, headless } = parseArgs(process.argv);
  const config = loadConfig(overrides);

  if (printConfig) {
    const display = {
      ...config,
      projects: config.projects.map(({ apiKey, ...rest }) => ({ ...rest, ...(apiKey ? { apiKey: '***' } : {}) })),
    };
    console.log(JSON.stringify(display, null, 2));
    return;
  }

  if (command === 'help') { printHelp(); return; }

  // Default to server mode when no command given (unless --headless)
  const effectiveCommand = command ?? (headless ? null : 'serve');

  if (!effectiveCommand) { printHelp(); return; }

  if (effectiveCommand === 'serve') {
    const port = Number(process.env['GM_PORT']) || 4242;
    consoleLogger.info(`gm-orchestrator v1.0.0 → http://localhost:${port}`);

    // Server mode doesn't require projectId upfront — it's set via the UI
    const { app, start, mountStaticUI } = createServer({ logger: consoleLogger });

    // Init pool from all configured projects
    const gmPool = new GraphMemoryClientPool(config.projects);

    const active = getActiveProject(config);
    const gmClient = new GraphMemoryClient({
      baseUrl: active?.baseUrl ?? 'http://localhost:3000',
      projectId: active?.projectId ?? '',
      ...(active?.apiKey !== undefined && { apiKey: active.apiKey }),
    });

    // Create a no-op WS bus for now — replaced after server starts
    const wsBusHolder: { current: import('../server/ws.js').WebSocketBus } = {
      current: { broadcast() {}, get clientCount() { return 0; }, close: async () => {} },
    };

    const runner = createRunnerService({
      config,
      gm: gmClient,
      runner: new ClaudeRunner(),
      poller: new TaskPoller(gmClient),
      logger: consoleLogger,
      wsBus: { broadcast(e) { wsBusHolder.current.broadcast(e); }, get clientCount() { return wsBusHolder.current.clientCount; }, close() { return wsBusHolder.current.close(); } },
      resolveGm: (projectId) => gmPool.has(projectId) ? gmPool.getClient(projectId) : gmClient,
      resolvePoller: (projectId) => new TaskPoller(gmPool.has(projectId) ? gmPool.getClient(projectId) : gmClient),
      saveConfig: (partial) => saveConfig(partial),
    });

    const apiRouter = createApiRouter({
      config,
      logger: consoleLogger,
      gmDiscovery: { discoverServers },
      gmClient,
      gmPool,
      runner,
      saveConfig: (partial) => saveConfig(partial),
      version: APP_VERSION,
    });

    // Mount API routes before the catch-all static handler
    app.use(apiRouter);
    mountStaticUI();

    const server = await start();
    wsBusHolder.current = createWebSocketServer(server);

    return;
  }

  validateConfig(config);

  const activeProj = getActiveProject(config);
  const gm = new GraphMemoryClient({
    baseUrl: activeProj?.baseUrl ?? 'http://localhost:3000',
    projectId: activeProj?.projectId ?? '',
    ...(activeProj?.apiKey !== undefined && { apiKey: activeProj.apiKey }),
  });

  const ports = {
    gm,
    runner: new ClaudeRunner(),
    poller: new TaskPoller(gm),
    logger: consoleLogger,
  };

  if (effectiveCommand === 'status') {
    const [todo, inProgress, done] = await Promise.all([
      gm.listTasks({ status: 'todo' }),
      gm.listTasks({ status: 'in_progress' }),
      gm.listTasks({ status: 'done' }),
    ]);
    const epics = await gm.listEpics().catch(() => []);

    consoleLogger.section(`Status — ${activeProj?.projectId ?? '(none)'}`);
    console.log(`  todo:        ${todo.length}`);
    console.log(`  in_progress: ${inProgress.length}`);
    console.log(`  done:        ${done.length}`);
    console.log(`  epics:       ${epics.length}`);

    if (todo.length) {
      consoleLogger.section('Next up');
      todo.slice(0, 5).forEach((t) => consoleLogger.task(t));
      if (todo.length > 5) console.log(`  ... and ${todo.length - 5} more`);
    }
    return;
  }

  if (effectiveCommand === 'sprint') {
    await runSprint(ports, config);
    return;
  }

  if (effectiveCommand === 'epic') {
    if (!epicId) {
      consoleLogger.error('epic command requires an ID: gm-orchestrator epic <epicId>');
      process.exit(1);
    }
    await runEpic(epicId, ports, config);
    return;
  }

  consoleLogger.error(`Unknown command: ${effectiveCommand}`);
  printHelp();
  process.exit(1);
}

process.on('SIGINT', () => {
  console.log('');
  consoleLogger.warn('Interrupted — current Claude session may still be running');
  consoleLogger.skip('Check GraphMemory UI for task status before resuming');
  process.exit(0);
});

process.on('unhandledRejection', (err) => {
  consoleLogger.error(`Unhandled: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

void main();
