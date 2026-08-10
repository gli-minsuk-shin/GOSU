import { describe, expect, it } from 'vitest';

import { parseProjectTodoSkill } from '../src/main/project-todo-skill';

describe('Project /todo skill routing', () => {
  it('recognizes help and the supported explicit operations', () => {
    expect(parseProjectTodoSkill('/todo')).toEqual({
      skill: '/todo',
      operation: 'help',
      arguments: '',
    });
    expect(parseProjectTodoSkill('/TODO list overdue')).toEqual({
      skill: '/todo',
      operation: 'list',
      arguments: 'overdue',
    });
    expect(parseProjectTodoSkill('/todo done Baseline reproduction')).toEqual({
      skill: '/todo',
      operation: 'done',
      arguments: 'Baseline reproduction',
    });
    expect(parseProjectTodoSkill('/todo move task-7 Review')).toEqual({
      skill: '/todo',
      operation: 'move',
      arguments: 'task-7 Review',
    });
  });

  it('treats free text after /todo as a task-add request and ignores near matches', () => {
    expect(parseProjectTodoSkill('/todo baseline 재현 --priority high #experiment')).toEqual({
      skill: '/todo',
      operation: 'add',
      arguments: 'baseline 재현 --priority high #experiment',
    });
    expect(parseProjectTodoSkill('/todoist list')).toBeNull();
    expect(parseProjectTodoSkill('please add a task')).toBeNull();
  });
});
