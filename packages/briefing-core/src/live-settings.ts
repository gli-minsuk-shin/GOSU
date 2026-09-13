import { z } from 'zod';
export const DEFAULT_MAIL_LIMIT = 50;
export const MAX_MAIL_LIMIT = 100;
export const MAIL_LIMIT_ERROR = `메일 조회 개수는 1~${MAX_MAIL_LIMIT} 사이의 정수로 입력해주세요.`;
export const AssistantPreferencesSchema = z
  .object({
    autoPaperSummary: z.boolean(),
    mailRead: z.boolean(),
    mailAi: z.boolean(),
    mailBodyPreview: z.boolean().default(true),
    calendarRead: z.boolean(),
    todoRead: z.boolean().optional(),
    projectRead: z.boolean().optional(),
    calendarIds: z.array(z.string().max(300)).max(30),
    providerId: z.enum(['codex', 'claude-code']),
    modelId: z.string().max(256).nullable(),
    reasoning: z.string().max(128).nullable(),
    confirmationPolicy: z.enum(['always', 'ask']).default('always'),
    // Optional for old profiles; absent means always for explicit original-Mail clicks only.
    mailOpenConfirmation: z.enum(['always', 'ask']).optional(),
  })
  .strict();
export type AssistantPreferences = z.infer<typeof AssistantPreferencesSchema>;
export const defaultAssistantPreferences = (): AssistantPreferences => ({
  autoPaperSummary: true,
  mailRead: false,
  mailAi: false,
  mailBodyPreview: true,
  calendarRead: false,
  calendarIds: [],
  providerId: 'codex',
  modelId: null,
  reasoning: null,
  confirmationPolicy: 'always',
  mailOpenConfirmation: 'always',
});
export const WeatherLocationSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().min(1).max(200),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    country: z.string().max(100),
    timeZone: z.string().max(100),
  })
  .strict();
const MailTargetSchema = z
  .object({
    accountId: z.string().min(1).max(128),
    mailboxId: z.string().min(1).max(128),
    // Display snapshots only; authority is always checked using the opaque IDs.
    accountName: z.string().max(200).optional(),
    mailboxName: z.string().max(500).optional(),
  })
  .strict();
export const MailScopeSchema = z
  .object({
    ...MailTargetSchema.shape,
    days: z.number().int().min(1).max(30),
    limit: z
      .number({ error: MAIL_LIMIT_ERROR })
      .int({ error: MAIL_LIMIT_ERROR })
      .min(1, { error: MAIL_LIMIT_ERROR })
      .max(MAX_MAIL_LIMIT, { error: MAIL_LIMIT_ERROR }),
    subject: z.string().max(200),
    sender: z.string().max(200),
    unreadOnly: z.boolean(),
    bodyPreview: z.boolean(),
    additionalAccounts: z.array(MailTargetSchema).max(4).optional(),
  })
  .strict()
  .refine((scope) => {
    const ids = [scope.accountId, ...(scope.additionalAccounts ?? []).map((a) => a.accountId)];
    return new Set(ids).size === ids.length;
  }, 'Each Mail account may select one mailbox.');
export const LiveSettingsSchema = z
  .object({
    weather: WeatherLocationSchema.nullable(),
    papers: z
      .object({
        enabled: z.boolean(),
        days: z.number().int().min(1).max(3650),
        limit: z.number().int().min(1).max(30),
        author: z.string().max(120),
        scholarAlerts: z.boolean().optional(),
      })
      .strict(),
    mail: MailScopeSchema.nullable(),
    assistant: AssistantPreferencesSchema.optional(),
  })
  .strict();
export type WeatherLocation = z.infer<typeof WeatherLocationSchema>;
export type MailScope = z.infer<typeof MailScopeSchema>;
export type MailTarget = z.infer<typeof MailTargetSchema>;
export const mailTargets = (scope: MailScope | null): MailTarget[] =>
  scope
    ? [
        {
          accountId: scope.accountId,
          mailboxId: scope.mailboxId,
          ...(scope.accountName !== undefined ? { accountName: scope.accountName } : {}),
          ...(scope.mailboxName !== undefined ? { mailboxName: scope.mailboxName } : {}),
        },
        ...(scope.additionalAccounts ?? []),
      ]
    : [];
export function withMailTargets(scope: MailScope, targets: MailTarget[]): MailScope | null {
  if (!targets.length) return null;
  const { accountName: _name, mailboxName: _box, additionalAccounts: _extra, ...filters } = scope;
  return {
    ...filters,
    ...targets[0]!,
    ...(targets.length > 1 ? { additionalAccounts: targets.slice(1) } : {}),
  };
}
export type LiveSettings = z.infer<typeof LiveSettingsSchema>;
export const defaultLiveSettings = (): LiveSettings => ({
  weather: null,
  papers: { enabled: true, days: 30, limit: 10, author: '' },
  mail: null,
});
