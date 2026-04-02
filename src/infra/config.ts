import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import { homedir } from 'os';
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

/**
 * Returns the user-level config directory: ~/.config/gm-orchestrator/
 */
export function getUserConfigDir(): string {
  const xdg = process.env['XDG_CONFIG_HOME'];
  const base = xdg || join(homedir(), '.config');
  return join(base, 'gm-orchestrator');
}

/**
 * Returns the user-level config file path.
 */
export function getUserConfigPath(): string {
  return join(getUserConfigDir(), 'config.json');
}

export function loadConfig(overrides: Partial<OrchestratorConfig> & { configPath?: string } = {}): OrchestratorConfig {
  const { configPath, ...rest } = overrides;
  const fileConfig = readFileConfig(configPath);
  const envConfig = readEnvConfig();
  return { ...DEFAULTS, ...fileConfig, ...envConfig, ...rest };
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

export function saveConfig(config: Partial<OrchestratorConfig>, configPath?: string): void {
  const path = configPath ?? getUserConfigPath();
  const dir = resolve(path, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

// ── Readers ───────────────────────────────────────────────────────────────

/**
 * Reads config from (in priority order):
 * 1. Explicit --config path
 * 2. .gm-orchestrator.json in cwd (only if it contains a projectId — prevents
 *    accidental wizard skip from stale files in random directories)
 * 3. ~/.config/gm-orchestrator/config.json (user-level config)
 */
function readFileConfig(explicitPath?: string): Partial<OrchestratorConfig> {
  // 1. Explicit path — use as-is
  if (explicitPath) {
    return readJsonConfig(explicitPath);
  }

  // 2. CWD config — only use if it has a projectId (intentional project-level config)
  const cwdPath = resolve(process.cwd(), CONFIG_FILE);
  const cwdConfig = readJsonConfig(cwdPath);
  if (cwdConfig.projectId) {
    return cwdConfig;
  }

  // 3. User-level config
  const userPath = getUserConfigPath();
  return readJsonConfig(userPath);
}

function readJsonConfig(path: string): Partial<OrchestratorConfig> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Partial<OrchestratorConfig>;
  } catch {
    console.warn(`Warning: could not parse ${path}`);
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
