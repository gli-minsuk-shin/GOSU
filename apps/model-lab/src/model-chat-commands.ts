import { uiText } from '@gosu/ui/language';
import {
  chatSlashSuggestions,
  parseChatSlashCommand,
  type ChatSlashCommand,
} from '@gosu/ui/chat-slash-commands';

export type ModelChatCommandState = Readonly<{
  command: ChatSlashCommand;
  phase: 'running' | 'done' | 'failed';
  message: string;
}>;

/** One quiet line under each command in the composer menu. */
export function modelChatCommandDescription(command: ChatSlashCommand) {
  return command === '/new'
    ? uiText('Start a fresh context; earlier messages stay visible')
    : uiText('Summarize earlier messages now');
}

export function modelChatCommandMenu(draft: string) {
  return chatSlashSuggestions(draft).map((command) => ({
    command,
    description: modelChatCommandDescription(command),
  }));
}

export function modelChatCommandRunning(command: ChatSlashCommand): ModelChatCommandState {
  return {
    command,
    phase: 'running',
    message:
      command === '/new'
        ? uiText('Starting a fresh context…')
        : uiText('Compacting the conversation…'),
  };
}

export function modelChatCommandFinished(
  command: ChatSlashCommand,
  outcome: Readonly<{ compacted: boolean; summarizedMessages: number }>,
): ModelChatCommandState {
  if (command === '/new') {
    return {
      command,
      phase: 'done',
      message: uiText(
        'A fresh context started. Earlier messages stay visible but are not sent to the model.',
      ),
    };
  }
  return {
    command,
    phase: 'done',
    message: outcome.compacted
      ? uiText('Summarized {count} earlier messages; the originals are kept.', {
          count: outcome.summarizedMessages,
        })
      : uiText('There is nothing older to summarize yet.'),
  };
}

/** Every refusal and every failure names the command and, when there is one, its error code. */
export function modelChatCommandFailure(
  command: ChatSlashCommand,
  code: string,
): ModelChatCommandState {
  return {
    command,
    phase: 'failed',
    message: uiText(
      'The {command} command failed and the conversation is unchanged. Error code: {code}.',
      { command, code },
    ),
  };
}

export type ModelChatSubmission =
  | Readonly<{ kind: 'question' }>
  | Readonly<{ kind: 'command'; command: ChatSlashCommand }>
  | Readonly<{ kind: 'refused'; status: ModelChatCommandState }>;

/**
 * What a submitted draft is. Only a message that is nothing but the command counts, so "/compact
 * the model before export" stays an ordinary question. A command is never queued behind a running
 * answer or another command: it is refused, with a sentence saying why.
 */
export function modelChatSubmission(
  draft: string,
  busy: Readonly<{ answering: boolean; commandRunning: boolean }>,
): ModelChatSubmission {
  const command = parseChatSlashCommand(draft);
  if (!command) return { kind: 'question' };
  if (busy.answering) {
    return {
      kind: 'refused',
      status: {
        command,
        phase: 'failed',
        message: uiText(
          'A Model Assistant answer is still running, so {command} was not run. Stop the answer or wait for it, then retry.',
          { command },
        ),
      },
    };
  }
  if (busy.commandRunning) {
    return {
      kind: 'refused',
      status: {
        command,
        phase: 'failed',
        message: uiText('A context command is already running, so {command} was not run.', {
          command,
        }),
      },
    };
  }
  return { kind: 'command', command };
}

export function modelChatContextDividerText() {
  return uiText('New conversation from here · messages above are not sent to the model');
}

/** A stored marker from an older build, a shorter transcript or a corrupt value all mean "no divider". */
export function modelChatContextStart(value: unknown, messageCount: number) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? Math.min(value, Math.max(0, messageCount))
    : 0;
}

/** Keep the divider on the same message after the transcript is trimmed to its last `kept`. */
export function trimmedModelChatContextStart(contextStartsAt: number, total: number, kept: number) {
  return Math.max(0, Math.min(kept, contextStartsAt - Math.max(0, total - kept)));
}
