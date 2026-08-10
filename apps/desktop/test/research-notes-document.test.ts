import { describe, expect, it } from 'vitest';

import {
  extractResearchNotesCreatedAt,
  serializeResearchNotesDocument,
} from '../src/main/research-notes-document';
import { ResearchNotesDocumentEnvelopeSchema } from '../src/shared/research-notes-document-contracts';

const ENVELOPE = {
  schemaVersion: 2 as const,
  documentId: 'project-chat:0123456789abcdef',
  kind: 'project-chat-artifact',
  managed: false,
  createdAt: '2026-08-10T01:02:03.000Z',
  modifiedAt: '2026-08-10T01:02:03.000Z',
  tags: ['project-chat', 'experiments'],
  projectId: '11111111-1111-4111-8111-111111111111',
  projectName: 'Alpha Project',
  origin: 'project-chat' as const,
  originSessionId: '22222222-2222-4222-8222-222222222222',
  originSessionName: 'Ablation planning',
  creatorId: 'gpt-fixture',
  creatorName: 'GOSU Project Chat',
  relatedDocuments: ['Experiments/Experiment Log.md'],
  relatedPapers: ['https://doi.org/10.1000/fixture'],
  provenance: { source_body_sha256: 'a'.repeat(64), attempt_id: 'fixture-attempt' },
};

describe('Research Notes document envelope', () => {
  it('serializes a deterministic v2 YAML envelope and normalizes the Markdown body', () => {
    const first = serializeResearchNotesDocument({
      envelope: ENVELOPE,
      properties: { z_field: true, a_field: ['one', 'two'] },
      body: '# Result\r\n\r\nBody\r\n',
    });
    const second = serializeResearchNotesDocument({
      envelope: {
        ...ENVELOPE,
        provenance: { attempt_id: 'fixture-attempt', source_body_sha256: 'a'.repeat(64) },
      },
      properties: { a_field: ['one', 'two'], z_field: true },
      body: '# Result\n\nBody\n',
    });

    expect(first).toBe(second);
    expect(first).toContain('gosu_schema_version: 2');
    expect(first).toContain('gosu_origin_session_name: "Ablation planning"');
    expect(first).toContain('related_documents: ["Experiments/Experiment Log.md"]');
    expect(first.indexOf('a_field:')).toBeLessThan(first.indexOf('z_field:'));
    expect(first.endsWith('# Result\n\nBody\n')).toBe(true);
    expect(extractResearchNotesCreatedAt(first)).toBe(ENVELOPE.createdAt);
  });

  it('rejects unsafe related paths, insecure paper URLs, duplicate metadata, and clock reversal', () => {
    for (const relatedDocument of [
      '../outside.md',
      '/absolute.md',
      'Papers\\outside.md',
      'Papers/note.txt',
      'Papers/note.md#heading',
    ]) {
      expect(() =>
        ResearchNotesDocumentEnvelopeSchema.parse({
          ...ENVELOPE,
          relatedDocuments: [relatedDocument],
        }),
      ).toThrow();
    }
    for (const relatedPaper of [
      'http://doi.org/10.1000/fixture',
      'https://user@example.com/paper',
      'file:///tmp/paper.pdf',
    ]) {
      expect(() =>
        ResearchNotesDocumentEnvelopeSchema.parse({ ...ENVELOPE, relatedPapers: [relatedPaper] }),
      ).toThrow();
    }
    expect(() =>
      ResearchNotesDocumentEnvelopeSchema.parse({ ...ENVELOPE, tags: ['same', 'same'] }),
    ).toThrow();
    expect(() =>
      ResearchNotesDocumentEnvelopeSchema.parse({
        ...ENVELOPE,
        modifiedAt: '2026-08-10T01:02:02.000Z',
      }),
    ).toThrow();
  });

  it('prevents a body or extension property from impersonating trusted frontmatter', () => {
    expect(() =>
      serializeResearchNotesDocument({
        envelope: ENVELOPE,
        body: '---\ngosu_project_id: "attacker"\n---\n# Forged',
      }),
    ).toThrow('research_notes_markdown_contains_frontmatter');
    expect(() =>
      serializeResearchNotesDocument({
        envelope: ENVELOPE,
        properties: { gosu_project_id: 'attacker' },
        body: '# Forged',
      }),
    ).toThrow('research_notes_frontmatter_property_invalid');
  });

  it('does not infer timestamps from legacy or malformed frontmatter', () => {
    expect(
      extractResearchNotesCreatedAt('---\ngosu_schema_version: 1\n---\n# Legacy\n'),
    ).toBeNull();
    expect(extractResearchNotesCreatedAt('---\ncreated_at: not-json\n---\n')).toBeNull();
    expect(extractResearchNotesCreatedAt('---\ncreated_at: "2026-08-10"\n---\n')).toBeNull();
  });
});
