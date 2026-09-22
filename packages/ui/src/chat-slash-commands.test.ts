import { describe, expect, it } from 'vitest';
import { chatSlashSuggestions, parseChatSlashCommand } from './chat-slash-commands.js';

describe('chat slash commands', () => {
  it('reads a command only when it is the whole message', () => {
    expect(parseChatSlashCommand('/new')).toBe('/new');
    expect(parseChatSlashCommand('  /COMPACT  ')).toBe('/compact');
    expect(parseChatSlashCommand('／ｎｅｗ')).toBe('/new');
    for (const text of [
      '/compact the model before export',
      '/new idea: label embeddings',
      'please /new',
      '/newer',
      '/todo add x',
      '//new',
      '',
    ]) {
      expect(parseChatSlashCommand(text), text).toBeNull();
    }
  });

  it('suggests the commands while the first word is still being typed', () => {
    expect(chatSlashSuggestions('/')).toEqual(['/new', '/compact']);
    expect(chatSlashSuggestions('/c')).toEqual(['/compact']);
    expect(chatSlashSuggestions('/NE')).toEqual(['/new']);
    expect(chatSlashSuggestions('/new')).toEqual(['/new']);
    expect(chatSlashSuggestions('/new ')).toEqual([]);
    expect(chatSlashSuggestions('hello /n')).toEqual([]);
    expect(chatSlashSuggestions('/x')).toEqual([]);
  });
});
