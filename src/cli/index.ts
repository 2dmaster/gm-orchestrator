#!/usr/bin/env node
import { GraphMemoryClient } from '../infra/gm-client.js';
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

// ── Arg parsing ───────────────────────────────────────────────────────────

interface ParsedArgs {
  command: string | null;
  epicId: string | null;
  overrides: Partial<OrchestratorConfig>;
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
      case '--project': case '-p': result.overrides.projectId = args[++i]!; break;
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

CONFIG FILE  (.gm-orchestrator.json)
  {
    "baseUrl": "http://localhost:3000",
    "projectId": "my-app",
    "apiKey": "mgm-key-...",
    "timeoutMs": 900000,
    "maxRetries": 1,
    "claudeArgs": []
  }

ENV VARS
  GM_BASE_URL / GM_PROJECT_ID / GM_API_KEY / GM_TIMEOUT_MS
`);
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { command, epicId, overrides, printConfig, headless } = parseArgs(process.argv);
  const config = loadConfig(overrides);

  if (printConfig) {
    const display = { ...config, apiKey: config.apiKey ? '***' : undefined };
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

    const gmClient = new GraphMemoryClient({
      baseUrl: config.baseUrl,
      projectId: config.projectId || 'default',
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
    });

    const apiRouter = createApiRouter({
      config,
      logger: consoleLogger,
      gmDiscovery: { discoverServers },
      gmClient,
      runner,
      saveConfig: (partial) => saveConfig(partial),
    });

    // Mount API routes before the catch-all static handler
    app.use(apiRouter);
    mountStaticUI();

    const server = await start();
    wsBusHolder.current = createWebSocketServer(server);

    return;
  }

  validateConfig(config);

  const gm = new GraphMemoryClient({
    baseUrl: config.baseUrl,
    projectId: config.projectId,
    ...(config.apiKey !== undefined && { apiKey: config.apiKey }),
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

    consoleLogger.section(`Status — ${config.projectId}`);
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
