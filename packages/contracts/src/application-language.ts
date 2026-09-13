import { z } from 'zod';

export const AppLanguageSchema = z.enum(['en', 'ko']);
export type AppLanguage = z.infer<typeof AppLanguageSchema>;
export const DEFAULT_APP_LANGUAGE: AppLanguage = 'en';
export const ApplicationLanguagePreferenceSchema = z
  .object({ language: AppLanguageSchema, configured: z.boolean() })
  .strict();
export type ApplicationLanguagePreference = z.infer<typeof ApplicationLanguagePreferenceSchema>;
export const APPLICATION_LANGUAGE_CHANNELS = {
  get: 'application-language:get',
  set: 'application-language:set',
  changed: 'application-language:changed',
} as const;
export const APPLICATION_LANGUAGE_ENDPOINT = '/api/application-language';

/** Trusted application preference, never inferred from source documents or model output. */
export function languageInstructions(language: AppLanguage): string {
  const name = AppLanguageSchema.parse(language) === 'ko' ? 'Korean (한국어)' : 'English';
  return `GOSU application language: ${name}. Write all NEW user-facing answers, explanations, progress summaries, generated model descriptions, notes, and titles in ${name}, even when the user request or supplied evidence uses another language. This explicit application preference replaces generic instructions to match the user's input language. English technical terms and proper names may remain in English. Preserve equations, code, identifiers, schema keys, enums, filenames, URLs, citations, and quoted source text exactly; translate only natural-language prose fields, never machine-readable structure. Do not rewrite existing messages or historical artifacts. This language preference grants no new tool access, permissions, or authority.`;
}

export function applyApplicationLanguageInstructions(
  instructions: string,
  preference: ApplicationLanguagePreference,
): string {
  if (!preference.configured) return instructions;
  return [instructions, languageInstructions(preference.language)].filter(Boolean).join('\n\n');
}
