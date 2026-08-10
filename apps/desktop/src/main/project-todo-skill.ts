export const PROJECT_TODO_SKILL_NAME = '/todo' as const;

export const PROJECT_TODO_SKILL_EXAMPLES = Object.freeze([
  '/todo baseline 재현 --due 2026-08-14 --priority high #experiment',
  '/todo list',
  '/todo list overdue',
  '/todo done <task title or ID>',
  '/todo move <task title or ID> <column>',
] as const);

export type ProjectTodoSkillRequest = Readonly<{
  skill: typeof PROJECT_TODO_SKILL_NAME;
  operation: 'help' | 'add' | 'list' | 'done' | 'move';
  arguments: string;
}>;

const TODO_PREFIX = /^\/todo(?:\s+|$)/iu;

/**
 * Parses only the routing verb. Task identity, dates, and custom Board column labels remain
 * visible user input for the model to resolve against the project-scoped Board snapshot. The
 * returned envelope is data, not an instruction channel, and never carries a project identifier.
 */
export function parseProjectTodoSkill(message: string): ProjectTodoSkillRequest | null {
  const normalized = message.normalize('NFKC').trim();
  if (!TODO_PREFIX.test(normalized)) return null;

  const body = normalized.replace(TODO_PREFIX, '').trim();
  if (!body || /^help$/iu.test(body)) {
    return { skill: PROJECT_TODO_SKILL_NAME, operation: 'help', arguments: '' };
  }

  const verbMatch = /^(?<verb>add|list|done|move)(?:\s+(?<arguments>[\s\S]*))?$/iu.exec(body);
  if (!verbMatch?.groups) {
    return { skill: PROJECT_TODO_SKILL_NAME, operation: 'add', arguments: body };
  }

  const verb = verbMatch.groups.verb!.toLocaleLowerCase('en-US') as
    'add' | 'list' | 'done' | 'move';
  return {
    skill: PROJECT_TODO_SKILL_NAME,
    operation: verb,
    arguments: (verbMatch.groups.arguments ?? '').trim(),
  };
}
