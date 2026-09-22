import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { normalizedMailSender } from './src/email-presentation';
import {
  AssistantQueuedMessageSchema,
  type AssistantQueuedMessage,
} from './src/assistant-queue-contract';
import { conversationDigest, type ConversationCheckpoint } from './briefing-context';
import { ConversationMessageSchema, type ConversationMessage } from './src/briefing-conversation';
import {
  MailContentProofSchema,
  MailCopySchema,
  pendingMailRechecks,
  deduplicateVerifiedMail,
} from './src/mail-duplicates';
import { PaperBibliographySchema } from './src/paper-bibliography';
import { isPriorityOnlyEmailSummary, latestSummaryItems } from './src/email-summary-quality';
import { initialRealWorkspace } from './src/workspace-defaults';
import { observedMailUnread } from './src/mail-read-state';
import { randomUUID, createHash } from 'node:crypto';
import {
  LiveSettingsSchema,
  InterestProfileSchema,
  mailTargets,
  type MailScope,
} from '@gosu/briefing-core';
import { SealedStateStore } from './sealed-state-store';
import { systemBriefingKey } from './briefing-system-key';
import { BriefingNotificationSchema } from './src/briefing-notifications';
import type { GenerationStatus } from './src/briefing-generation-contract';
import { briefingClientHash } from './briefing-client-context';
import {
  AssistantPreferencesSchema,
  defaultAssistantPreferences,
  EventDraftSchema,
} from './src/workspace-contracts';
import type { BriefingInsightSchema } from './src/briefing-intelligence';
import { PaperInsightSchema } from './src/briefing-intelligence';
import type { LiveItem, LiveSourceResult } from './src/live-types';
import { BriefingSnapshotSchema, type BriefingSnapshot } from './src/briefing-history-snapshot';
import { secretPattern } from './briefing-memory-store';
import { isCredentialMail } from './briefing-credential-mail';
import { safeAppleMailUrl } from './src/apple-mail-url';
import { MailNativeIdSchema } from './src/mail-open-contract';
import { MailAccountContextSchema, MailReceivedAtSchema } from './src/mail-account';
import { SummaryProvenanceSchema, type SummaryProvenance } from './src/summary-provenance';
import { indexSavedPapers, savedPaperKey, type SavedPaper } from './src/paper-library-index';
import { classificationKey, classificationDigest } from './paper-classification-data';
import { briefingLocalDay } from './src/briefing-generation-contract';
import type { ModelRouting } from '@gosu/contracts';
import { briefingProviderSummary, briefingRoutedProviders } from './briefing-model-routing';
import {
  ClassificationRecordSchema,
  PaperClassificationSchema,
  type PaperClassification,
} from './src/paper-classification';
import { assignPaperTags, buildPaperTagCatalog } from './src/paper-tags';
import {
  MAIL_COVERAGE_OVERLAP_MS,
  mailDeliveryKey,
  mailMessageKey,
  mailSummaryKey,
  needsMailReread,
  nextMailCoverage,
  planMailRead,
  type MailTargetCoverage,
} from './briefing-mail-ingestion';
import { recoverLegacyEmailTask } from './legacy-email-task';
import {
  RemovedBriefingSchema,
  removedHistoryKeys,
  historyGroupKey,
  type HistoryRemovalTarget,
  type HistoryRemovalReceipt,
} from './src/briefing-history-removal';
const ProfileSchema = z
  .object({
    routineId: z.string().max(128),
    name: z.string().max(160),
    timeZone: z.string().max(100),
    live: LiveSettingsSchema,
    interest: InterestProfileSchema,
    preferences: AssistantPreferencesSchema,
    approvedScope: z.string().nullable(),
    updatedAt: z.string(),
    owners: z.array(z.string()).max(8).default([]),
  })
  .strict();
export type AssistantProfile = z.infer<typeof ProfileSchema>;
const HistorySchema = z
  .object({
    id: z.string(),
    routineId: z.string(),
    createdAt: z.string(),
    kind: z.enum(['briefing', 'chat']),
    answer: z.string().max(16000),
    items: z
      .array(
        z.object({
          id: z.string(),
          title: z.string().max(1000),
          sourceUrl: z.string().optional(),
          paperPublishedAt: z.string().datetime().optional(),
          bibliography: PaperBibliographySchema.optional(),
          discoverySource: z.literal('google-scholar-alert').optional(),
          mailAccount: MailAccountContextSchema.optional(),
          mailSender: z.string().max(1000).optional(),
          mailContentProof: MailContentProofSchema.optional(),
          mailDuplicateCheckedAt: z.string().datetime().optional(),
          mailCopies: z.array(MailCopySchema).max(5).optional(),
          mailNativeId: MailNativeIdSchema.optional(),
          mailUnread: z.boolean().optional(),
          mailMarkedReadAt: z.string().datetime().optional(),
          receivedAt: MailReceivedAtSchema.optional(),
          mailMessageUrl: z
            .string()
            .max(3200)
            .refine((value) => Boolean(safeAppleMailUrl(value)))
            .optional(),
          readScope: z.string(),
          summary: z.string().max(1400),
          addedAt: z.string().datetime().optional(),
          importance: z.string(),
          relevance: z.string().max(900),
          kind: z.enum(['papers', 'email', 'weather']).optional(),
          keywords: PaperInsightSchema.shape.keywords,
          tags: PaperInsightSchema.shape.tags,
          detail: PaperInsightSchema.shape.detail,
          researchQuestion: PaperInsightSchema.shape.researchQuestion,
          strengths: PaperInsightSchema.shape.strengths,
          limitations: PaperInsightSchema.shape.limitations,
          methodsAndAssumptions: PaperInsightSchema.shape.methodsAndAssumptions,
          reportedResults: PaperInsightSchema.shape.reportedResults,
          importanceReason: PaperInsightSchema.shape.importanceReason.optional(),
          action: PaperInsightSchema.shape.action.optional(),
          preparedActions: PaperInsightSchema.shape.preparedActions,
          provenance: SummaryProvenanceSchema.optional(),
          classification: PaperClassificationSchema.optional(),
          figures: z
            .array(
              z.object({
                id: z.string().max(160),
                caption: z.string().max(2000),
                assetUrl: z.string().max(2000),
                imageData: z
                  .string()
                  .max(410000)
                  .regex(/^data:image\/webp;base64,[A-Za-z0-9+/=]+$/)
                  .optional(),
              }),
            )
            .max(2)
            .optional(),
          equations: z
            .array(z.object({ latex: z.string().max(2500), explanation: z.string().max(600) }))
            .max(4)
            .optional(),
        }),
      )
      .max(15),
    private: z.boolean(),
    runId: z.string().uuid().optional(),
    snapshot: BriefingSnapshotSchema.optional(),
    // Absent on legacy history: readable, but not eligible for personalized cache reuse.
    feedbackProfileRevision: z.number().int().nonnegative().nullable().optional(),
  })
  .strict();
export type BriefingHistory = z.infer<typeof HistorySchema>;
/** Cache bytes may be evicted; summaries, captions and source identities never are. */
export function retainPaperFigureCache(
  history: BriefingHistory[],
  budget = 6_000_000,
): BriefingHistory[] {
  let remaining = budget;
  return [...history]
    .reverse()
    .map((h) => ({
      ...h,
      items: h.items.map((i) => ({
        ...i,
        ...(i.figures
          ? {
              figures: i.figures.map((f) => {
                if (!f.imageData) return f;
                if (f.imageData.length <= remaining) {
                  remaining -= f.imageData.length;
                  return f;
                }
                const { imageData: _image, ...reference } = f;
                return reference;
              }),
            }
          : {}),
      })),
    }))
    .reverse();
}
export const CalendarActionSchema = z
  .object({
    id: z.string(),
    routineId: z.string(),
    kind: z.enum(['create', 'update', 'delete']),
    draft: EventDraftSchema,
    eventId: z.string().nullable(),
    fingerprint: z.string().nullable(),
    state: z.enum(['pending', 'applying', 'complete', 'unknown']),
    createdAt: z.string(),
    resultId: z.string().nullable(),
  })
  .strict();
export type CalendarAction = z.infer<typeof CalendarActionSchema>;
const Schema = z
  .object({
    version: z.literal(1),
    revision: z.number(),
    briefingNotifications: z.array(BriefingNotificationSchema).max(200).default([]),
    assistantQueue: z.array(AssistantQueuedMessageSchema).max(2000).default([]),
    removedPaperKeys: z.array(z.string()).max(10000).default([]),
    conversations: z
      .array(
        z.object({
          routineId: z.string(),
          scope: z.string(),
          /**
           * Which paper this conversation is about, for the chats that may read it. Recorded with
           * the conversation so the list does not depend on the paper still being in the library:
           * a briefing can be removed, and the conversation about its paper is still the user's.
           */
          paper: z
            .object({
              historyId: z.string().max(300),
              paperId: z.string().max(300),
              title: z.string().max(1000),
              /** The key this conversation is stored under, so a reader never has to rebuild it. */
              key: z.string().max(600),
            })
            .strict()
            .optional(),
          messages: z.array(ConversationMessageSchema).max(10000),
          /**
           * `/new`: the model is given the records from this index on. Earlier records stay for the
           * screen and for search_conversation; nothing is deleted. Absent means the whole list.
           */
          contextStartsAt: z.number().int().nonnegative().optional(),
          contextStartedAt: z.string().datetime().optional(),
          checkpoint: z
            .object({
              through: z.number().int().nonnegative(),
              digest: z.string().regex(/^[a-f0-9]{64}$/),
              summary: z.string().max(24000),
              createdAt: z.string().datetime(),
            })
            .optional(),
        }),
      )
      .max(1000)
      .default([]),
    profiles: z.array(ProfileSchema).max(100),
    history: z.array(HistorySchema).max(10000),
    paperArchive: z.array(HistorySchema).max(1000).default([]),
    paperClassifications: z.array(ClassificationRecordSchema).max(10000).default([]),
    removedBriefings: z.array(RemovedBriefingSchema).max(10000).default([]),
    actions: z.array(CalendarActionSchema).max(100),
    mailCollections: z
      .array(
        z
          .object({
            routineId: z.string().max(128),
            accountId: z.string().max(128),
            completedAt: z.string().datetime(),
          })
          .strict(),
      )
      .max(5000)
      .default([]),
    // Per mailbox: every message received in (coveredFrom, coveredTo] was examined and handled.
    // gapFrom marks the unexamined interval (gapFrom, coveredFrom] a later run must still read.
    mailCoverage: z
      .array(
        z
          .object({
            routineId: z.string().max(128),
            accountId: z.string().max(128),
            mailboxId: z.string().max(128),
            coveredFrom: z.string().datetime(),
            coveredTo: z.string().datetime(),
            gapFrom: z.string().datetime().nullable(),
            updatedAt: z.string().datetime(),
          })
          .strict(),
      )
      .max(5000)
      .default([]),
  })
  .strict();
