import { describe, it, expect } from 'vitest';
import { buildPrompt } from '../../src/core/prompt-builder.js';
import { makeTask } from '../fixtures/factories.js';

const CTX = { projectId: 'test-project' };

describe('buildPrompt', () => {
  it('contains the task ID', () => {
    const task = makeTask({ id: 'task-42' });
    const prompt = buildPrompt(task, CTX);
    expect(prompt).toContain('task-42');
  });

  it('contains the task title', () => {
    const task = makeTask({ title: 'Refactor auth module' });
    const prompt = buildPrompt(task, CTX);
    expect(prompt).toContain('Refactor auth module');
  });

  it('includes tasks_move completion signal', () => {
    const task = makeTask({ id: 'task-99' });
    const prompt = buildPrompt(task, CTX);
    expect(prompt).toContain('tasks_move("task-99", "done")');
    expect(prompt).toContain('tasks_move("task-99", "cancelled")');
  });

  it('includes tasks_get instruction', () => {
    const task = makeTask({ id: 'task-55' });
    const prompt = buildPrompt(task, CTX);
    expect(prompt).toContain('tasks_get("task-55")');
  });

  it('includes skills_recall instruction', () => {
    const task = makeTask();
    const prompt = buildPrompt(task, CTX);
    expect(prompt).toContain('skills_recall');
  });

  it('lists resolved blockers when present', () => {
    const task = makeTask({
      blockedBy: [{ id: 'b1', title: 'Setup DB', status: 'done' }],
    });
    const prompt = buildPrompt(task, CTX);
    expect(prompt).toContain('Setup DB');
    expect(prompt).toContain('Resolved Blockers');
  });

  it('does not include Resolved Blockers section when none', () => {
    const task = makeTask();
    const prompt = buildPrompt(task, CTX);
    expect(prompt).not.toContain('Resolved Blockers');
  });

  it('lists subtasks with checkboxes', () => {
    const task = makeTask({
      subtasks: [
        { id: 's1', title: 'Write tests', status: 'done' },
        { id: 's2', title: 'Update docs', status: 'todo' },
      ],
    });
    const prompt = buildPrompt(task, CTX);
    expect(prompt).toContain('[x] Write tests');
    expect(prompt).toContain('[ ] Update docs');
    expect(prompt).toContain('s1');
    expect(prompt).toContain('s2');
  });

  it('includes subtask move instructions when subtasks present', () => {
    const task = makeTask({
      id: 'parent-1',
      subtasks: [{ id: 'sub-1', title: 'Sub', status: 'todo' }],
    });
    const prompt = buildPrompt(task, CTX);
    expect(prompt).toContain('tasks_move(subtaskId, "done")');
  });

  it('includes priority in output', () => {
    const task = makeTask({ priority: 'critical' });
    const prompt = buildPrompt(task, CTX);
    expect(prompt).toContain('critical');
  });

  it('mentions no description when missing', () => {
    const task = makeTask({ description: undefined });
    const prompt = buildPrompt(task, CTX);
    expect(prompt).toContain('tasks_get');
  });

  it('includes description when provided', () => {
    const task = makeTask({ description: 'Add rate limiting to the API' });
    const prompt = buildPrompt(task, CTX);
    expect(prompt).toContain('Add rate limiting to the API');
  });

  it('is a non-empty string', () => {
    const prompt = buildPrompt(makeTask(), CTX);
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(100);
  });

  it('includes idempotency guard when runId is provided', () => {
    const task = makeTask({ id: 'task-idem' });
    const prompt = buildPrompt(task, { ...CTX, runId: 'run-abc-123' });
    expect(prompt).toContain('Idempotency Guard');
    expect(prompt).toContain('run-abc-123');
    expect(prompt).toContain('ORCHESTRATOR_RUN_ID');
    expect(prompt).toContain('metadata.runId');
  });

  it('omits idempotency guard when runId is not provided', () => {
    const task = makeTask({ id: 'task-no-idem' });
    const prompt = buildPrompt(task, CTX);
    expect(prompt).not.toContain('Idempotency Guard');
    expect(prompt).not.toContain('ORCHESTRATOR_RUN_ID');
  });

  it('idempotency guard references the correct task ID', () => {
    const task = makeTask({ id: 'task-check' });
    const prompt = buildPrompt(task, { ...CTX, runId: 'run-xyz' });
    expect(prompt).toContain('tasks_get("task-check")');
    expect(prompt).toContain('exit immediately');
  });
});
