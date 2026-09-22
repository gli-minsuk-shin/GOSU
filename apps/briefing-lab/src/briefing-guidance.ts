import { z } from 'zod';

export const MAX_GUIDANCE_ITEMS = 20;
/** Fired with `{ routineId, items }` after a saved change so the history view re-pins mail. */
export const BRIEFING_GUIDANCE_CHANGED = 'gosu:briefing-guidance-changed';
export const MAX_GUIDANCE_TEXT = 300;

/** One standing instruction the user wrote for this routine's AI summaries. */
export const BriefingGuidanceItemSchema = z
  .object({
    id: z.string().uuid(),
    text: z.string().min(1).max(MAX_GUIDANCE_TEXT),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type BriefingGuidanceItem = z.infer<typeof BriefingGuidanceItemSchema>;

export const normalizedGuidanceText = (value: string) => value.replace(/\s+/gu, ' ').trim();

export type GuidanceSenderRule = { itemId: string; kind: 'address' | 'domain'; value: string };

const DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}$/;
const LOCAL = /^[a-z0-9._%+-]+$/;

/**
 * Mail addresses and domains written in the guidance. Only these are matched deterministically; names
 * and institutions written in words are left to the model. Korean particles end an address because
 * only ASCII address characters are read ("kim@yonsei.ac.kr에서").
 */
export function guidanceSenderRules(items: readonly { id: string; text: string }[]) {
  const rules: GuidanceSenderRule[] = [];
  const seen = new Set<string>();
  for (const item of items)
    for (const [raw] of item.text.toLowerCase().matchAll(/[a-z0-9._%+@-]+/g)) {
      const token = raw.replace(/^[._-]+|[._-]+$/g, '');
      const at = token.indexOf('@');
      let rule: GuidanceSenderRule | null;
      if (at < 0)
        rule = DOMAIN.test(token) ? { itemId: item.id, kind: 'domain', value: token } : null;
      else if (at === 0) {
        const domain = token.slice(1);
        rule = DOMAIN.test(domain) ? { itemId: item.id, kind: 'domain', value: domain } : null;
      } else {
        const [local, domain = ''] = [token.slice(0, at), token.slice(at + 1)];
        rule =
          LOCAL.test(local) && DOMAIN.test(domain)
            ? { itemId: item.id, kind: 'address', value: token }
            : null;
      }
      if (!rule || seen.has(`${rule.kind}:${rule.value}`)) continue;
      seen.add(`${rule.kind}:${rule.value}`);
      rules.push(rule);
    }
  return rules;
}

/** The address in a From header ("Name <a@b.c>" or a bare address), lowercased. */
export function senderAddress(sender: string | undefined) {
  if (!sender) return null;
  const bracketed = /<([^<>\s]+@[^<>\s]+)>/.exec(sender)?.[1];
  const candidate = (bracketed ?? /[^\s<>"']+@[^\s<>"']+/.exec(sender)?.[0])?.toLowerCase();
  if (!candidate) return null;
  const at = candidate.lastIndexOf('@');
  return LOCAL.test(candidate.slice(0, at)) && DOMAIN.test(candidate.slice(at + 1))
    ? candidate
    : null;
}

export function matchesGuidanceSender(
  sender: string | undefined,
  rules: readonly GuidanceSenderRule[],
) {
  const address = senderAddress(sender);
  if (!address || !rules.length) return false;
  const domain = address.slice(address.lastIndexOf('@') + 1);
  return rules.some((rule) =>
    rule.kind === 'address'
      ? rule.value === address
      : domain === rule.value || domain.endsWith(`.${rule.value}`),
  );
}