/**
 * 논문 요약 AI is a separate chat from the AI 비서, so its turns are kept under a scope of their
 * own. The profile's own digest stays in front of the key, so changing what the routine may read
 * still starts a fresh conversation for a paper exactly as it does for the assistant.
 */
const PAPER_SCOPE_MARK = ':paper:';

/**
 * Whether one stored conversation is the chat being displayed, whatever permission scope it was
 * written under. The assistant owns every scope with no paper mark; a paper owns the scopes that
 * end with its own mark. Nothing belongs to both.
 */
const belongsToChat = (scope: string, paperKey?: string) => {
  const mark = scope.indexOf(PAPER_SCOPE_MARK);
  if (paperKey === undefined) return mark < 0;
  return mark >= 0 && scope.slice(mark) === paperScopeMark(paperKey);
};

const paperScopeMark = (paperKey: string) =>
  `${PAPER_SCOPE_MARK}${createHash('sha256').update(paperKey).digest('hex')}`;

const conversationScope = (profile: AssistantProfile, paperKey?: string) =>
  paperKey ? paperConversationScope(scopeDigest(profile), paperKey) : scopeDigest(profile);

export const paperConversationScope = (profileScope: string, paperKey: string) =>
  `${profileScope}${paperScopeMark(paperKey)}`;

const scopeDigest = (profile: AssistantProfile) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        mail: profile.live.mail,
        mailRead: profile.preferences.mailRead,
        mailAi: profile.preferences.mailAi,
        calendarRead: profile.preferences.calendarRead,
        ...(profile.preferences.todoRead ? { todoRead: true } : {}),
        ...(profile.preferences.projectRead ? { projectRead: true } : {}),
        calendarIds: [...profile.preferences.calendarIds].sort(),
        provider: profile.preferences.providerId,
      }),
    )
    .digest('hex');
/** The records a model turn may be given: everything after the latest `/new`. */
function modelFacingMessages(
  conversation:
    { messages: ConversationMessage[]; contextStartsAt?: number | undefined } | undefined,
) {
  if (!conversation) return [];
  const start = Math.min(conversation.contextStartsAt ?? 0, conversation.messages.length);
  return start ? conversation.messages.slice(start) : conversation.messages;
}
function appendHistory(history: BriefingHistory[], entry: BriefingHistory) {
  const itemKey = (h: BriefingHistory) =>
    h.items
      .map((i) => i.id)
      .sort()
      .join('|');
  const next = [
    ...history.filter(
      (h) =>
        !(
          entry.runId &&
          entry.items.length &&
          h.routineId === entry.routineId &&
          h.runId === entry.runId &&
          itemKey(h) === itemKey(entry)
        ),
    ),
    entry,
  ];
  // Never discard older runs or their images to make room for a new briefing.
  // The sealed-store byte limit fails the new save explicitly, preserving the previous file.
  if (next.length > 10000) throw new Error('briefing_memory_limit');
  return next;
}
// Separate retention from the rolling briefing feed. Never silently evict paper text.
function archivePapers(history: BriefingHistory[]) {
  const entries = new Map<string, BriefingHistory>();
  for (const h of [...history].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))) {
    if (h.kind !== 'briefing') continue;
    for (const item of h.items) {
      if (
        item.kind !== 'papers' &&
        !(!item.kind && /^(abstract|paper-|html-)/.test(item.readScope))
      )
        continue;
      entries.set(JSON.stringify([h.routineId, savedPaperKey(item)]), {
        ...h,
        snapshot: undefined,
        items: [item],
      });
    }
  }
  if (entries.size > 1000) throw new Error('briefing_memory_limit');
  // The library is durable storage, not an evictable thumbnail cache. The sealed
  // store's byte ceiling rejects a new oversized save atomically instead of erasing images.
  return [...entries.values()];
}
/** What the GOSU host may read from a routine on the user's behalf. */
export type BriefingHostReadKind = 'calendar' | 'mail' | 'briefings' | 'papers';

function hostReadAllowed(kind: BriefingHostReadKind, profile: AssistantProfile) {
  if (kind === 'mail')
    return Boolean(profile.preferences.mailRead && profile.preferences.mailAi && profile.live.mail);
  if (kind === 'calendar')
    return Boolean(profile.preferences.calendarRead && profile.preferences.calendarIds.length);
  return true;
}

