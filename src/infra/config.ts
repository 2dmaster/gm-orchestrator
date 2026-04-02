import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { OrchestratorConfig } from '../core/types.js';

const CONFIG_FILE = '.gm-orchestrator.json';

const DEFAULTS: OrchestratorConfig = {
  baseUrl: 'http://localhost:3000',
  projectId: '',
  timeoutMs: 15 * 60 * 1000,
  pauseMs: 2_000,
  maxRetries: 1,
  claudeArgs: [],
  dryRun: false,
};

export function loadConfig(overrides: Partial<OrchestratorConfig> = {}): OrchestratorConfig {
  const fileConfig = readFileConfig();
  const envConfig = readEnvConfig();
  return { ...DEFAULTS, ...fileConfig, ...envConfig, ...overrides };
}

export function validateConfig(config: OrchestratorConfig): asserts config is OrchestratorConfig & { projectId: string } {
  const errors: string[] = [];

  if (!config.projectId) {
    errors.push(
      'projectId is required.\n' +
      '  Options: --project <id>  |  GM_PROJECT_ID env  |  .gm-orchestrator.json'
    );
  }

  if (config.timeoutMs < 10_000) {
    errors.push('timeoutMs must be at least 10000 (10 seconds)');
  }

  if (errors.length) {
    errors.forEach((e) => console.error(`❌ ${e}`));
    process.exit(1);
  }
}

export function saveConfig(config: Partial<OrchestratorConfig>): void {
  const path = resolve(process.cwd(), CONFIG_FILE);
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

// ── Readers ───────────────────────────────────────────────────────────────

function readFileConfig(): Partial<OrchestratorConfig> {
  const path = resolve(process.cwd(), CONFIG_FILE);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Partial<OrchestratorConfig>;
  } catch {
    console.warn(`Warning: could not parse ${CONFIG_FILE}`);
    return {};
  }
}

function readEnvConfig(): Partial<OrchestratorConfig> {
  const cfg: Partial<OrchestratorConfig> = {};
  if (process.env['GM_BASE_URL']) cfg.baseUrl = process.env['GM_BASE_URL'];
  if (process.env['GM_PROJECT_ID']) cfg.projectId = process.env['GM_PROJECT_ID'];
  if (process.env['GM_API_KEY']) cfg.apiKey = process.env['GM_API_KEY'];
  if (process.env['GM_TIMEOUT_MS']) cfg.timeoutMs = Number(process.env['GM_TIMEOUT_MS']);
  return cfg;
}
