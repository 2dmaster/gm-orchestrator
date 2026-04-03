import type { Task } from './types.js';

/**
 * Builds a self-contained, autonomous prompt for a single Claude Code session.
 *
 * AI-first design principles applied here:
 *
 * 1. CONTEXT FRONT-LOADING — everything Claude needs is in the prompt.
 *    No back-and-forth, no clarifying questions possible.
 *
 * 2. EXPLICIT CONTRACT — the only output we care about is tasks_move().
 *    Claude doesn't need to write to stdout, return JSON, or signal in any
 *    other way. This is the single integration point.
 *
 * 3. TOOL-FIRST INSTRUCTIONS — Claude is told to use GraphMemory tools
 *    (tasks_get, skills_recall) before doing any work. This leverages the
 *    existing knowledge graph instead of reasoning from scratch.
 *
 * 4. FAILURE MODES ARE EXPLICIT — Claude knows what to do when blocked,
 *    impossible, or ambiguous. No hanging sessions.
 *
 * 5. MINIMAL PROMPT — only what's needed. The description might be empty
 *    deliberately (Claude fetches full context via tasks_get). Don't pad.
 */
export function buildPrompt(task: Task, config: { projectId: string }): string {
  const sections: string[] = [];

  sections.push(`# Autonomous Task Execution`);
  sections.push(
    `You are running as an autonomous agent inside an orchestrator pipeline.\n` +
    `Complete the task below WITHOUT asking for confirmation or clarification.\n` +
    `The orchestrator has no stdin — it only watches GraphMemory task status.`
  );

  sections.push(`## Task`);
  sections.push(formatTaskHeader(task));

  sections.push(`## Execution Protocol`);
  sections.push(buildProtocol(task));

  if (task.blockedBy?.length) {
    sections.push(`## Resolved Blockers (for context)`);
    sections.push(task.blockedBy.map((b) => `- ${b.title} (${b.id}) ✓`).join('\n'));
  }

  if (task.subtasks?.length) {
    sections.push(`## Subtasks`);
    sections.push(task.subtasks.map((s) =>
      `- [${s.status === 'done' ? 'x' : ' '}] ${s.title} — \`${s.id}\``
    ).join('\n'));
  }

  sections.push(`## Completion Signal`);
  sections.push(
    `When done:      \`tasks_move("${task.id}", "done")\`\n` +
    `When cancelled: \`tasks_move("${task.id}", "cancelled")\` + update description with reason\n\n` +
    `**This is the only output the orchestrator reads. Do not skip it.**`
  );

  return sections.join('\n\n');
}

function formatTaskHeader(task: Task): string {
  const lines = [
    `**ID**: \`${task.id}\``,
    `**Title**: ${task.title}`,
    `**Priority**: ${task.priority}`,
  ];
  if (task.tags?.length) lines.push(`**Tags**: ${task.tags.join(', ')}`);
  if (task.estimate) lines.push(`**Estimate**: ${task.estimate}`);
  if (task.dueDate) lines.push(`**Due**: ${task.dueDate}`);
  if (task.description) {
    lines.push(`\n**Description**:\n${task.description}`);
  } else {
    lines.push(`\n_(No description — fetch full context via tasks_get)_`);
  }
  return lines.join('\n');
}

function buildProtocol(task: Task): string {
  const steps = [
    `1. **Get full context**: \`tasks_get("${task.id}")\` — reads cross-links, attachments, notes`,
    `2. **Check for recipes**: \`skills_recall("<task topic>")\` — use existing patterns if available`,
    `3. **Do the work**: use all available tools (edit files, run commands, search code, etc.)`,
  ];

  if (task.subtasks?.length) {
    steps.push(
      `4. **Subtasks**: complete each one and call \`tasks_move(subtaskId, "done")\` per subtask`
    );
    steps.push(`5. **Signal completion**: \`tasks_move("${task.id}", "done")\``);
  } else {
    steps.push(`4. **Signal completion**: \`tasks_move("${task.id}", "done")\``);
  }

  steps.push(
    `\n**If blocked or impossible**: call \`tasks_move("${task.id}", "cancelled")\` immediately ` +
    `and update the task description with the specific blocker. Do not spin.`
  );

  return steps.join('\n');
}