export class BriefingWorkspaceStore {
  private state: SealedStateStore<z.infer<typeof Schema>>;
  /**
   * Settings → Agent, wired by the service that owns this store. Briefing has no provider picker of
   * its own: a provider the user assigned to a Briefing usage there may receive what the routine
   * allows for AI. Without a policy only the provider stored with the routine is accepted.
   */
  modelRouting?: (() => Promise<ModelRouting | undefined>) | undefined;
  private async providerAllowed(profile: AssistantProfile, provider: string) {
    if (provider === profile.preferences.providerId) return true;
    return briefingRoutedProviders(await this.modelRouting?.()).includes(provider);
  }
  constructor(
    directory = join(homedir(), 'Library', 'Application Support', 'GOSU', 'briefing-lab'),
    keyProvider = systemBriefingKey,
    private readonly reuseApprovedScopes: () => boolean = () => false,
  ) {
    this.state = new SealedStateStore(
      directory,
      {
        file: 'workspace.v1.enc.json',
        version: 1,
        aad: 'gosu-briefing-workspace-v1',
        empty: () => ({
          version: 1,
          revision: 0,
          briefingNotifications: [],
          assistantQueue: [],
          removedPaperKeys: [],
          conversations: [],
          profiles: [],
          history: [],
          paperArchive: [],
          paperClassifications: [],
          removedBriefings: [],
          actions: [],
          mailCollections: [],
          mailCoverage: [],
        }),
        parse: (value) => Schema.parse(value),
      },
      keyProvider,
    );
  }
  async profile(id: string) {
    return (await this.state.read()).profiles.find((p) => p.routineId === id) ?? null;
  }
  async chatQueue(profile: AssistantProfile, active: boolean) {
    const snapshot = await this.state.read();
    const current = snapshot.profiles.find((p) => p.routineId === profile.routineId);
    if (!current || !this.owns(current)) throw new Error('assistant_client_required');
    const owned = (q: AssistantQueuedMessage) =>
      q.routineId === profile.routineId && q.owner === briefingClientHash();
    const stale = (q: AssistantQueuedMessage) =>
      q.state !== 'failed' &&
      (q.scope !== scopeDigest(current) ||
        (q.state === 'claimed' && !active && Date.now() - Date.parse(q.updatedAt) > 30000));
    if (!snapshot.assistantQueue.some((q) => owned(q) && stale(q)))
      return snapshot.assistantQueue.filter(owned);
    return this.state.mutate((state) => {
      const current = state.profiles.find((p) => p.routineId === profile.routineId);
      if (!current || !this.owns(current)) throw new Error('assistant_client_required');
      const items = state.assistantQueue.filter(
        (q) => q.routineId === profile.routineId && q.owner === briefingClientHash(),
      );
      for (const q of items) {
        if (
          q.state !== 'failed' &&
          (q.scope !== scopeDigest(current) ||
            (q.state === 'claimed' && !active && Date.now() - Date.parse(q.updatedAt) > 30000))
        ) {
          q.state = 'failed';
          q.error = '실행이 중단됐거나 설정 범위가 변경됐습니다. 자동으로 재실행하지 않습니다.';
          q.revision++;
          delete q.token;
        }
      }
      return items;
    });
  }
  async enqueueChat(
    profile: AssistantProfile,
    id: string,
    prompt: string,
    attachmentIds: string[],
    paperReference?: AssistantQueuedMessage['paperReference'],
  ) {
    return this.state.mutate((state) => {
      const current = state.profiles.find((p) => p.routineId === profile.routineId);
      if (!current || !this.owns(current) || scopeDigest(current) !== scopeDigest(profile))
        throw new Error('assistant_settings_changed');
      const existing = state.assistantQueue.find((q) => q.id === id);
      if (existing) {
        if (
          existing.owner !== briefingClientHash() ||
          existing.routineId !== profile.routineId ||
          existing.prompt !== prompt ||
          JSON.stringify(existing.attachmentIds) !== JSON.stringify(attachmentIds) ||
          JSON.stringify(existing.paperReference) !== JSON.stringify(paperReference)
        )
          throw new Error('assistant_queue_conflict');
        return existing;
      }
      if (
        state.assistantQueue.filter(
          (q) => q.routineId === profile.routineId && q.owner === briefingClientHash(),
        ).length >= 20
      )
        throw new Error('assistant_queue_limit');
      const q = AssistantQueuedMessageSchema.parse({
        id,
        routineId: profile.routineId,
        owner: briefingClientHash(),
        scope: scopeDigest(current),
        prompt,
        attachmentIds,
        ...(paperReference ? { paperReference } : {}),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        revision: 0,
        state: 'queued',
      });
      state.assistantQueue.push(q);
      return q;
    });
  }
  async changeChatQueue(
    profile: AssistantProfile,
    id: string,
    revision: number,
    action: 'edit' | 'delete' | 'next',
    prompt?: string,
  ) {
    return this.state.mutate((state) => {
      const current = state.profiles.find((p) => p.routineId === profile.routineId);
      if (!current || !this.owns(current)) throw new Error('assistant_client_required');
      const q = state.assistantQueue.find(
        (q) => q.id === id && q.routineId === profile.routineId && q.owner === briefingClientHash(),
      );
      if (!q || q.state === 'claimed' || q.revision !== revision)
        throw new Error('assistant_queue_conflict');
      if (action === 'delete')
        state.assistantQueue = state.assistantQueue.filter((item) => item !== q);
      else {
        if (q.state !== 'queued' || q.scope !== scopeDigest(profile))
          throw new Error('assistant_queue_conflict');
        if (action === 'edit') q.prompt = z.string().trim().min(1).max(6000).parse(prompt);
        else state.assistantQueue = [q, ...state.assistantQueue.filter((item) => item !== q)];
        q.revision++;
        q.updatedAt = new Date().toISOString();
      }
      return q;
    });
  }
  async claimChatQueue(profile: AssistantProfile, id?: string) {
    return this.state.mutate((state) => {
      const current = state.profiles.find((p) => p.routineId === profile.routineId);
      if (!current || !this.owns(current) || scopeDigest(current) !== scopeDigest(profile))
        throw new Error('assistant_settings_changed');
      const own = state.assistantQueue.filter(
        (q) => q.routineId === profile.routineId && q.owner === briefingClientHash(),
      );
      if (own.some((q) => q.state === 'claimed')) return null;
      const q = own.find(
        (q) => q.state === 'queued' && q.scope === scopeDigest(current) && (!id || q.id === id),
      );
      if (!q) return null;
      q.state = 'claimed';
      q.token = randomUUID();
      q.revision++;
      q.updatedAt = new Date().toISOString();
      return q;
    });
  }
  async finishChatQueue(profile: AssistantProfile, id: string, token: string, error?: string) {
    await this.state.mutate((state) => {
      const q = state.assistantQueue.find(
        (q) =>
          q.routineId === profile.routineId &&
          q.owner === briefingClientHash() &&
          q.id === id &&
          q.token === token &&
          q.state === 'claimed',
      );
      if (!q) return;
      if (error) {
        q.state = 'failed';
        q.error = error.slice(0, 300);
        q.revision++;
        delete q.token;
      } else state.assistantQueue = state.assistantQueue.filter((item) => item !== q);
    });
  }
  async queuedChat(
    profile: AssistantProfile,
    id: string,
    token: string,
  ): Promise<AssistantQueuedMessage> {
    const state = await this.state.read();
    const current = state.profiles.find((p) => p.routineId === profile.routineId);
    const q = state.assistantQueue.find(
      (q) =>
        q.id === id &&
        q.routineId === profile.routineId &&
        q.owner === briefingClientHash() &&
        q.token === token &&
        q.state === 'claimed',
    );
    if (!current || !this.owns(current) || !q || q.scope !== scopeDigest(current))
      throw new Error('assistant_queue_conflict');
    return q;
  }
  async visibleLibraryPapers(routineId: string, papers: SavedPaper[]) {
    const state = await this.state.read();
    return papers.filter(
      (p) => !state.removedPaperKeys.includes(JSON.stringify([routineId, savedPaperKey(p.item)])),
    );
  }
  async removeLibraryPapers(profile: AssistantProfile, papers: SavedPaper[]) {
    await this.state.mutate((state) => {
      const current = state.profiles.find((p) => p.routineId === profile.routineId);
      if (!current || !this.owns(current) || JSON.stringify(current) !== JSON.stringify(profile))
        throw new Error('assistant_settings_changed');
      state.removedPaperKeys = [
        ...new Set([
          ...state.removedPaperKeys,
          ...papers.map((p) => JSON.stringify([profile.routineId, savedPaperKey(p.item)])),
        ]),
      ];
    });
  }
  async conversation(profile: AssistantProfile, paperKey?: string) {
    const state = await this.state.read();
    const current = state.profiles.find((p) => p.routineId === profile.routineId);
    if (!current || !this.owns(current) || scopeDigest(current) !== scopeDigest(profile))
      throw new Error('assistant_settings_changed');
    const scope = conversationScope(current, paperKey);
    return modelFacingMessages(
      state.conversations.find((c) => c.routineId === current.routineId && c.scope === scope),
    );
  }
  async recordBriefingNotification(
    profile: AssistantProfile,
    job: GenerationStatus,
    signal: AbortSignal,
    emailKeys?: readonly string[],
  ) {
    if (job.state !== 'complete' || !job.runId) return;
    await this.state.mutate((state) => {
      const current = state.profiles.find((p) => p.routineId === profile.routineId);
      if (!current || !this.owns(current) || scopeDigest(current) !== scopeDigest(profile))
        throw new Error('assistant_settings_changed');
      if (state.briefingNotifications.some((n) => n.id === job.id)) return;
      const removed = removedHistoryKeys(state.removedBriefings);
      const history = state.history.filter(
        (h) =>
          h.routineId === profile.routineId &&
          h.runId === job.runId &&
          !removed.has(historyGroupKey(h.routineId, h.runId, h.id)),
      );
      if (!history.length) return;
      const latest = deduplicateVerifiedMail(latestSummaryItems(history));
      const added = latest.filter(
        (item) => item.addedAt && Date.parse(item.addedAt) >= Date.parse(job.startedAt),
      );
      const emails = (
        emailKeys ? latest.filter((i) => emailKeys.includes(savedPaperKey(i))) : added
      ).filter(
        (i) =>
          (i.kind === 'email' || (!i.kind && i.readScope.startsWith('mail'))) &&
          !isPriorityOnlyEmailSummary(i.summary),
      );
      const total = emailKeys
        ? emailKeys.length
        : Math.max(job.discoveredEmails ?? 0, emails.length);
      const notification = BriefingNotificationSchema.parse({
        id: job.id,
        routineId: profile.routineId,
        runId: job.runId,
        createdAt: new Date().toISOString(),
        newEmails: total,
        emailSourceState:
          job.emailSourceState ??
          (emails.length ? 'ready' : profile.preferences.mailRead ? 'failed' : 'disabled'),
        importantEmails: emails.filter((i) => i.importance === 'high').length,
        unclassifiedEmails:
          total - emails.filter((i) => ['high', 'medium', 'low'].includes(i.importance)).length,
        newPapers: job.addedSummaries?.papers ?? 0,
        partial: Boolean(job.error),
      });
      state.briefingNotifications = [...state.briefingNotifications, notification].slice(-200);
    }, signal);
  }
  /** Trusted native app metadata projection; not exposed as an unauthenticated HTTP endpoint. */
  async desktopNotificationData(now = Date.now()) {
    const state = await this.state.read();
    const removed = removedHistoryKeys(state.removedBriefings);
    const visibleRuns = new Set(
      state.history
        .filter((h) => !removed.has(historyGroupKey(h.routineId, h.runId, h.id)))
        .map((h) => `${h.routineId}:${h.runId}`),
    );
    const profiles = state.profiles.filter((p) => p.preferences.calendarRead && this.approved(p));
    return {
      briefings: state.briefingNotifications.filter(
        (n) =>
          state.profiles.some((p) => p.routineId === n.routineId) &&
          visibleRuns.has(`${n.routineId}:${n.runId}`) &&
          now - Date.parse(n.createdAt) <= 30 * 86400000,
      ),
      calendarIds: [
        ...new Set(
          profiles
            .filter((p) => !this.requiresPerRequestConfirmation(p))
            .flatMap((p) => p.preferences.calendarIds),
        ),
      ].sort(),
      calendarOwners: Object.fromEntries(
        profiles
          .filter((p) => !this.requiresPerRequestConfirmation(p))
          .flatMap((p) => p.preferences.calendarIds.map((id) => [id, p.routineId])),
      ),
      calendarConfirmationRequired: profiles.some((p) => this.requiresPerRequestConfirmation(p)),
    };
  }
  /**
   * Local display for an already-owned routine. Never use this union as model input or approval.
   *
   * One scope only. Until 0.58.152 this flattened every conversation of the routine into one list,
   * so a question asked about a paper appeared in the AI 비서's own screen even once the two were
   * stored apart: 논문 요약 AI was a separate chat everywhere except where the user could see it.
   */
  async conversationDisplay(profile: AssistantProfile, paperKey?: string) {
    const state = await this.state.read();
    const current = state.profiles.find((p) => p.routineId === profile.routineId);
    if (!current || !this.owns(current) || scopeDigest(current) !== scopeDigest(profile))
      throw new Error('assistant_settings_changed');
    const scope = conversationScope(current, paperKey);
    const histories = state.conversations.filter((c) => c.routineId === current.routineId);
    // Which chat this is, across permission changes. An owner may read their own earlier chat
    // locally after the routine's permissions changed, which is why this is not an exact scope
    // match; what it must not do is put the two chats in one list.
    const mine = histories.filter((c) => belongsToChat(c.scope, paperKey));
    const current_ = mine.find((c) => c.scope === scope);
    return {
      messages: mine
        .flatMap((c) => c.messages)
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
      // Of what is shown, how much was written under a previous permission scope. The screen says
      // so and that those are not re-sent to the model. The other chat is not counted here: it is
      // not shown at all, and it lives on its own screen.
      otherScopeMessages: mine
        .filter((c) => c.scope !== scope)
        .reduce((sum, c) => sum + c.messages.length, 0),
      // Where the screen draws the "new conversation" line. Display only, never an approval.
      ...(current_?.contextStartedAt ? { contextStartedAt: current_.contextStartedAt } : {}),
    };
  }

