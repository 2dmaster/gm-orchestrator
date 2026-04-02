import type { Permissions } from './types.js';

/**
 * Translates user permission config into Claude Code --allowedTools flags.
 *
 * Rules:
 * - "Read" is always included (cannot be disabled)
 * - "Write" and "Edit" are included only when writeFiles is true
 * - Each runCommands entry becomes "Bash(<command>)"
 * - A command appearing in both runCommands and blockedCommands throws
 * - mcpTools controls MCP tool inclusion: "all" | "none" | string[]
 */
export function buildAllowedTools(permissions: Permissions): string[] {
  // Validate: no command may appear in both runCommands and blockedCommands
  const conflicts = permissions.runCommands.filter((cmd) =>
    permissions.blockedCommands.some((blocked) => cmd.includes(blocked) || blocked.includes(cmd))
  );
  if (conflicts.length > 0) {
    throw new Error(
      `Permission conflict: commands appear in both runCommands and blockedCommands: ${conflicts.join(', ')}`
    );
  }

  const tools: string[] = ['Read'];

  if (permissions.writeFiles) {
    tools.push('Write', 'Edit');
  }

  for (const cmd of permissions.runCommands) {
    tools.push(`Bash(${cmd})`);
  }

  // MCP tools
  if (permissions.mcpTools === 'all') {
    tools.push('mcp__*');
  } else if (permissions.mcpTools !== 'none') {
    for (const tool of permissions.mcpTools) {
      tools.push(tool);
    }
  }

  return tools;
}

/**
 * Returns true if the command is allowed, false if blocked.
 * Uses substring matching against the blockedCommands list.
 */
export function validateCommand(cmd: string, permissions: Permissions): boolean {
  return !permissions.blockedCommands.some(
    (blocked) => cmd.includes(blocked)
  );
}
