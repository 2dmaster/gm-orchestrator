import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import { homedir } from 'os';
import type { OrchestratorConfig, LegacyOrchestratorConfig, ProjectEntry } from '../core/types.js';

const CONFIG_FILE = '.gm-orchestrator.json';

const DEFAULTS: OrchestratorConfig = {
  projects: [],
  concurrency: 1,
  schedulerStrategy: 'round-robin',
  timeoutMs: 15 * 60 * 1000,
  pauseMs: 2_000,
  maxRetries: 1,
  claudeArgs: [],
  dryRun: false,
  maxTurns: 200,
  agentTimeoutMs: 120_000,
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

/**
 * Migrate a legacy config (top-level baseUrl/projectId) to the new multi-project format.
 * If the config already has a `projects` array, returns it as-is.
 */
export function migrateConfig(raw: Record<string, unknown>): Partial<OrchestratorConfig> {
  // Already in new format
  if (Array.isArray(raw['projects'])) {
    return raw as unknown as Partial<OrchestratorConfig>;
  }

  // Legacy format: top-level baseUrl/projectId
  const legacy = raw as LegacyOrchestratorConfig;
  const result: Partial<OrchestratorConfig> = {};

  // Build a project entry from legacy fields if present
  if (legacy.baseUrl || legacy.projectId) {
    const entry: ProjectEntry = {
      baseUrl: legacy.baseUrl ?? 'http://localhost:3000',
      projectId: legacy.projectId ?? '',
    };
    if (legacy.apiKey) entry.apiKey = legacy.apiKey;
    result.projects = [entry];
    if (entry.projectId) {
      result.activeProjectId = entry.projectId;
    }
  }

  // Carry over non-connection fields
  if (legacy.timeoutMs !== undefined) result.timeoutMs = legacy.timeoutMs;
  if (legacy.pauseMs !== undefined) result.pauseMs = legacy.pauseMs;
  if (legacy.maxRetries !== undefined) result.maxRetries = legacy.maxRetries;
  if (legacy.claudeArgs !== undefined) result.claudeArgs = legacy.claudeArgs;
  if (legacy.dryRun !== undefined) result.dryRun = legacy.dryRun;
  if (legacy.tag !== undefined) result.tag = legacy.tag;
  if (legacy.discovery !== undefined) result.discovery = legacy.discovery;

  return result;
}

export function loadConfig(overrides: Partial<OrchestratorConfig> & { configPath?: string } = {}): OrchestratorConfig {
  const { configPath, ...rest } = overrides;
  const fileConfig = readFileConfig(configPath);
  const envConfig = readEnvConfig();
  return mergeConfigs(DEFAULTS, fileConfig, envConfig, rest);
}

/**
 * Deep-merge configs in priority order. Projects arrays are merged by projectId
 * (later sources win), and scalar fields use simple override.
 */
function mergeConfigs(...configs: Partial<OrchestratorConfig>[]): OrchestratorConfig {
  const result = { ...DEFAULTS };

  for (const cfg of configs) {
    if (cfg.projects?.length) {
      // Merge projects by projectId — later entries override earlier ones
      const projectMap = new Map<string, ProjectEntry>();
      for (const p of result.projects) projectMap.set(p.projectId, p);
      for (const p of cfg.projects) projectMap.set(p.projectId, p);
      result.projects = [...projectMap.values()];
    }
    if (cfg.activeProjectId !== undefined) result.activeProjectId = cfg.activeProjectId;
    if (cfg.concurrency !== undefined) result.concurrency = cfg.concurrency;
    if (cfg.schedulerStrategy !== undefined) result.schedulerStrategy = cfg.schedulerStrategy;
    if (cfg.timeoutMs !== undefined) result.timeoutMs = cfg.timeoutMs;
    if (cfg.pauseMs !== undefined) result.pauseMs = cfg.pauseMs;
    if (cfg.maxRetries !== undefined) result.maxRetries = cfg.maxRetries;
    if (cfg.claudeArgs !== undefined) result.claudeArgs = cfg.claudeArgs;
    if (cfg.dryRun !== undefined) result.dryRun = cfg.dryRun;
    if (cfg.tag !== undefined) result.tag = cfg.tag;
    if (cfg.discovery !== undefined) result.discovery = cfg.discovery;
    if (cfg.maxTurns !== undefined) result.maxTurns = cfg.maxTurns;
    if (cfg.agentTimeoutMs !== undefined) result.agentTimeoutMs = cfg.agentTimeoutMs;
    if (cfg.lastRun !== undefined) result.lastRun = cfg.lastRun;
  }

  return result;
}

export function validateConfig(config: OrchestratorConfig): void {
  const errors: string[] = [];

  if (!config.projects.length) {
    errors.push(
      'At least one project is required.\n' +
      '  Options: --project <id>  |  GM_PROJECT_ID env  |  .gm-orchestrator.json'
    );
  }

  const active = config.activeProjectId
    ? config.projects.find((p) => p.projectId === config.activeProjectId)
    : config.projects[0];

  if (config.projects.length && !active) {
    errors.push(
      `activeProjectId "${config.activeProjectId}" does not match any project in the projects array.`
    );
  }

  if (active && !active.projectId) {
    errors.push(
      'projectId is required in the active project entry.\n' +
      '  Options: --project <id>  |  GM_PROJECT_ID env  |  .gm-orchestrator.json'
    );
  }

  if (config.timeoutMs < 10_000) {
    errors.push('timeoutMs must be at least 10000 (10 seconds)');
  }

  if (config.concurrency < 1) {
    errors.push('concurrency must be at least 1');
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
 * 2. .gm-orchestrator.json in cwd (only if it contains a projectId or projects array —
 *    prevents accidental wizard skip from stale files in random directories)
 * 3. ~/.config/gm-orchestrator/config.json (user-level config)
 */
function readFileConfig(explicitPath?: string): Partial<OrchestratorConfig> {
  // 1. Explicit path — use as-is
  if (explicitPath) {
    return readJsonConfig(explicitPath);
  }

  // 2. CWD config — only use if it has a projectId or projects array
  const cwdPath = resolve(process.cwd(), CONFIG_FILE);
  const cwdConfig = readJsonConfig(cwdPath);
  if (cwdConfig.projects?.length || cwdConfig.activeProjectId) {
    return cwdConfig;
  }

  // 3. User-level config
  const userPath = getUserConfigPath();
  return readJsonConfig(userPath);
}

function readJsonConfig(path: string): Partial<OrchestratorConfig> {
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    return migrateConfig(raw);
  } catch {
    console.warn(`Warning: could not parse ${path}`);
    return {};
  }
}

function readEnvConfig(): Partial<OrchestratorConfig> {
  const cfg: Partial<OrchestratorConfig> = {};

  // Env vars create/override a single project entry (backward compat)
  const envBaseUrl = process.env['GM_BASE_URL'];
  const envProjectId = process.env['GM_PROJECT_ID'];
  const envApiKey = process.env['GM_API_KEY'];

  if (envBaseUrl || envProjectId) {
    const entry: ProjectEntry = {
      baseUrl: envBaseUrl ?? 'http://localhost:3000',
      projectId: envProjectId ?? '',
    };
    if (envApiKey) entry.apiKey = envApiKey;
    cfg.projects = [entry];
    if (entry.projectId) cfg.activeProjectId = entry.projectId;
  }

  if (process.env['GM_TIMEOUT_MS']) cfg.timeoutMs = Number(process.env['GM_TIMEOUT_MS']);
  return cfg;
}
