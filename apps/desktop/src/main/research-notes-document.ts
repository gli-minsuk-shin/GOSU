import {
  ResearchNotesDocumentEnvelopeSchema,
  ResearchNotesTimestampSchema,
  type ResearchNotesDocumentEnvelope,
} from '../shared/research-notes-document-contracts';

export type ResearchNotesFrontmatterProperty = string | number | boolean | null | readonly string[];

export type ResearchNotesDocumentInput = Readonly<{
  envelope: ResearchNotesDocumentEnvelope;
  body: string;
  properties?: Readonly<Record<string, ResearchNotesFrontmatterProperty>>;
}>;

const FRONTMATTER_LIMIT = 64 * 1_024;
const RESERVED_KEYS = new Set([
  'gosu_schema_version',
  'gosu_document_id',
  'gosu_document_kind',
  'gosu_managed',
  'created_at',
  'modified_at',
  'tags',
  'gosu_project_id',
  'gosu_project_name',
  'gosu_origin',
  'gosu_origin_session_id',
  'gosu_origin_session_name',
  'gosu_creator_id',
  'gosu_creator_name',
  'related_documents',
  'related_papers',
  'gosu_provenance',
]);

function serialized(value: ResearchNotesFrontmatterProperty | Readonly<Record<string, unknown>>) {
  return JSON.stringify(value);
}

function sortedRecord(value: Readonly<Record<string, unknown>>) {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function validateProperties(
  properties: Readonly<Record<string, ResearchNotesFrontmatterProperty>> | undefined,
) {
  const entries = Object.entries(properties ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (entries.length > 64) throw new Error('research_notes_frontmatter_too_many_properties');
  for (const [key, value] of entries) {
    if (!/^[a-z][a-z0-9_]{0,63}$/u.test(key) || RESERVED_KEYS.has(key)) {
      throw new Error('research_notes_frontmatter_property_invalid');
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('research_notes_frontmatter_property_invalid');
    }
    if (typeof value === 'string' && value.length > 8_192) {
      throw new Error('research_notes_frontmatter_property_invalid');
    }
    if (
      Array.isArray(value) &&
      (value.length > 256 || value.some((item) => typeof item !== 'string' || item.length > 2_048))
    ) {
      throw new Error('research_notes_frontmatter_property_invalid');
    }
  }
  return entries;
}

export function serializeResearchNotesDocument(input: ResearchNotesDocumentInput) {
  const envelope = ResearchNotesDocumentEnvelopeSchema.parse(input.envelope);
  if (input.body.includes('\0')) throw new Error('research_notes_markdown_contains_nul');
  const normalizedBody = input.body.replace(/\r\n?/gu, '\n').trimEnd();
  if (/^\s*---(?:\n|$)/u.test(normalizedBody)) {
    throw new Error('research_notes_markdown_contains_frontmatter');
  }
  const properties = validateProperties(input.properties);
  const lines = [
    '---',
    'gosu_schema_version: 2',
    `gosu_document_id: ${serialized(envelope.documentId)}`,
    `gosu_document_kind: ${serialized(envelope.kind)}`,
    `gosu_managed: ${envelope.managed}`,
    `created_at: ${serialized(envelope.createdAt)}`,
    `modified_at: ${serialized(envelope.modifiedAt)}`,
    `tags: ${serialized(envelope.tags)}`,
    `gosu_project_id: ${serialized(envelope.projectId)}`,
    `gosu_project_name: ${serialized(envelope.projectName)}`,
    `gosu_origin: ${serialized(envelope.origin)}`,
    `gosu_origin_session_id: ${serialized(envelope.originSessionId)}`,
    `gosu_origin_session_name: ${serialized(envelope.originSessionName)}`,
    `gosu_creator_id: ${serialized(envelope.creatorId)}`,
    `gosu_creator_name: ${serialized(envelope.creatorName)}`,
    `related_documents: ${serialized(envelope.relatedDocuments)}`,
    `related_papers: ${serialized(envelope.relatedPapers)}`,
    `gosu_provenance: ${serialized(sortedRecord(envelope.provenance))}`,
    ...properties.map(([key, value]) => `${key}: ${serialized(value)}`),
    '---',
  ];
  return `${lines.join('\n')}\n\n${normalizedBody}${normalizedBody ? '\n' : ''}`;
}

export function extractResearchNotesCreatedAt(markdown: string) {
  const bounded = markdown.slice(0, FRONTMATTER_LIMIT);
  const frontmatter = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(bounded)?.[1];
  if (!frontmatter) return null;
  const raw = /^created_at:\s*(.+)\s*$/mu.exec(frontmatter)?.[1];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    const timestamp = ResearchNotesTimestampSchema.safeParse(parsed);
    return timestamp.success ? timestamp.data : null;
  } catch {
    return null;
  }
}

export function uniqueResearchNotesValues(values: readonly (string | null | undefined)[]) {
  return [
    ...new Set(values.map((value) => value?.trim()).filter((value): value is string => !!value)),
  ];
}
