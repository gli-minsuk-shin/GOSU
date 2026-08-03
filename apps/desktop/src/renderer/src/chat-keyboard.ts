export type ChatKeyStroke = Readonly<{
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  keyCode?: number;
}>;

export function shouldSendChatMessage({ key, shiftKey, isComposing, keyCode }: ChatKeyStroke) {
  return key === 'Enter' && !shiftKey && !isComposing && keyCode !== 229;
}
