import { z } from 'zod';
import { Temporal } from 'temporal-polyfill';
import type { AssistantProfile } from './briefing-workspace-store';
import type { BriefingHostReadKind } from './briefing-workspace-store';
import type { BriefingHistory } from './briefing-workspace-store';
import type { LiveItem } from './src/live-types';
import type { SavedPaper } from './src/paper-library-index';
import { emailDeliveryForPrompt } from './src/mail-account';
import { paperLabels } from './src/paper-library-index';

/**
 * Calendar, mail, saved briefings and saved paper summaries read by the GOSU app for another part
 * of itself (Project Chat), under the routine settings the user approved in Briefing Lab. Reads
 * only: the scope, the permissions and the "ask every time" policy are the Briefing ones, and
 * nothing here writes or widens them.
 */
export type BriefingHostReads = Readonly<{
  status: () => Promise<BriefingHostStatus>;
  calendar: (input: unknown, caller: string, signal: AbortSignal) => Promise<unknown>;
  mail: (input: unknown, caller: string, signal: AbortSignal) => Promise<unknown>;
  briefings: (input: unknown, caller: string, signal: AbortSignal) => Promise<unknown>;
  papers: (input: unknown, caller: string, signal: AbortSignal) => Promise<unknown>;
}>;

export type BriefingHostStatus = Readonly<{
  calendar: boolean;
  mail: boolean;
  briefings: boolean;
  papers: boolean;
  routineName: string | null;
  asksEachTime: boolean;
}>;

export type BriefingHostFetchers = Readonly<{
  profile: (kind: BriefingHostReadKind) => Promise<AssistantProfile | null>;
  assert: (kind: BriefingHostReadKind, profile: AssistantProfile) => Promise<void>;
  privateAllowed: (profile: AssistantProfile) => boolean;
  requiresConfirmation: (profile: AssistantProfile) => boolean;
  consent: (message: string, signal: AbortSignal) => Promise<void>;
  calendar: (
    profile: AssistantProfile,
    start: string,
    end: string,
    signal: AbortSignal,
  ) => Promise<{ events: readonly CalendarEvent[]; limited?: boolean }>;
  mail: (
    profile: AssistantProfile,
    search: MailRequest,
    signal: AbortSignal,
  ) => Promise<{ items: readonly LiveItem[]; note?: string }>;
  briefings: (
    routineId: string,
    query: string,
    limit: number,
  ) => Promise<readonly BriefingHistory[]>;
  briefingRecord: (routineId: string, historyId: string) => Promise<BriefingHistory | null>;
  savedPapers: (
    routineId: string,
    query: string,
    privateAllowed: boolean,
  ) => Promise<{ papers: readonly SavedPaper[]; privateOmitted: boolean }>;
}>;

type CalendarEvent = Readonly<{
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
}>;

export const HostCalendarRequestSchema = z
  .object({ from: z.string().max(40).optional(), to: z.string().max(40).optional() })
  .strict();
export const HostMailRequestSchema = z
  .object({
    query: z.string().max(300).optional(),
    sender: z.string().max(300).optional(),
    subject: z.string().max(300).optional(),
    account: z.string().max(300).optional(),
    from: z.string().max(40).optional(),
    to: z.string().max(40).optional(),
  })
  .strict();
export const HostBriefingRequestSchema = z
  .object({ query: z.string().max(300).optional(), historyId: z.string().max(200).optional() })
  .strict();
export const HostPaperRequestSchema = z
  .object({
    query: z.string().max(300).optional(),
    historyId: z.string().max(200).optional(),
    paperId: z.string().max(300).optional(),
  })
  .strict();
export type MailRequest = z.infer<typeof HostMailRequestSchema>;

const CONSENT: Readonly<Record<BriefingHostReadKind, string>> = {
  calendar: 'Briefing에서 선택한 Calendar를 읽습니다',
  mail: 'Briefing에 설정된 Apple Mail 범위를 읽습니다',
  briefings: '저장된 브리핑 기록을 읽습니다',
  papers: '저장된 논문 요약을 읽습니다',
};

/** Two days from the start of today in the routine's timezone, the Briefing chat's own window. */
export function hostCalendarWindow(
  timeZone: string,
  request: z.infer<typeof HostCalendarRequestSchema>,
  now = Temporal.Now.instant(),
) {
  const startOfToday = now.toZonedDateTimeISO(timeZone).startOfDay();
  const boundary = (value: string | undefined, fallback: Temporal.ZonedDateTime) => {
    if (!value) return fallback;
    const date = /^\d{4}-\d{2}-\d{2}$/u.test(value)
      ? Temporal.PlainDate.from(value).toZonedDateTime({ timeZone })
      : null;
    if (date) return date;
    return Temporal.Instant.from(value).toZonedDateTimeISO(timeZone);
  };
  const start = boundary(request.from, startOfToday);
  const end = boundary(request.to, start.add({ days: 2 }));
  if (Temporal.ZonedDateTime.compare(end, start) <= 0) throw new Error('assistant_calendar_range');
  if (end.since(start).total({ unit: 'days' }) > 93) throw new Error('assistant_calendar_range');
  return { start: start.toInstant().toString(), end: end.toInstant().toString() };
}

