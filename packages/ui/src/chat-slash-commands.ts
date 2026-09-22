/**
 * Commands a reader types into any GOSU chat to manage the length of the context. They are handled
 * by GOSU and never sent to a model, so only a message that is nothing but the command counts:
 * "/compact the model before export" is an ordinary request and goes to the model as written.
 */
export const CHAT_SLASH_COMMANDS = ['/new', '/compact'] as const;
export type ChatSlashCommand = (typeof CHAT_SLASH_COMMANDS)[number];

function normalized(text: string) {
  return text.normalize('NFKC').trim().toLowerCase();
}

export function parseChatSlashCommand(message: string): ChatSlashCommand | null {
  const text = normalized(message);
  return CHAT_SLASH_COMMANDS.find((command) => command === text) ?? null;
}

/** Commands to offer while the draft is still a single word that starts with a slash. */
export function chatSlashSuggestions(draft: string): readonly ChatSlashCommand[] {
  if (/\s/u.test(draft.normalize('NFKC').replace(/^\s+/u, ''))) return [];
  const text = normalized(draft);
  if (!text.startsWith('/')) return [];
  return CHAT_SLASH_COMMANDS.filter((command) => command.startsWith(text));
}
