#!/usr/bin/env node
import { GraphMemoryClient } from '../infra/gm-client.js';
import { ClaudeRunner } from '../infra/claude-runner.js';
import { TaskPoller } from '../infra/task-poller.js';
import { consoleLogger } from '../infra/logger.js';
import { loadConfig, validateConfig } from '../infra/config.js';
import { runSprint, runEpic } from '../core/orchestrator.js';
import type { OrchestratorConfig } from '../core/types.js';

// ── Arg parsing ───────────────────────────────────────────────────────────

interface ParsedArgs {
  command: string | null;
  epicId: string | null;
  overrides: Partial<OrchestratorConfig>;
  printConfig: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const result: ParsedArgs = {
    command: null,
    epicId: null,
    overrides: {},
    printConfig: false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!result.command && !a.startsWith('-')) { result.command = a; continue; }
    if (result.command === 'epic' && !result.epicId && !a.startsWith('-')) { result.epicId = a; continue; }

    switch (a) {
      case '--dry-run': result.overrides.dryRun = true; break;
      case '--config': result.printConfig = true; break;
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
  gm-orchestrator <command> [options]

COMMANDS
  sprint               Run all todo/in_progress tasks sorted by priority
  epic <epicId>        Run all tasks in an epic
  status               Show task counts (no Claude sessions spawned)

OPTIONS
  --project, -p <id>   GraphMemory project ID  (or GM_PROJECT_ID env)
  --tag, -t <tag>      Filter tasks by tag
  --timeout <min>      Per-task timeout in minutes (default: 15)
  --retries <n>        Retries on timeout/error (default: 1)
  --dry-run            Preview prompts, don't spawn Claude
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
  const { command, epicId, overrides, printConfig } = parseArgs(process.argv);
  const config = loadConfig(overrides);

  if (printConfig) {
    const display = { ...config, apiKey: config.apiKey ? '***' : undefined };
    console.log(JSON.stringify(display, null, 2));
    return;
  }

  if (!command || command === 'help') { printHelp(); return; }

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

  if (command === 'status') {
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

  if (command === 'sprint') {
    await runSprint(ports, config);
    return;
  }

  if (command === 'epic') {
    if (!epicId) {
      consoleLogger.error('epic command requires an ID: gm-orchestrator epic <epicId>');
      process.exit(1);
    }
    await runEpic(epicId, ports, config);
    return;
  }

  consoleLogger.error(`Unknown command: ${command}`);
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
