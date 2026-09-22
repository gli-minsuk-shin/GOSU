import type { ModelModule } from './model-lab-schema';

/**
 * Model Assistant's discussion of a single module — its first explanation and the follow-up questions
 * asked from the module detail dialog — kept with the project's Model Lab workspace.
 */
export const MODULE_EXPLANATIONS_STORAGE_KEY = 'gosu.model-lab.module-explanations.v1';

export type ModuleExplanationMessage = Readonly<{
  role: 'user' | 'assistant';
  body: string;
  createdAt: string;
}>;
export type ModuleExplanation = Readonly<{
  messages: readonly ModuleExplanationMessage[];
  createdAt: string;
  updatedAt: string;
}>;
export type ModuleExplanations = Readonly<{
  schemaVersion: 1;
  models: Readonly<Record<string, Readonly<Record<string, ModuleExplanation>>>>;
}>;

const MAX_BODY = 20_000;
const MAX_MESSAGES = 20;
const MAX_PER_MODEL = 200;
const MAX_MODELS = 64;
const EMPTY: ModuleExplanations = { schemaVersion: 1, models: {} };

function fnv1a(text: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** The module's id plus a digest of what it computes, so an edited module is discussed anew. */
export function moduleExplanationKey(module: Pick<ModelModule, 'id' | 'transform' | 'formula'>) {
  return `${module.id}#${fnv1a(`${module.transform}\n${module.formula}`)}`;
}

function readEntry(value: unknown): ModuleExplanation | null {
  const entry = (value ?? {}) as Partial<ModuleExplanation> & { body?: unknown };
  const createdAt = typeof entry.createdAt === 'string' ? entry.createdAt : null;
  if (!createdAt) return null;
  // A pre-conversation entry held one answer; it becomes the first assistant message.
  const messages = Array.isArray(entry.messages)
    ? entry.messages.flatMap((message) => {
        const { role, body, createdAt: at } = (message ?? {}) as Partial<ModuleExplanationMessage>;
        return (role === 'user' || role === 'assistant') && typeof body === 'string' && body
          ? [
              {
                role,
                body: body.slice(0, MAX_BODY),
                createdAt: typeof at === 'string' ? at : createdAt,
              },
            ]
          : [];
      })
    : typeof entry.body === 'string' && entry.body
      ? [{ role: 'assistant' as const, body: entry.body.slice(0, MAX_BODY), createdAt }]
      : [];
  if (messages.length === 0) return null;
  return {
    messages: messages.slice(-MAX_MESSAGES),
    createdAt,
    updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : createdAt,
  };
}

export function readModuleExplanations(raw: string | null | undefined): ModuleExplanations {
  if (!raw) return EMPTY;
  try {
    const value = JSON.parse(raw) as unknown;
    if (
      !value ||
      typeof value !== 'object' ||
      (value as { schemaVersion?: unknown }).schemaVersion !== 1
    )
      return EMPTY;
    const models = (value as { models?: unknown }).models;
    if (!models || typeof models !== 'object' || Array.isArray(models)) return EMPTY;
    const clean: Record<string, Record<string, ModuleExplanation>> = {};
    for (const [modelId, entries] of Object.entries(models).slice(0, MAX_MODELS)) {
      if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue;
      const kept: Record<string, ModuleExplanation> = {};
      for (const [key, entry] of Object.entries(entries).slice(0, MAX_PER_MODEL)) {
        const parsed = readEntry(entry);
        if (parsed) kept[key] = parsed;
      }
      clean[modelId] = kept;
    }
    return { schemaVersion: 1, models: clean };
  } catch {
    return EMPTY;
  }
}

export function moduleExplanation(
  store: ModuleExplanations,
  modelId: string,
  module: Pick<ModelModule, 'id' | 'transform' | 'formula'>,
): ModuleExplanation | null {
  return store.models[modelId]?.[moduleExplanationKey(module)] ?? null;
}

/**
 * Appends this module's newest messages, keeping the last ones within the size bounds. Passing
 * `replace` starts the discussion again, as the "explain again" button does.
 */
export function withModuleExplanation(
  store: ModuleExplanations,
  modelId: string,
  module: Pick<ModelModule, 'id' | 'transform' | 'formula'>,
  added: readonly ModuleExplanationMessage[],
  replace = false,
): ModuleExplanations {
  const key = moduleExplanationKey(module);
  const existing = replace ? null : (store.models[modelId]?.[key] ?? null);
  const messages = [...(existing?.messages ?? []), ...added]
    .map((message) => ({ ...message, body: message.body.slice(0, MAX_BODY) }))
    .slice(-MAX_MESSAGES);
  const updatedAt = messages.at(-1)?.createdAt ?? new Date().toISOString();
  const entry: ModuleExplanation = {
    messages,
    createdAt: existing?.createdAt ?? messages[0]?.createdAt ?? updatedAt,
    updatedAt,
  };
  const others = Object.entries(store.models[modelId] ?? {}).filter(
    ([candidate]) => candidate !== key,
  );
  const bounded = [...others, [key, entry] as const]
    .sort(([, left], [, right]) => left.updatedAt.localeCompare(right.updatedAt))
    .slice(-MAX_PER_MODEL);
  const otherModels = Object.entries(store.models)
    .filter(([id]) => id !== modelId)
    .slice(-(MAX_MODELS - 1));
  return {
    schemaVersion: 1,
    models: { ...Object.fromEntries(otherModels), [modelId]: Object.fromEntries(bounded) },
  };
}
