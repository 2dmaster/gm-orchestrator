## Goal

Turn gm-orchestrator from a single-project tool into a multi-project orchestrator that can manage tasks across multiple GraphMemory servers and projects from a single UI and process.

## Motivation

Users often run multiple GM servers (different ports) with multiple projects. Currently switching between them requires editing config and restarting. The orchestrator should leverage GM workspace support and allow parallel orchestration with resource management.

## Key use cases

1. **Freelancer / team lead** — see all projects in one dashboard, run sprints across them
2. **Monorepo** — backend/frontend/infra as separate GM projects, single orchestration point
3. **CI/CD nightly runs** — sprint all projects in workspace, unified report
4. **Cross-project epics** — tasks spanning multiple projects with dependency tracking
5. **Global priority queue** — critical bug in project-A runs before medium tasks in project-B
6. **Resource management** — limit concurrent claude sessions across all projects

## Approach

Leverage GM workspace (`get_context` already returns `workspaceProjects[]`). Phases:

- **Phase 1**: Multi-project config + wizard + dashboard
- **Phase 2**: Multi-runner with concurrency control
- **Phase 3**: Cross-project epics and dependencies

## Out of scope (for now)

- Multi-user / auth
- Remote GM servers (non-localhost)
- Distributed runners across machines