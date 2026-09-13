import { z } from 'zod';
export const PAPER_CHAT_REFERENCE = 'gosu:paper-chat-reference';
export const PaperChatReferenceSchema = z
  .object({
    routineId: z.string().max(128),
    historyId: z.string().max(300),
    paperId: z.string().max(300),
    title: z.string().max(1000),
  })
  .strict();
export type PaperChatReference = z.infer<typeof PaperChatReferenceSchema>;
export function PaperChatButton({ reference }: { reference: PaperChatReference }) {
  return (
    <button
      type="button"
      className="briefing-paper-chat-button"
      title="이 논문으로 AI 비서와 대화"
      aria-label={`${reference.title} · AI 비서에게 질문`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent(PAPER_CHAT_REFERENCE, { detail: reference }));
      }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        aria-hidden="true"
      >
        <path d="M5 4h14v12H9l-4 4V4Z" />
        <path d="M8 8h8M8 12h5" />
      </svg>
      <span>AI 질문</span>
    </button>
  );
}
export function importanceFirst<T>(items: readonly T[], level: (item: T) => string) {
  const rank = (v: string) => ({ high: 0, medium: 1, low: 2 })[v] ?? 3;
  return [...items].sort((a, b) => rank(level(a)) - rank(level(b)));
}
