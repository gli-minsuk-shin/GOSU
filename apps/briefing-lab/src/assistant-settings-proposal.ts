import { z } from 'zod';
import { defaultLiveSettings, MAX_MAIL_LIMIT, type BriefingRoutine } from '@gosu/briefing-core';
export const SettingsProposalSchema = z
  .object({
    mailDays: z.number().int().min(1).max(30).optional(),
    mailLimit: z.number().int().min(1).max(MAX_MAIL_LIMIT).optional(),
    paperDays: z.number().int().min(1).max(3650).optional(),
    paperLimit: z.number().int().min(1).max(30).optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, 'empty proposal');
export type SettingsProposal = z.infer<typeof SettingsProposalSchema>;
export function settingsProposalText(p: SettingsProposal) {
  return [
    p.mailDays !== undefined && `메일 최근 ${p.mailDays}일`,
    p.mailLimit !== undefined && `메일 최대 ${p.mailLimit}개`,
    p.paperDays !== undefined && `논문 최근 ${p.paperDays}일`,
    p.paperLimit !== undefined && `논문 최대 ${p.paperLimit}개`,
  ]
    .filter(Boolean)
    .join(' · ');
}
/** Unsaved draft only: preserves grants, accounts and schedules. */
export function settingsProposalDraft(
  routine: BriefingRoutine,
  raw: SettingsProposal,
): BriefingRoutine {
  const p = SettingsProposalSchema.parse(raw);
  const live = routine.live ?? defaultLiveSettings();
  if (!live.mail && (p.mailDays !== undefined || p.mailLimit !== undefined))
    throw new Error('먼저 메일 계정을 연결해주세요.');
  return {
    ...routine,
    live: {
      ...live,
      mail: live.mail
        ? {
            ...live.mail,
            ...(p.mailDays !== undefined ? { days: p.mailDays } : {}),
            ...(p.mailLimit !== undefined ? { limit: p.mailLimit } : {}),
          }
        : null,
      papers: {
        ...live.papers,
        ...(p.paperDays !== undefined ? { days: p.paperDays } : {}),
        ...(p.paperLimit !== undefined ? { limit: p.paperLimit } : {}),
      },
    },
  };
}
