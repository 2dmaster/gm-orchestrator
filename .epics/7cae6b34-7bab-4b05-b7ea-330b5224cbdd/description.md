## Context
Feedback collected while using gm-orchestrator to drive the MixPlaces Phase U migration (21 tasks across 2 epics in 2 separate graph-memory projects: `MixPlacesAPI-V2` and `MixPlacesEcommerce`). The orchestrator worked well for the core use case — priority+blockers sequential execution with fresh Claude sessions per task — but a handful of gaps surfaced that would be valuable to close.

## What worked well (keep)
- **Spawn fresh Claude session per task.** Golden model. Contexts don't accumulate, agents don't drift, each task starts clean. This is materially better than holding one long session for a whole epic.
- **Priority + blockers as the ordering signal.** Simple, enough for 90% of real cases. `tasks_link kind="blocks"` is a natural fit and readable in the graph.
- **Graph-memory as state store.** State lives in a shared, inspectable place — tool can run, human can run, both see the same truth. Correct architectural choice.
- **Pipelines DAG for multi-project** — nice to have, even though sequential epics were enough for this particular migration.

## What to improve
Six tasks below, ranked by how painful the gap was in practice.

## Non-goals
- Replacing priority+blockers with a full DAG scheduler. The current model is good enough; these improvements are additive.
- Building a custom UI. Dashboard that already exists is fine; improvements here go into the engine, not the frontend.