export function createBriefingHostReads(deps: BriefingHostFetchers): BriefingHostReads {
  const begin = async (kind: BriefingHostReadKind, caller: string, signal: AbortSignal) => {
    if (signal.aborted) throw new Error('source_cancelled');
    const profile = await deps.profile(kind);
    if (!profile) throw new Error(`assistant_${kind}_permission_required`);
    if (deps.requiresConfirmation(profile))
      await deps.consent(`${caller}이(가) ${CONSENT[kind]}. 이번 요청에만 허용할까요?`, signal);
    if (signal.aborted) throw new Error('source_cancelled');
    return profile;
  };
  const finish = async (
    kind: BriefingHostReadKind,
    profile: AssistantProfile,
    signal: AbortSignal,
  ) => {
    if (signal.aborted) throw new Error('source_cancelled');
    await deps.assert(kind, profile);
  };

  return {
    async status() {
      const [calendar, mail, briefings] = await Promise.all([
        deps.profile('calendar'),
        deps.profile('mail'),
        deps.profile('briefings'),
      ]);
      const routine = calendar ?? mail ?? briefings;
      return {
        calendar: Boolean(calendar),
        mail: Boolean(mail),
        briefings: Boolean(briefings),
        papers: Boolean(briefings),
        routineName: routine?.name ?? null,
        asksEachTime: Boolean(routine && deps.requiresConfirmation(routine)),
      };
    },

    async calendar(input, caller, signal) {
      const request = HostCalendarRequestSchema.parse(input ?? {});
      const profile = await begin('calendar', caller, signal);
      const window = hostCalendarWindow(profile.timeZone, request);
      const result = await deps.calendar(profile, window.start, window.end, signal);
      await finish('calendar', profile, signal);
      return {
        routine: profile.name,
        timeZone: profile.timeZone,
        from: window.start,
        to: window.end,
        note: 'Approved Briefing calendars only; the upper bound is exclusive. Read only: GOSU cannot create or change events from this chat.',
        limited: Boolean(result.limited) || result.events.length > 30,
        events: result.events.slice(0, 30).map((event) => ({
          id: event.id,
          title: event.title,
          start: event.start,
          end: event.end,
          allDay: event.allDay,
          location: event.location.slice(0, 300),
        })),
      };
    },

    async mail(input, caller, signal) {
      const request = HostMailRequestSchema.parse(input ?? {});
      const profile = await begin('mail', caller, signal);
      const result = await deps.mail(profile, request, signal);
      await finish('mail', profile, signal);
      return {
        routine: profile.name,
        scope: 'saved Briefing mailbox, lookback and count; not an exhaustive mailbox search',
        ...(result.note ? { note: result.note } : {}),
        messages: result.items.slice(0, 6).map((item) => ({
          id: item.id,
          title: item.title,
          summary: item.text.slice(0, 1800),
          unread: item.mailUnread ?? null,
          ...emailDeliveryForPrompt(item),
          ...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : {}),
        })),
        trust: 'untrusted_mail_content',
      };
    },

    async briefings(input, caller, signal) {
      const request = HostBriefingRequestSchema.parse(input ?? {});
      const profile = await begin('briefings', caller, signal);
      const records = request.historyId
        ? [await deps.briefingRecord(profile.routineId, request.historyId)].filter(
            (record): record is BriefingHistory => Boolean(record),
          )
        : await deps.briefings(profile.routineId, request.query ?? '', 6);
      if (records.some((record) => record.private) && !deps.privateAllowed(profile))
        throw new Error('assistant_private_ai_required');
      await finish('briefings', profile, signal);
      const full = Boolean(request.historyId);
      return {
        routine: profile.name,
        note: 'Saved AI briefing summaries, not live sources and not independent verification.',
        trust: 'untrusted_briefing_content',
        briefings: records.map((record) => ({
          historyId: record.id,
          runId: record.runId,
          createdAt: record.createdAt,
          answer: record.answer.slice(0, full ? 16000 : 800),
          items: record.items.slice(0, full ? 15 : 3).map((item) => ({
            id: item.id,
            title: item.title,
            summary: item.summary.slice(0, full ? 1400 : 600),
            ...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : {}),
            ...(item.kind === 'email' || item.readScope.startsWith('mail')
              ? { kind: 'email', ...emailDeliveryForPrompt(item) }
              : { kind: item.kind }),
            ...(full ? { importance: item.importance, action: item.action } : {}),
          })),
        })),
      };
    },

    async papers(input, caller, signal) {
      const request = HostPaperRequestSchema.parse(input ?? {});
      const profile = await begin('papers', caller, signal);
      const privateAllowed = deps.privateAllowed(profile);
      const library = await deps.savedPapers(
        profile.routineId,
        request.query ?? '',
        privateAllowed,
      );
      await finish('papers', profile, signal);
      const full = Boolean(request.historyId && request.paperId);
      const matches = full
        ? library.papers.filter(
            (paper) => paper.historyId === request.historyId && paper.item.id === request.paperId,
          )
        : library.papers.slice(0, 6);
      return {
        routine: profile.name,
        total: library.papers.length,
        privateOmitted: library.privateOmitted,
        note: 'Saved AI paper summaries from this routine; historical interpretations, not original sources.',
        trust: 'untrusted_paper_summary',
        papers: matches.slice(0, full ? 1 : 6).map(({ historyId, savedAt, item }) => ({
          historyId,
          paperId: item.id,
          title: item.title,
          savedAt,
          readScope: item.readScope,
          ...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : {}),
          ...paperLabels(item),
          summary: item.summary,
          ...(full
            ? {
                researchQuestion: item.researchQuestion,
                strengths: item.strengths,
                limitations: item.limitations,
                methodsAndAssumptions: item.methodsAndAssumptions,
                reportedResults: item.reportedResults,
                detail: item.detail?.slice(0, 18000),
              }
            : {}),
        })),
      };
    },
  };
}