  /**
   * How much has been asked about each paper, for the 논문 요약 list's mark and its filter. Keyed by
   * the conversation scope so the caller matches it with `paperConversationScope`. Counts only;
   * no message text leaves this method.
   */
  /**
   * Every paper this routine has a 논문 요약 AI conversation about, newest first. For the three
   * chats that may read those conversations without hosting them: they look here, and continue the
   * conversation in 논문 요약 where it lives.
   */
  async paperConversationIndex(profile: AssistantProfile, limit = 50) {
    const state = await this.state.read();
    const current = state.profiles.find((p) => p.routineId === profile.routineId);
    if (!current || !this.owns(current) || scopeDigest(current) !== scopeDigest(profile))
      throw new Error('assistant_settings_changed');
    const byMark = new Map<
      string,
      {
        messages: ConversationMessage[];
        paper?: { historyId: string; paperId: string; title: string; key: string };
      }
    >();
    for (const c of state.conversations) {
      if (c.routineId !== current.routineId) continue;
      const mark = c.scope.indexOf(PAPER_SCOPE_MARK);
      if (mark < 0) continue;
      const key = c.scope.slice(mark);
      const found = byMark.get(key) ?? { messages: [] };
      byMark.set(key, {
        messages: [...found.messages, ...c.messages],
        ...((c.paper ?? found.paper) ? { paper: c.paper ?? found.paper } : {}),
      });
    }
    return [...byMark.entries()]
      .map(([mark, found]) => {
        const ordered = [...found.messages].sort(
          (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
        );
        const asked = ordered.filter((m) => m.role === 'user');
        return {
          mark,
          ...(found.paper ? { paper: found.paper } : {}),
          turns: asked.length,
          lastAskedAt: asked.at(-1)?.createdAt ?? ordered.at(-1)?.createdAt ?? '',
          lastQuestion: (asked.at(-1)?.text ?? '').slice(0, 200),
        };
      })
      .filter((entry) => entry.turns > 0)
      .sort((a, b) => b.lastAskedAt.localeCompare(a.lastAskedAt))
      .slice(0, Math.max(1, Math.min(limit, 200)));
  }

  /** The mark that names one paper's conversation, for matching an index entry to a paper. */
  paperConversationMark(paperKey: string) {
    return paperScopeMark(paperKey);
  }

  async paperConversationCounts(profile: AssistantProfile, paperKeys: readonly string[]) {
    const state = await this.state.read();
    const current = state.profiles.find((p) => p.routineId === profile.routineId);
    if (!current || !this.owns(current) || scopeDigest(current) !== scopeDigest(profile))
      throw new Error('assistant_settings_changed');
    const mine = state.conversations.filter((c) => c.routineId === current.routineId);
    const counts: Record<string, { turns: number; lastAskedAt: string; lastQuestion: string }> = {};
    for (const key of new Set(paperKeys)) {
      // Every permission scope of this paper, so a count does not reset because a routine's
      // reading permissions changed.
      const asked = mine
        .filter((c) => belongsToChat(c.scope, key))
        .flatMap((c) => c.messages)
        .filter((m) => m.role === 'user')
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
      if (!asked.length) continue;
      counts[key] = {
        turns: asked.length,
        lastAskedAt: asked.at(-1)!.createdAt,
        lastQuestion: asked.at(-1)!.text.slice(0, 200),
      };
    }
    return counts;
  }
  /**
   * `/new`: later turns start from an empty context. Records are kept; the checkpoint summarized
   * the context that just ended, so it goes with it.
   */
  async startNewConversationContext(profile: AssistantProfile) {
    let result = { started: false, contextStartedAt: '', setAside: 0 };
    await this.state.mutate((state) => {
      const current = state.profiles.find((p) => p.routineId === profile.routineId);
      if (!current || !this.owns(current) || scopeDigest(current) !== scopeDigest(profile))
        throw new Error('assistant_settings_changed');
      const conversation = state.conversations.find(
        (c) => c.routineId === current.routineId && c.scope === scopeDigest(current),
      );
      const setAside = modelFacingMessages(conversation).length;
      if (!conversation || !setAside) {
        result = {
          started: false,
          contextStartedAt: conversation?.contextStartedAt ?? '',
          setAside: 0,
        };
        return;
      }
      const contextStartedAt = new Date().toISOString();
      conversation.contextStartsAt = conversation.messages.length;
      conversation.contextStartedAt = contextStartedAt;
      delete conversation.checkpoint;
      result = { started: true, contextStartedAt, setAside };
    });
    return result;
  }
  async appendConversation(
    profile: AssistantProfile,
    message: ConversationMessage,
    paperKey?: string,
    paper?: { historyId: string; paperId: string; title: string; key: string },
  ) {
    const parsed = ConversationMessageSchema.parse(message);
    await this.state.mutate((state) => {
      const current = state.profiles.find((p) => p.routineId === profile.routineId);
      if (!current || !this.owns(current) || scopeDigest(current) !== scopeDigest(profile))
        throw new Error('assistant_settings_changed');
      const scope = conversationScope(current, paperKey);
      let conversation = state.conversations.find(
        (c) => c.routineId === current.routineId && c.scope === scope,
      );
      if (!conversation) {
        conversation = { routineId: current.routineId, scope, messages: [] };
        state.conversations.push(conversation);
      }
      if (paper && paperKey) conversation.paper = paper;
      conversation.messages.push(parsed);
    });
  }
  async conversationCheckpoint(profile: AssistantProfile, paperKey?: string) {
    await this.conversation(profile, paperKey);
    const scope = conversationScope(profile, paperKey);
    return (await this.state.read()).conversations.find(
      (c) => c.routineId === profile.routineId && c.scope === scope,
    )?.checkpoint;
  }
  async saveConversationCheckpoint(profile: AssistantProfile, checkpoint: ConversationCheckpoint) {
    await this.state.mutate((state) => {
      const current = state.profiles.find((p) => p.routineId === profile.routineId);
      if (!current || !this.owns(current) || scopeDigest(current) !== scopeDigest(profile))
        throw new Error('assistant_settings_changed');
      const conversation = state.conversations.find(
        (c) => c.routineId === profile.routineId && c.scope === scopeDigest(profile),
      );
      // A checkpoint counts from the start of the current context, like the list the model gets.
      const facing = modelFacingMessages(conversation);
      if (
        !conversation ||
        checkpoint.through > facing.length ||
        conversationDigest(facing.slice(0, checkpoint.through)) !== checkpoint.digest
      )
        throw new Error('assistant_compaction_stale');
      if ((conversation.checkpoint?.through ?? 0) > checkpoint.through) return;
      conversation.checkpoint = checkpoint;
    });
  }
  /** Desktop main-frame bootstrap: configuration only, never grants/tokens or private records. */
  async desktopConfiguration() {
    const base = initialRealWorkspace(new Date().toISOString());
    const profiles = (await this.state.read()).profiles;
    if (!profiles.length) return base;
    return {
      ...base,
      selectedRoutineId: profiles[0]!.routineId,
      routines: profiles.map((p) => ({
        ...base.routines[0]!,
        id: p.routineId,
        name: p.name,
        interest: p.interest,
        live: { ...p.live, assistant: p.preferences },
        schedule: { ...base.routines[0]!.schedule, timeZone: p.timeZone },
        updatedAt: p.updatedAt,
      })),
    };
  }
  requiresApproval(profile: AssistantProfile) {
    return (
      profile.preferences.mailRead ||
      profile.preferences.mailAi ||
      profile.preferences.calendarRead ||
      Boolean(profile.preferences.todoRead) ||
      Boolean(profile.preferences.projectRead)
    );
  }
  approved(profile: AssistantProfile) {
    return profile.approvedScope === scopeDigest(profile);
  }
  requiresPerRequestConfirmation(profile: AssistantProfile) {
    return (
      profile.preferences.confirmationPolicy === 'ask' &&
      !(this.approved(profile) && this.reuseApprovedScopes())
    );
  }
  owns(profile: AssistantProfile) {
    const hash = briefingClientHash();
    return Boolean(hash && profile.owners.includes(hash));
  }
  async save(
    profile: Omit<AssistantProfile, 'approvedScope' | 'updatedAt' | 'owners'>,
    approve: (message: string) => Promise<void>,
    expectedProfile?: AssistantProfile,
    signal?: AbortSignal,
    beforeCommit?: () => void,
  ) {
    if (signal?.aborted) throw new Error('source_cancelled');
    const next = ProfileSchema.parse({
      ...profile,
      approvedScope: null,
      updatedAt: new Date().toISOString(),
    });
    const clientHash = briefingClientHash();
    if (!clientHash) throw new Error('assistant_client_required');
    if (next.preferences.mailRead && !next.live.mail)
      throw new Error('assistant_mail_scope_required');
    const old = await this.profile(next.routineId),
      digest = scopeDigest(next);
    const widening =
      this.requiresApproval(next) &&
      (!old ||
        (next.preferences.todoRead && !old.preferences.todoRead) ||
        (next.preferences.projectRead && !old.preferences.projectRead) ||
        !this.approved(old) ||
        (next.preferences.mailRead &&
          (!old.preferences.mailRead ||
            JSON.stringify(next.live.mail) !== JSON.stringify(old.live.mail))) ||
        (next.preferences.mailAi &&
          (!old.preferences.mailAi ||
            next.preferences.providerId !== old.preferences.providerId)) ||
        (next.preferences.calendarRead &&
          (!old.preferences.calendarRead ||
            next.preferences.calendarIds.some((id) => !old.preferences.calendarIds.includes(id)))));
    if (widening || !old || !this.owns(old))
      await approve(
        (next.preferences.projectRead
          ? 'GOSU의 모든 활성 프로젝트 대화·기억 접근을 허용합니다. 설정 → Agent에서 정한 모델의 제공자에 비공개 AI 자료가 전달될 수 있습니다.\n\n'
          : '') +
          `Briefing 설정 저장\n${next.name}\n메일 조회 ${next.preferences.mailRead ? '허용' : '차단'} / 메일·이 루틴의 private memory AI 사용 ${next.preferences.mailAi ? '허용' : '차단'}\n메일 범위: ${next.live.mail ? `선택한 ${mailTargets(next.live.mail).length}개 계정·메일함, 최근 ${next.live.mail.days}일 전체 최대 ${next.live.mail.limit}개, 본문 ${next.live.mail.bodyPreview ? '포함' : '제외'}` : '없음'}\nAI 모델: ${briefingProviderSummary(next.preferences, await this.modelRouting?.())}\nCalendar 조회 ${next.preferences.calendarRead ? `${next.preferences.calendarIds.length}개 캘린더` : '차단'}\nGOSU 할 일 조회 ${next.preferences.todoRead ? '허용' : '차단'}\n요청 확인 정책: ${next.preferences.confirmationPolicy === 'always' ? '설정한 범위는 항상 허용' : '매번 확인'}\n일정 쓰기와 macOS 권한은 별도 확인합니다.`,
      );
    next.approvedScope = this.requiresApproval(next) ? digest : null;
    next.owners = [...new Set([...(old?.owners ?? []), clientHash])].slice(-8);
    await this.state.mutate((s) => {
      if (signal?.aborted) throw new Error('source_cancelled');
      beforeCommit?.();
      if (
        expectedProfile &&
        JSON.stringify(s.profiles.find((p) => p.routineId === next.routineId)) !==
          JSON.stringify(expectedProfile)
      )
        throw new Error('assistant_settings_changed');
      const index = s.profiles.findIndex((p) => p.routineId === next.routineId);
      if (index < 0) s.profiles.push(next);
      else s.profiles[index] = next;
    });
    return next;
  }
  async publicProfile(id: string) {
    const p = await this.profile(id);
    return {
      preferences: p?.preferences ?? defaultAssistantPreferences(),
      approved: p ? this.approved(p) : false,
    };
  }
  async assertMail(id: string, scope: MailScope, ai = false, provider?: string) {
    const p = await this.profile(id);
    if (
      !p ||
      !this.approved(p) ||
      !this.owns(p) ||
      !p.preferences.mailRead ||
      (ai && !p.preferences.mailAi) ||
      (provider && !(await this.providerAllowed(p, provider))) ||
      JSON.stringify(p.live.mail) !== JSON.stringify(scope)
    )
      throw new Error('assistant_mail_permission_required');
    return p;
  }
  async mailReadPlan(id: string, scope: MailScope) {
    await this.assertMail(id, scope);
    const state = await this.state.read();
    const initialized = new Set(
      state.mailCollections.filter((r) => r.routineId === id).map((r) => r.accountId),
    );
    // Summary key -> the other two names for the same mail. The delivery key is what the reader
    // checks cheaply; the Message-ID key is what survives the message being moved, re-indexed, or
    // read from a second selected mailbox, which is how an identical mail got summarized twice.
    // One map so that every place that *un*-excludes a mail drops all three together.
    const excluded = new Map<string, { delivery: string; message?: string }>();
    const exclude = (itemId: string, receivedAt: string, title: string, messageUrl?: string) =>
      excluded.set(mailSummaryKey(itemId, receivedAt, title), {
        delivery: mailDeliveryKey(itemId, receivedAt),
        ...(messageUrl ? { message: mailMessageKey(messageUrl, receivedAt, title) } : {}),
      });
    for (const history of state.history) {
      if (history.routineId !== id || history.kind !== 'briefing') continue;
      for (const item of history.items) {
        if (
          !(item.kind === 'email' || (!item.kind && item.readScope.startsWith('mail'))) ||
          !item.summary.trim()
        )
          continue;
        if (item.mailAccount) initialized.add(item.mailAccount.id);
        // A body that could not be read is read again rather than trusted as summarized.
        if (needsMailReread(item, scope)) continue;
        for (const copy of item.mailCopies ?? []) {
          initialized.add(copy.account.id);
          if (/^[a-f0-9]{64}$/.test(copy.id))
            exclude(copy.id, copy.receivedAt, copy.title, item.mailMessageUrl);
        }
        // A title alone, a failed run or an unsummarized collection is never a duplicate.
        if (/^[a-f0-9]{64}$/.test(item.id) && item.receivedAt)
          exclude(item.id, item.receivedAt, item.title, item.mailMessageUrl);
      }
    }
    let recheckCount = 0;
    for (const item of latestSummaryItems(
      state.history.filter((h) => h.routineId === id && h.kind === 'briefing'),
    )) {
      if (
        (item.kind === 'email' || (!item.kind && item.readScope.startsWith('mail'))) &&
        isPriorityOnlyEmailSummary(item.summary)
      ) {
        if (item.receivedAt) excluded.delete(mailSummaryKey(item.id, item.receivedAt, item.title));
        for (const copy of item.mailCopies ?? [])
          excluded.delete(mailSummaryKey(copy.id, copy.receivedAt, copy.title));
      }
    }
    if (scope.bodyPreview) {
      const old = state.history
        .filter((h) => h.routineId === id && h.kind === 'briefing')
        .flatMap((h) => h.items)
        .filter(
          (i) =>
            i.summary.trim() && (i.kind === 'email' || (!i.kind && i.readScope.startsWith('mail'))),
        );
      const candidates = pendingMailRechecks(
        old,
        mailTargets(scope).map((t) => t.accountId),
      );
      recheckCount = candidates.length;
      for (const item of candidates)
        if (item.receivedAt) excluded.delete(mailSummaryKey(item.id, item.receivedAt, item.title));
    }
    const coverage = mailTargets(scope).flatMap((t) => {
      const record = state.mailCoverage.find(
        (r) => r.routineId === id && r.accountId === t.accountId && r.mailboxId === t.mailboxId,
      );
      return record
        ? [
            {
              accountId: t.accountId,
              mailboxId: t.mailboxId,
              stopAt: new Date(
                Date.parse(record.gapFrom ?? record.coveredTo) - MAIL_COVERAGE_OVERLAP_MS,
              ).toISOString(),
            },
          ]
        : [];
    });
    return {
      ...planMailRead(scope, [...initialized], [...excluded.keys()]),
      excludeDeliveries: [...new Set([...excluded.values()].map((known) => known.delivery))],
      excludeMessages: [
        ...new Set(
          [...excluded.values()].flatMap((known) => (known.message ? [known.message] : [])),
        ),
      ],
      ...(coverage.length ? { coverage } : {}),
      ...(recheckCount ? { recheckCount } : {}),
    };
  }
  /**
   * Commits what a run proved it examined, after its summaries were saved. A mailbox advances only
   * as far as the read reached without an unhandled message; anything below is recorded as a gap
   * that the next run reads first. Returns the gaps (and intervals that aged out of the approved
   * days window) so the run can warn instead of silently missing mail.
   */
  async commitMailCoverage(
    profile: AssistantProfile,
    reports: readonly MailTargetCoverage[],
    handled: ReadonlySet<string>,
    signal: AbortSignal,
  ) {
    const gaps: {
      accountName: string;
      from: string;
      to: string;
      agedOut: boolean;
      reason: 'limit' | 'body' | 'incomplete' | 'read-failed';
      pending?: number;
      pendingComplete?: boolean;
      bodyWaiting?: number;
    }[] = [];
    if (!reports.length) return gaps;
    const allowed = new Set(
      mailTargets(profile.live.mail).map((t) => `${t.accountId}|${t.mailboxId}`),
    );
    if (reports.some((r) => !allowed.has(`${r.accountId}|${r.mailboxId}`)))
      throw new Error('mail_scope_response_invalid');
    await this.state.mutate((state) => {
      if (
        JSON.stringify(state.profiles.find((p) => p.routineId === profile.routineId)) !==
        JSON.stringify(profile)
      )
        throw new Error('assistant_settings_changed');
      for (const report of reports) {
        const index = state.mailCoverage.findIndex(
          (r) =>
            r.routineId === profile.routineId &&
            r.accountId === report.accountId &&
            r.mailboxId === report.mailboxId,
        );
        const previous = index >= 0 ? state.mailCoverage[index]! : null;
        const next = nextMailCoverage(previous, report, handled);
        if (!next) {
          // A reader without coverage information (not the Apple Mail reader) proves nothing and
          // changes nothing; a failed or partial read is always reported, even before coverage exists.
          if (!report.failed && !report.partial) continue;
          gaps.push({
            accountName: report.accountName,
            from: previous ? (previous.gapFrom ?? previous.coveredTo) : report.since,
            to: report.startedAt,
            agedOut: false,
            reason: report.failed ? 'read-failed' : 'incomplete',
          });
          continue;
        }
        const record = {
          routineId: profile.routineId,
          accountId: report.accountId,
          mailboxId: report.mailboxId,
          coveredFrom: next.coveredFrom,
          coveredTo: next.coveredTo,
          gapFrom: next.gapFrom,
          updatedAt: new Date().toISOString(),
        };
        if (index >= 0) state.mailCoverage[index] = record;
        else state.mailCoverage.push(record);
        if (next.agedOutFrom)
          gaps.push({
            accountName: report.accountName,
            from: next.agedOutFrom,
            to: report.since,
            agedOut: true,
            reason: 'incomplete',
          });
        if (next.gapFrom)
          gaps.push({
            accountName: report.accountName,
            from: next.gapFrom,
            to: next.coveredFrom,
            agedOut: false,
            reason: next.reason ?? 'incomplete',
            pending: next.pending,
            pendingComplete: next.pendingComplete,
            bodyWaiting: next.bodyWaiting,
          });
      }
      if (state.mailCoverage.length > 5000)
        state.mailCoverage.splice(0, state.mailCoverage.length - 5000);
    }, signal);
    return gaps;
  }
  async completeMailRead(profile: AssistantProfile, accountIds: string[], signal: AbortSignal) {
    if (!accountIds.length) return;
    const allowed = new Set(mailTargets(profile.live.mail).map((a) => a.accountId));
    if (accountIds.some((id) => !allowed.has(id))) throw new Error('mail_scope_response_invalid');
    await this.state.mutate((state) => {
      if (
        JSON.stringify(state.profiles.find((p) => p.routineId === profile.routineId)) !==
        JSON.stringify(profile)
      )
        throw new Error('assistant_settings_changed');
      for (const accountId of accountIds)
        if (
          !state.mailCollections.some(
            (r) => r.routineId === profile.routineId && r.accountId === accountId,
          )
        )
          state.mailCollections.push({
            routineId: profile.routineId,
            accountId,
            completedAt: new Date().toISOString(),
          });
    }, signal);
  }
  async assertCalendar(id: string, ids: string[]) {
    const p = await this.profile(id);
    if (
      !p ||
      !this.approved(p) ||
      !this.owns(p) ||
      !p.preferences.calendarRead ||
      !ids.length ||
      ids.some((id) => !p.preferences.calendarIds.includes(id))
    )
      throw new Error('assistant_calendar_permission_required');
    return p;
  }
  /**
   * The GOSU app itself reading on the user's behalf (Project Chat), not a browser page: there is no
   * client token to own the routine, so the app's own trust boundary replaces `owns` while the saved
   * approval, scope and per-permission flags still gate every read.
   */
  async hostReadProfile(kind: BriefingHostReadKind) {
    const profiles = (await this.state.read()).profiles.filter(
      (p) => this.approved(p) && hostReadAllowed(kind, p),
    );
    return profiles[0] ?? null;
  }
  /** Re-reads the routine after a host read and fails when its scope or permission changed. */
  async assertHostRead(kind: BriefingHostReadKind, profile: AssistantProfile) {
    const current = await this.profile(profile.routineId);
    if (
      !current ||
      !this.approved(current) ||
      !hostReadAllowed(kind, current) ||
      scopeDigest(current) !== scopeDigest(profile)
    )
      throw new Error(`assistant_${kind === 'mail' ? 'mail' : kind}_permission_required`);
    return current;
  }
  /** Private briefings, papers and mail reach an AI only with the saved private-AI permission. */
  hostPrivateAllowed(profile: AssistantProfile) {
    return Boolean(this.approved(profile) && profile.preferences.mailAi);
  }
  async assertTodoRead(id: string) {
    const p = await this.profile(id);
    if (!p || !this.owns(p) || !this.approved(p) || !p.preferences.todoRead)
      throw new Error('assistant_todo_permission_required');
    return p;
  }
  async saveTodoSnapshot(
    routineId: string,
    runId: string,
    todos: unknown,
    profile: AssistantProfile,
    signal: AbortSignal,
    error?: string,
  ) {
    const parsed = todos ? BriefingSnapshotSchema.shape.todos.parse(todos) : undefined;
    await this.state.mutate((state) => {
      if (
        JSON.stringify(state.profiles.find((p) => p.routineId === routineId)) !==
        JSON.stringify(profile)
      )
        throw new Error('assistant_settings_changed');
      const entry = state.history.find(
        (h) => h.routineId === routineId && h.runId === runId && h.snapshot,
      );
      if (!entry?.snapshot) return;
      if (parsed) {
        entry.snapshot.todos = parsed;
        entry.private ||= parsed.items.length > 0;
      }
      if (error) entry.snapshot.todoError = error;
      else delete entry.snapshot.todoError;
    }, signal);
  }
  async canPrivateAi(id: string, provider: string) {
    const p = await this.profile(id);
    return Boolean(
      p &&
      this.approved(p) &&
      this.owns(p) &&
      p.preferences.mailAi &&
      (await this.providerAllowed(p, provider)),
    );
  }
  async saveBriefing(
    routineId: string,
    result: z.infer<typeof BriefingInsightSchema>,
    sources: {
      id: string;
      title: string;
      sourceUrl?: string;
      discoverySource?: LiveItem['discoverySource'];
      mailMessageUrl?: string;
      mailNativeId?: string;
      mailAccount?: LiveItem['mailAccount'];
      mailContentProof?: LiveItem['mailContentProof'];
      mailDuplicateCheckedAt?: string;
      mailCopies?: LiveItem['mailCopies'];
      mailUnread?: boolean;
      mailMarkedReadAt?: string;
      details?: string[];
      publishedAt?: string;
      bibliography?: LiveItem['bibliography'];
      readScope: string;
      kind: string;
      privateOrigin?: string;
      text?: string;
      paper?: LiveItem['paper'];
    }[],
    privateContext = false,
    expectedProfile?: AssistantProfile | null,
    feedbackProfileRevision?: number | null,
    runId?: string,
    provenance: Record<string, SummaryProvenance> = {},
  ) {
    // Withheld per item. Refusing the whole batch for one sign-in code mail lost the other five
    // summaries and, upstream, stopped the entire run.
    const withheld = new Set(sources.filter((s) => isCredentialMail(s)).map((s) => s.id));
    const items = result.items.filter(
      (i) => !withheld.has(i.id) && !secretPattern.test(JSON.stringify(i)),
    );
    if (result.items.length > 0 && items.length === 0) return null;
    // The narrative covers the whole batch, so it goes when anything in the batch was withheld.
    const overview =
      items.length === result.items.length && !secretPattern.test(result.overview)
        ? result.overview
        : '';
    result = { ...result, overview, items };
    const entry: BriefingHistory = {
      id: randomUUID(),
      routineId,
      kind: 'briefing',
      ...(runId ? { runId } : {}),
      ...(feedbackProfileRevision !== undefined ? { feedbackProfileRevision } : {}),
      createdAt: new Date().toISOString(),
      answer: result.overview,
      private:
        privateContext ||
        sources.some(
          (i) => i.kind === 'email' || i.kind === 'calendar' || i.privateOrigin === 'mail',
        ),
      items: result.items.map((i) => {
        const s = sources.find((s) => s.id === i.id)!;
        const mailUnread = s ? observedMailUnread(s) : undefined;
        return {
          id: i.id,
          title: s?.title ?? i.id,
          ...(s?.kind === 'email' && s.mailDuplicateCheckedAt
            ? { mailDuplicateCheckedAt: s.mailDuplicateCheckedAt }
            : {}),
          ...(s?.kind === 'email' && s.mailContentProof
            ? { mailContentProof: MailContentProofSchema.parse(s.mailContentProof) }
            : {}),
          ...(s?.kind === 'email' && s.mailCopies
            ? { mailCopies: z.array(MailCopySchema).max(5).parse(s.mailCopies) }
            : {}),
          ...(mailUnread !== undefined ? { mailUnread } : {}),
          ...(s?.kind === 'email' && s.mailMarkedReadAt
            ? { mailMarkedReadAt: s.mailMarkedReadAt }
            : {}),
          ...(s?.sourceUrl ? { sourceUrl: s.sourceUrl } : {}),
          ...(s?.kind === 'papers' && s.bibliography
            ? { bibliography: PaperBibliographySchema.parse(s.bibliography) }
            : {}),
          ...(s?.kind === 'papers' &&
          z.string().datetime({ offset: true }).safeParse(s.publishedAt).success
            ? { paperPublishedAt: new Date(s.publishedAt!).toISOString() }
            : {}),
          ...(s?.discoverySource ? { discoverySource: s.discoverySource } : {}),
          ...(s?.kind === 'email' && s.mailAccount
            ? { mailAccount: MailAccountContextSchema.parse(s.mailAccount) }
            : {}),
          ...(s?.kind === 'email' && normalizedMailSender(s.details?.[0])
            ? { mailSender: normalizedMailSender(s.details?.[0])! }
            : {}),
          ...(s?.kind === 'email' && MailReceivedAtSchema.safeParse(s.publishedAt).success
            ? { receivedAt: s.publishedAt! }
            : {}),
          ...(s?.kind === 'email' && safeAppleMailUrl(s.mailMessageUrl)
            ? { mailMessageUrl: safeAppleMailUrl(s.mailMessageUrl)! }
            : {}),
          ...(s?.kind === 'email' && MailNativeIdSchema.safeParse(s.mailNativeId).success
            ? { mailNativeId: s.mailNativeId! }
            : {}),
          readScope: s?.readScope ?? 'unknown',
          summary: i.summary,
          importance: i.importance,
          relevance: s?.kind === 'email' ? '' : i.relevance,
          kind: s?.kind as LiveItem['kind'],
          keywords: s?.kind === 'papers' ? (i.keywords ?? []) : [],
          ...(s?.kind === 'papers' && i.tags ? { tags: i.tags } : {}),
          detail: s?.kind === 'papers' ? (i.detail ?? '') : '',
          ...(s?.kind === 'papers'
            ? {
                researchQuestion: i.researchQuestion ?? '',
                strengths: i.strengths ?? '',
                limitations: i.limitations ?? '',
                methodsAndAssumptions: i.methodsAndAssumptions ?? '',
                reportedResults: i.reportedResults ?? '',
              }
            : {}),
          importanceReason: i.importanceReason,
          action: i.action,
          ...(s?.kind === 'email' && i.preparedActions !== undefined
            ? { preparedActions: i.preparedActions }
            : {}),
          ...(provenance[i.id] ? { provenance: provenance[i.id] } : {}),
          figures:
            s?.paper?.figures
              .filter((f) => i.figureIds.includes(f.id))
              .slice(0, 2)
              .map(({ id, caption, assetUrl, imageData }) => ({
                id,
                caption,
                assetUrl,
                ...(imageData ? { imageData } : {}),
              })) ?? [],
          equations:
            s?.kind === 'papers'
              ? i.equationIds.flatMap((id) => {
                  const eq = s.paper?.equations.find((e) => e.id === id);
                  return eq
                    ? [
                        {
                          latex: eq.latex,
                          explanation:
                            i.equationExplanations?.find((n) => n.equationId === id)?.explanation ??
                            '',
                        },
                      ]
                    : [];
                })
              : [],
        };
      }),
    };
    await this.state.mutate((s) => {
      if (
        expectedProfile &&
        JSON.stringify(s.profiles.find((p) => p.routineId === routineId)) !==
          JSON.stringify(expectedProfile)
      )
        throw new Error('assistant_settings_changed');
      // Recheck the current vocabulary inside the serialized commit; parallel summaries reuse it.
      const previousPapers = indexSavedPapers(
        [...s.paperArchive, ...s.history].filter(
          (h) => h.routineId === routineId && (!h.private || entry.private),
        ),
      );
      const catalog = buildPaperTagCatalog(previousPapers.map((p) => p.item));
      for (const item of entry.items)
        if (item.kind === 'papers') {
          const prior = previousPapers.find(
            (p) => p.private === entry.private && savedPaperKey(p.item) === savedPaperKey(item),
          )?.item;
          // A text-only refresh of the same version must not destroy already saved media.
          if (!item.equations?.length && prior?.equations?.length)
            item.equations = structuredClone(prior.equations);
          if (!item.figures?.length && prior?.figures?.length)
            item.figures = structuredClone(prior.figures);
          else
            for (const figure of item.figures ?? []) {
              const saved = prior?.figures?.find(
                (f) => f.id === figure.id && f.assetUrl === figure.assetUrl,
              );
              if (!figure.imageData && saved?.imageData) figure.imageData = saved.imageData;
            }
          item.bibliography ??= previousPapers.find(
            (p) => p.private === entry.private && savedPaperKey(p.item) === savedPaperKey(item),
          )?.item.bibliography;
          item.paperPublishedAt ??= previousPapers.find(
            (p) => p.private === entry.private && savedPaperKey(p.item) === savedPaperKey(item),
          )?.item.paperPublishedAt;
          item.tags = assignPaperTags(item.tags ?? item.keywords ?? [], catalog);
          for (const label of item.tags)
            if (!catalog.some((t) => t.label === label))
              catalog.push({ label, aliases: [], count: 1 });
        }
      s.paperArchive = archivePapers([...s.paperArchive, ...s.history, entry]);
      const daily = s.history.find(
        (h) => h.routineId === routineId && h.runId === entry.runId && h.snapshot?.daily,
      );
      if (daily?.snapshot?.daily) {
        for (const item of entry.items) {
          const original = s.history
            .filter((h) => h.routineId === routineId && h.runId === entry.runId)
            .flatMap((h) =>
              h.items.filter((i) => savedPaperKey(i) === savedPaperKey(item)).map((i) => i),
            )[0];
          if (!original || original.addedAt) item.addedAt = original?.addedAt ?? entry.createdAt;
        }
        daily.snapshot.daily.updatedAt = entry.createdAt;
      }
      s.history = appendHistory(s.history, entry);
    });
    return entry.id;
  }
  async history(id: string, query = '', limit = 12, offset = 0) {
    await this.recoverLegacyTasks(id);
    const state = await this.state.read(),
      removed = removedHistoryKeys(state.removedBriefings);
    return state.history
      .filter(
        (h) =>
          h.routineId === id &&
          !removed.has(historyGroupKey(h.routineId, h.runId, h.id)) &&
          JSON.stringify(h).toLowerCase().includes(query.toLowerCase()),
      )
      .reverse()
      .slice(offset, offset + Math.min(600, limit));
  }
  private async recoverLegacyTasks(id: string) {
    const state = await this.state.read();
    const profile = state.profiles.find((p) => p.routineId === id);
    if (!profile || !this.owns(profile)) return;
    const removed = removedHistoryKeys(state.removedBriefings);
    const updates = state.history
      .filter(
        (h) =>
          h.routineId === id &&
          h.kind === 'briefing' &&
          !removed.has(historyGroupKey(h.routineId, h.runId, h.id)),
      )
      .flatMap((h) =>
        h.items.flatMap((item) => {
          const prior = item.preparedActions?.task;
          const missing = item.preparedActions === undefined;
          if (
            !(item.kind === 'email' || (!item.kind && item.readScope.startsWith('mail'))) ||
            (!missing && (!prior?.dueDate || prior.dueAt !== undefined))
          )
            return [];
          const task = recoverLegacyEmailTask({
            title: item.title,
            summary: item.summary,
            action: item.action,
            receivedAt: item.receivedAt,
            timeZone: profile.timeZone,
          });
          const actions =
            task && (missing || (prior?.dueDate === task.dueDate && task.dueAt))
              ? missing
                ? { event: null, task }
                : {
                    ...item.preparedActions!,
                    task: {
                      ...prior!,
                      dueAt: task.dueAt,
                      timeZone: task.timeZone,
                      notice: `${prior!.notice} ${task.notice}`.slice(0, 1000),
                    },
                  }
              : null;
          return actions
            ? [
                {
                  historyId: h.id,
                  itemId: item.id,
                  actions,
                  source: JSON.stringify([
                    item.title,
                    item.summary,
                    item.action,
                    item.receivedAt,
                    item.preparedActions,
                  ]),
                },
              ]
            : [];
        }),
      );
    if (!updates.length) return;
    await this.state.mutate((current) => {
      const latest = current.profiles.find((p) => p.routineId === id);
      if (!latest || JSON.stringify(latest) !== JSON.stringify(profile) || !this.owns(latest))
        return;
      const removedNow = removedHistoryKeys(current.removedBriefings);
      for (const update of updates) {
        const item = current.history
          .find(
            (h) =>
              h.id === update.historyId &&
              h.routineId === id &&
              !removedNow.has(historyGroupKey(h.routineId, h.runId, h.id)),
          )
          ?.items.find((i) => i.id === update.itemId);
        if (
          item &&
          JSON.stringify([
            item.title,
            item.summary,
            item.action,
            item.receivedAt,
            item.preparedActions,
          ]) === update.source
        )
          item.preparedActions = update.actions;
      }
    });
  }
  async historyRecord(routineId: string, historyId: string) {
    const state = await this.state.read(),
      removed = removedHistoryKeys(state.removedBriefings);
    return (
      state.history.find(
        (h) =>
          h.routineId === routineId &&
          h.id === historyId &&
          !removed.has(historyGroupKey(h.routineId, h.runId, h.id)),
      ) ?? null
    );
  }
  async removeHistoryRun(
    target: HistoryRemovalTarget,
    signal: AbortSignal,
  ): Promise<HistoryRemovalReceipt> {
    return this.state.mutate((state) => {
      const profile = state.profiles.find((p) => p.routineId === target.routineId);
      if (!profile || !this.owns(profile)) throw new Error('assistant_client_required');
      const anchor = state.history.find(
        (h) =>
          h.routineId === target.routineId &&
          h.kind === 'briefing' &&
          ('historyId' in target ? h.id === target.historyId : h.runId === target.runId),
      );
      if (!anchor) throw new Error('briefing_history_item_missing');
      const key = historyGroupKey(anchor.routineId, anchor.runId, anchor.id);
      let removal = state.removedBriefings.find(
        (r) => !r.restoredAt && historyGroupKey(r.routineId, r.runId, r.historyId) === key,
      );
      if (!removal) {
        removal = {
          id: randomUUID(),
          routineId: target.routineId,
          historyId: anchor.id,
          runId: anchor.runId ?? null,
          createdAt:
            state.history.find(
              (h) => h.snapshot && historyGroupKey(h.routineId, h.runId, h.id) === key,
            )?.snapshot?.collectedAt ?? anchor.createdAt,
          routineName: profile.name,
          timeZone: profile.timeZone,
          deletedAt: new Date().toISOString(),
        };
        state.removedBriefings = [
          ...state.removedBriefings.filter(
            (r) => historyGroupKey(r.routineId, r.runId, r.historyId) !== key,
          ),
          removal,
        ];
      }
      return {
        deletionId: removal.id,
        routineId: target.routineId,
        runId: removal.runId,
        historyIds: state.history
          .filter((h) => historyGroupKey(h.routineId, h.runId, h.id) === key)
          .map((h) => h.id),
      };
    }, signal);
  }
  async removedBriefings(routineId: string) {
    const state = await this.state.read(),
      profile = state.profiles.find((p) => p.routineId === routineId);
    if (!profile || !this.owns(profile)) throw new Error('assistant_client_required');
    return state.removedBriefings
      .filter((r) => r.routineId === routineId && !r.restoredAt)
      .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  }
  async restoreHistoryRun(
    routineId: string,
    deletionId: string,
    signal: AbortSignal,
  ): Promise<HistoryRemovalReceipt> {
    return this.state.mutate((state) => {
      const profile = state.profiles.find((p) => p.routineId === routineId);
      if (!profile || !this.owns(profile)) throw new Error('assistant_client_required');
      const removal = state.removedBriefings.find(
        (r) => r.routineId === routineId && r.id === deletionId,
      );
      if (!removal) throw new Error('briefing_history_item_missing');
      removal.restoredAt ??= new Date().toISOString();
      const key = historyGroupKey(routineId, removal.runId, removal.historyId);
      return {
        deletionId,
        routineId,
        runId: removal.runId,
        historyIds: state.history
          .filter((h) => historyGroupKey(h.routineId, h.runId, h.id) === key)
          .map((h) => h.id),
      };
    }, signal);
  }
  async markMailRead(
    routineId: string,
    itemId: string,
    url: string,
    markedAt: string,
    profile: AssistantProfile,
    signal: AbortSignal,
  ) {
    await this.state.mutate((state) => {
      if (
        JSON.stringify(state.profiles.find((p) => p.routineId === routineId)) !==
        JSON.stringify(profile)
      )
        throw new Error('assistant_settings_changed');
      for (const h of state.history)
        if (h.routineId === routineId)
          for (const item of h.items) {
            if (
              item.id === itemId &&
              item.mailMessageUrl === url &&
              (item.kind === 'email' || item.readScope.startsWith('mail'))
            )
              item.mailMarkedReadAt = markedAt;
          }
    }, signal);
  }
  async recordMailSender(
    routineId: string,
    itemId: string,
    url: string,
    sender: string,
    profile: AssistantProfile,
    signal: AbortSignal,
  ) {
    const value = normalizedMailSender(sender);
    if (!value) throw new Error('mail_sender_unavailable');
    await this.state.mutate((state) => {
      if (
        JSON.stringify(state.profiles.find((p) => p.routineId === routineId)) !==
        JSON.stringify(profile)
      )
        throw new Error('assistant_settings_changed');
      for (const h of state.history)
        if (h.routineId === routineId)
          for (const item of h.items) {
            if (
              item.id === itemId &&
              item.mailMessageUrl === url &&
              (item.kind === 'email' || item.readScope.startsWith('mail')) &&
              !item.mailSender
            )
              item.mailSender = value;
          }
    }, signal);
  }
  /** Shared local retrieval boundary for UI, Briefing chat and a future scoped GOSU host. */
  async classificationViews(routineId: string, papers: SavedPaper[]): Promise<SavedPaper[]> {
    const records = new Map(
      (await this.state.read()).paperClassifications.map((r) => [r.key, r.value]),
    );
    return papers.map((p) => {
      const key = classificationKey(routineId, p);
      const value = records.get(key);
      const { classification: _previous, ...item } = p.item;
      return {
        ...p,
        classificationKey: key,
        item: {
          ...item,
          ...(value
            ? {
                classification: {
                  ...value,
                  stale: value.summaryDigest !== classificationDigest(item),
                },
              }
            : {}),
        },
      };
    });
  }
  /** Separate metadata ledger: never rewrites source summaries, provenance or summary dates. */
  async savePaperClassifications(
    profile: AssistantProfile,
    updates: {
      paper: SavedPaper;
      expectedRevision: number;
      value: Omit<PaperClassification, 'revision' | 'stale'>;
    }[],
    signal: AbortSignal,
  ) {
    const saved: string[] = [];
    await this.state.mutate((state) => {
      const current = state.profiles.find((p) => p.routineId === profile.routineId);
      if (!current || !this.owns(current) || JSON.stringify(current) !== JSON.stringify(profile))
        throw new Error('assistant_settings_changed');
      const history = [...state.paperArchive, ...state.history].filter(
        (h) => h.routineId === profile.routineId,
      );
      const latest = [false, true].flatMap((privateContext) =>
        indexSavedPapers(history.filter((h) => h.private === privateContext)),
      );
      for (const update of updates) {
        const key = classificationKey(profile.routineId, update.paper);
        const shared = update.paper.historyId.startsWith('shared:');
        const record = state.paperClassifications.find((r) => r.key === key);
        const paper = shared
          ? update.paper
          : latest.find((p) => classificationKey(profile.routineId, p) === key);
        if (
          !paper ||
          classificationDigest(paper.item) !== update.value.summaryDigest ||
          (record?.value.revision ?? 0) !== update.expectedRevision ||
          (update.value.source === 'ai' && record?.value.source === 'user')
        ) {
          if (update.value.source === 'user') throw new Error('paper_classification_changed');
          continue;
        }
        const next = ClassificationRecordSchema.parse({
          key,
          routineId: shared ? null : profile.routineId,
          value: { ...update.value, revision: update.expectedRevision + 1 },
        });
        if (record) Object.assign(record, next);
        else {
          if (state.paperClassifications.length >= 10000)
            throw new Error('paper_classification_capacity');
          state.paperClassifications.push(next);
        }
        saved.push(key);
      }
    }, signal);
    return saved;
  }
  async summaryHistory(id: string) {
    await this.recoverLegacyTasks(id);
    const state = await this.state.read();
    const classifications = new Map(state.paperClassifications.map((r) => [r.key, r.value]));
    const removed = removedHistoryKeys(state.removedBriefings);
    const grouped = new Map<string, BriefingHistory>();
    for (const h of [
      ...state.paperArchive,
      ...state.history.filter((h) => !removed.has(historyGroupKey(h.routineId, h.runId, h.id))),
    ].filter((h) => h.routineId === id)) {
      const previous = grouped.get(h.id);
      grouped.set(
        h.id,
        previous
          ? {
              ...h,
              private: previous.private || h.private,
              items: [
                ...new Map(
                  [...previous.items, ...h.items].map((i) => [savedPaperKey(i), i]),
                ).values(),
              ],
            }
          : h,
      );
    }
    return [...grouped.values()]
      .map((h) => ({
        ...h,
        items: h.items.map((item) => {
          const value = classifications.get(
            classificationKey(id, {
              historyId: h.id,
              savedAt: h.createdAt,
              private: h.private,
              item,
            }),
          );
          return {
            ...item,
            ...(value
              ? {
                  classification: {
                    ...value,
                    stale: value.summaryDigest !== classificationDigest(item),
                  },
                }
              : {}),
          };
        }),
      }))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }
  async dailyRun(profile: AssistantProfile, signal: AbortSignal, at = new Date().toISOString()) {
    const date = briefingLocalDay(at, profile.timeZone);
    let result!: {
      runId: string;
      date: string;
      hasWeather: boolean;
      hasCalendar: boolean;
      /** When today's record was last updated by an earlier run, or null for the day's first run. */
      previousUpdatedAt: string | null;
    };
    await this.state.mutate((state) => {
      const current = state.profiles.find((p) => p.routineId === profile.routineId);
      if (!current || !this.owns(current) || JSON.stringify(current) !== JSON.stringify(profile))
        throw new Error('assistant_settings_changed');
      const removed = removedHistoryKeys(state.removedBriefings);
      let entry = state.history
        .filter(
          (h) =>
            h.routineId === profile.routineId &&
            h.runId &&
            h.snapshot &&
            briefingLocalDay(h.snapshot.collectedAt, profile.timeZone) === date &&
            !removed.has(historyGroupKey(h.routineId, h.runId, h.id)),
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      const previousUpdatedAt = entry?.snapshot?.daily?.updatedAt ?? null;
      if (!entry) {
        entry = HistorySchema.parse({
          id: randomUUID(),
          runId: randomUUID(),
          routineId: profile.routineId,
          kind: 'briefing',
          createdAt: at,
          answer: '',
          items: [],
          private: false,
          snapshot: {
            collectedAt: at,
            routineName: profile.name,
            timeZone: profile.timeZone,
            sources: [],
            daily: { date, updatedAt: at },
          },
        });
        state.history = appendHistory(state.history, entry);
      }
      entry.snapshot!.daily ??= { date, updatedAt: at };
      // Each accepted generation replaces the routine's New window, including an empty or
      // subsequently failed generation. Keep original arrival times and all saved content.
      for (const history of state.history)
        if (history.routineId === profile.routineId && history.snapshot)
          history.snapshot.newItemsSince = at;
      result = {
        runId: entry.runId!,
        date,
        hasWeather: Boolean(entry.snapshot!.weather),
        hasCalendar: Boolean(entry.snapshot!.calendar),
        previousUpdatedAt,
      };
    }, signal);
    return result;
  }
  async dailyItemKeys(routineId: string, runId: string) {
    const scope = (await this.profile(routineId))?.live.mail ?? null;
    return latestSummaryItems(
      (await this.history(routineId, '', 10000)).filter((h) => h.runId === runId),
    )
      .filter(
        (i) =>
          !(
            (i.kind === 'email' || (!i.kind && i.readScope.startsWith('mail'))) &&
            (isPriorityOnlyEmailSummary(i.summary) || needsMailReread(i, scope))
          ),
      )
      .map(
        (i) =>
          `${i.kind ?? (i.readScope.startsWith('mail') ? 'email' : 'papers')}:${savedPaperKey(i)}`,
      );
  }
  async saveCollection(
    routineId: string,
    runId: string,
    results: LiveSourceResult[],
    profile: AssistantProfile | null,
    signal: AbortSignal,
  ) {
    const weather = results.flatMap((result) => result.items).find((item) => item.weather)?.weather;
    const snapshot = BriefingSnapshotSchema.parse({
      collectedAt: new Date().toISOString(),
      routineName: profile?.name ?? '개인 연구 브리핑',
      timeZone: profile?.timeZone ?? weather?.timeZone ?? 'Asia/Seoul',
      ...(weather ? { weather } : {}),
      sources: results.map((result) => ({
        kind: result.kind,
        status: result.status,
        count: result.items.length,
        ...(result.error ? { error: result.error } : {}),
        ...(result.notice ? { notice: result.notice } : {}),
      })),
    });
    const entry = HistorySchema.parse({
      id: randomUUID(),
      routineId,
      runId,
      snapshot,
      kind: 'briefing',
      createdAt: snapshot.collectedAt,
      answer: '',
      items: [],
      private: false,
    });
    await this.state.mutate((state) => {
      if (
        profile &&
        JSON.stringify(state.profiles.find((p) => p.routineId === routineId)) !==
          JSON.stringify(profile)
      )
        throw new Error('assistant_settings_changed');
      state.paperArchive = archivePapers([...state.paperArchive, ...state.history]);
      const existing = state.history.find(
        (h) => h.routineId === routineId && h.runId === runId && h.snapshot,
      );
      if (existing?.snapshot?.daily) {
        existing.snapshot.weather ??= snapshot.weather;
        existing.snapshot.sources = [
          ...new Map(
            [...existing.snapshot.sources, ...snapshot.sources].map((s) => [s.kind, s]),
          ).values(),
        ];
        existing.snapshot.daily.updatedAt = snapshot.collectedAt;
      } else if (!existing) state.history = appendHistory(state.history, entry);
    }, signal);
  }
  /** The quick briefing already saved in today's record, which a later run continues. */
  async dailyQuickBriefing(routineId: string, runId: string) {
    return (
      (await this.history(routineId, '', 10000)).find(
        (h) => h.runId === runId && h.snapshot?.quickBriefing,
      )?.snapshot?.quickBriefing ?? null
    );
  }
  async saveQuickBriefing(
    routineId: string,
    runId: string,
    value: NonNullable<BriefingSnapshot['quickBriefing']>,
    profile: AssistantProfile,
    signal: AbortSignal,
  ) {
    const quickBriefing = BriefingSnapshotSchema.shape.quickBriefing.unwrap().parse(value);
    await this.state.mutate((state) => {
      if (
        JSON.stringify(state.profiles.find((p) => p.routineId === routineId)) !==
        JSON.stringify(profile)
      )
        throw new Error('assistant_settings_changed');
      const entry = state.history.find(
        (h) => h.routineId === routineId && h.runId === runId && h.snapshot,
      );
      if (!entry?.snapshot) return;
      entry.snapshot.quickBriefing = quickBriefing;
      // Written from mail subjects and senders.
      entry.private = true;
    }, signal);
  }
  async saveAgendaSnapshot(
    routineId: string,
    runId: string,
    events: NonNullable<BriefingSnapshot['calendar']>,
    profile: AssistantProfile,
    signal: AbortSignal,
    referenceAt?: string,
  ) {
    const calendar = BriefingSnapshotSchema.shape.calendar.parse(events);
    await this.state.mutate((state) => {
      if (
        JSON.stringify(state.profiles.find((p) => p.routineId === routineId)) !==
        JSON.stringify(profile)
      )
        throw new Error('assistant_settings_changed');
      const entry = state.history.find(
        (h) => h.routineId === routineId && h.runId === runId && h.snapshot,
      );
      if (!entry?.snapshot) return;
      entry.snapshot.calendar = calendar;
      if (referenceAt) entry.snapshot.calendarReferenceAt = referenceAt;
      entry.private ||= Boolean(calendar?.length);
    }, signal);
  }
  async action(value: Omit<CalendarAction, 'id' | 'state' | 'createdAt' | 'resultId'>) {
    const action = CalendarActionSchema.parse({
      ...value,
      id: randomUUID(),
      state: 'pending',
      createdAt: new Date().toISOString(),
      resultId: null,
    });
    await this.state.mutate((s) => {
      s.actions = [...s.actions, action].slice(-100);
    });
    return action;
  }
  async getAction(id: string, routineId: string) {
    return (
      (await this.state.read()).actions.find((a) => a.id === id && a.routineId === routineId) ??
      null
    );
  }
  async transition(
    id: string,
    from: CalendarAction['state'],
    to: CalendarAction['state'],
    resultId: string | null = null,
  ) {
    await this.state.mutate((s) => {
      const a = s.actions.find((a) => a.id === id);
      if (!a || a.state !== from) throw new Error('calendar_action_stale');
      a.state = to;
      a.resultId = resultId;
    });
  }
}
