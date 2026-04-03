import type { GraphMemoryPort, ProjectEntry, CrossProjectResolver, TaskStatus } from '../core/types.js';
import { GraphMemoryClient } from './gm-client.js';

/**
 * Manages a pool of GraphMemoryClient instances — one per configured project.
 * Lazily creates clients on first access and caches them by projectId.
 */
export class GraphMemoryClientPool {
  private readonly clients = new Map<string, GraphMemoryClient>();
  private projects: ProjectEntry[];

  constructor(projects: ProjectEntry[]) {
    this.projects = [...projects];
  }

  /**
   * Returns the GraphMemoryPort for a given projectId.
   * Creates a new client if one doesn't exist yet.
   * Throws if the projectId is not in the configured projects list.
   */
  getClient(projectId: string): GraphMemoryPort {
    const existing = this.clients.get(projectId);
    if (existing) return existing;

    const entry = this.projects.find((p) => p.projectId === projectId);
    if (!entry) {
      throw new Error(`Project "${projectId}" is not configured. Add it to config.projects[] first.`);
    }

    const client = new GraphMemoryClient({
      baseUrl: entry.baseUrl,
      projectId: entry.projectId,
      ...(entry.apiKey !== undefined ? { apiKey: entry.apiKey } : {}),
    });
    this.clients.set(projectId, client);
    return client;
  }

  /**
   * Returns all currently-instantiated clients keyed by projectId.
   * Does NOT eagerly create clients — only returns those already accessed.
   */
  getAllClients(): Map<string, GraphMemoryPort> {
    return new Map(this.clients);
  }

  /**
   * Returns all configured project IDs (whether clients have been created or not).
   */
  getProjectIds(): string[] {
    return this.projects.map((p) => p.projectId);
  }

  /**
   * Rebuild the pool from a new set of projects.
   * Existing clients whose project is still present are kept;
   * clients for removed projects are discarded.
   */
  rebuild(projects: ProjectEntry[]): void {
    this.projects = [...projects];
    const validIds = new Set(projects.map((p) => p.projectId));

    // Remove clients for projects that no longer exist
    for (const id of this.clients.keys()) {
      if (!validIds.has(id)) {
        this.clients.delete(id);
      }
    }

    // Reconfigure existing clients in case baseUrl/apiKey changed
    for (const entry of projects) {
      const client = this.clients.get(entry.projectId);
      if (client) {
        client.reconfigure({
          baseUrl: entry.baseUrl,
          projectId: entry.projectId,
          ...(entry.apiKey !== undefined ? { apiKey: entry.apiKey } : {}),
        });
      }
    }
  }

  /**
   * Returns true if a project with the given ID is configured.
   */
  has(projectId: string): boolean {
    return this.projects.some((p) => p.projectId === projectId);
  }

  /**
   * Creates a CrossProjectResolver that can fetch task status from any
   * configured project. Used by the orchestrator to resolve cross-project
   * blocker dependencies at runtime.
   */
  createCrossProjectResolver(): CrossProjectResolver {
    return async (projectId: string, taskId: string): Promise<TaskStatus | undefined> => {
      if (!this.has(projectId)) return undefined;
      try {
        const client = this.getClient(projectId) as GraphMemoryClient;
        return await client.getTaskStatus(taskId);
      } catch {
        return undefined;
      }
    };
  }
}
