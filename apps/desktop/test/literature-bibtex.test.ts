import { describe, expect, it } from 'vitest';

import {
  createCitationKey,
  parseLiteratureBibtex,
  serializeLiteratureBibtex,
} from '../src/main/literature-bibtex';
import { LITERATURE_TRANSFER_MAX_RECORDS } from '../src/main/literature-transfer';
import type { LiteratureRecord } from '../src/shared/literature-contracts';

function record(title: string, overrides: Partial<LiteratureRecord> = {}): LiteratureRecord {
  return {
    schemaVersion: 1,
    id: '11111111-1111-4111-8111-111111111111',
    projectId: '22222222-2222-4222-8222-222222222222',
    provider: 'crossref',
    providerRecordId: 'raw-provider-identity',
    doi: '10.1000/EXAMPLE',
    fingerprint: 'f'.repeat(64),
    title,
    authors: ['Lovelace, Ada', 'Hopper, Grace'],
    containerTitle: 'Journal of Reliable Agents',
    publishedYear: 2026,
    sourceTopics: ['Research OS', 'Literature review'],
    workType: 'journal-article',
    citationCount: 42,
    sourceUrl: 'https://doi.org/10.1000/example',
    citationKey: '',
    reviewStatus: 'reviewed',
    manualAnnotations: {
      topics: ['Methods'],
      summary: 'Human summary with {braces}, \\, 50% & #1_$ ~ ^ and "quotes".',
      relevance: 'Core evidence.',
    },
    aiAnnotations: {
      topics: ['private-topic'],
      summary: 'private-ai-abstract',
      relevance: 'high',
      studyType: 'private-study-type',
      limitations: ['private-limitation'],
      provenance: {
        invocation: {
          schemaVersion: 1,
          invocationId: '33333333-3333-4333-8333-333333333333',
          providerId: 'codex',
          requestedModelId: null,
          resolvedModelId: 'private-model',
          catalogVersion: 'private-catalog',
          reasoningOptionId: null,
          startedAt: '2026-08-04T00:00:00.000Z',
        },
        inputSha256: 'a'.repeat(64),
        generatedAt: '2026-08-04T00:00:01.000Z',
        metadataOnly: true,
      },
    },
    annotationVersion: 1,
    version: 1,
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:01.000Z',
    ...overrides,
  };
}

describe('literature BibTeX transfer', () => {
  it('creates stable readable citation keys without a hard-coded model or provider', () => {
    expect(
      createCitationKey({
        title: 'The Analytical Engine for Science',
        authors: ['Lovelace, Ada'],
        publishedYear: 1843,
      }),
    ).toBe('Lovelace1843Analytical');
    expect(
      createCitationKey({
        title: 'Ignored because the stable key exists',
        authors: [],
        citationKey: 'Stable-Key:1',
      }),
    ).toBe('Stable-Key:1');
  });

  it('serializes deterministically, resolves duplicate keys, and omits private AI/provider data', () => {
    const first = record('Alpha evidence');
    const second = record('Beta evidence', {
      id: '44444444-4444-4444-8444-444444444444',
      doi: null,
    });
    const forward = serializeLiteratureBibtex([first, second]);
    const reverse = serializeLiteratureBibtex([second, first]);

    expect(forward).toBe(reverse);
    expect(forward).toContain('@article{Lovelace2026Alpha,');
    expect(forward).toContain('@article{Lovelace2026Beta,');
    expect(forward).not.toContain('raw-provider-identity');
    expect(forward).not.toContain('private-ai');
    expect(forward).not.toContain('private-model');
    expect(forward.toLowerCase()).not.toContain('abstract =');
    expect(forward).toContain('metadataonly = {true}');

    const duplicateA = record('Same title', { doi: '10.1000/b' });
    const duplicateB = record('Same title', {
      id: '55555555-5555-4555-8555-555555555555',
      doi: '10.1000/a',
    });
    const collisions = serializeLiteratureBibtex([duplicateA, duplicateB]);
    expect(collisions).toBe(serializeLiteratureBibtex([duplicateB, duplicateA]));
    expect(collisions).toContain('@article{Lovelace2026Same,');
    expect(collisions).toContain('@article{Lovelace2026Samea,');
  });

  it('round-trips deterministic GOSU fields and common nested BibTeX values', () => {
    const source = record('A {Safe} title');
    const serialized = serializeLiteratureBibtex([source]);
    const [restored] = parseLiteratureBibtex(serialized);

    expect(restored).toMatchObject({
      title: 'A {Safe} title',
      authors: ['Lovelace, Ada', 'Hopper, Grace'],
      doi: '10.1000/example',
      citationCount: 42,
      reviewStatus: 'reviewed',
      metadataOnly: true,
    });
    expect(restored?.manualAnnotations).toEqual(source.manualAnnotations);

    const external = `@article{Turing1950Computing,
      title = {Computing {Machinery} and Intelligence},
      author = "Turing, Alan M.",
      journal = {Mind},
      year = 1950,
      doi = {https://doi.org/10.1093/MIND/LIX.236.433}
    }`;
    expect(parseLiteratureBibtex(external)[0]).toMatchObject({
      title: 'Computing {Machinery} and Intelligence',
      authors: ['Turing, Alan M.'],
      containerTitle: 'Mind',
      publishedYear: 1950,
      doi: '10.1093/mind/lix.236.433',
      citationKey: 'Turing1950Computing',
    });
  });

  it('skips BibTeX special entries and percent line comments without treating them as papers', () => {
    const content = `% exported library header
      @STRING{journalName = "Mind"}
      % a comment between special entries
      @preamble{"Generated " # journalName}
      @comment{Ignored text with {nested braces} and @article{Fake, title={Fake}}}
      @comment(Ignored parenthesized comment with {a closing ) inside braces})

      % the only real record follows
      @article{Turing1950Computing,
        title = {Computing Machinery and Intelligence},
        % comments between fields are also trivia
        author = {Turing, Alan M.},
        journal = {Mind},
        year = {1950}
      }
      % trailing library comment
    `;

    expect(parseLiteratureBibtex(content)).toEqual([
      expect.objectContaining({
        title: 'Computing Machinery and Intelligence',
        citationKey: 'Turing1950Computing',
      }),
    ]);
  });

  it('rejects unsupported macro concatenation as a bounded invalid import', () => {
    expect(() =>
      parseLiteratureBibtex(`@article{MacroTitle,
        title = {Computing Machinery} # " and Intelligence",
        author = {Turing, Alan M.}
      }`),
    ).toThrowError(expect.objectContaining({ code: 'literature_import_invalid' }));
  });

  it('scans long backslash runs in linear time for special entries and delimited values', () => {
    const slashRun = '\\'.repeat(128 * 1024);
    const startedAt = performance.now();

    expect(
      parseLiteratureBibtex(`@comment{${slashRun}}
          @misc{FastRecord, title={Fast record}}`),
    ).toEqual([expect.objectContaining({ title: 'Fast record' })]);
    expect(() => parseLiteratureBibtex(`@misc{BoundedFailure, title={${slashRun}}}`)).toThrowError(
      expect.objectContaining({ code: 'literature_import_invalid' }),
    );

    expect(performance.now() - startedAt).toBeLessThan(2_000);
  }, 3_000);

  it('rejects malformed and over-count imports with bounded errors', () => {
    expect(() => parseLiteratureBibtex('@article{MissingTitle, year={2026}}')).toThrowError(
      expect.objectContaining({ code: 'literature_import_invalid' }),
    );
    expect(() => parseLiteratureBibtex('@article{Open, title={Never closed}')).toThrowError(
      expect.objectContaining({ code: 'literature_import_invalid' }),
    );
    expect(() => parseLiteratureBibtex('@comment{Never closed')).toThrowError(
      expect.objectContaining({ code: 'literature_import_invalid' }),
    );
    const oversized = Array.from(
      { length: LITERATURE_TRANSFER_MAX_RECORDS + 1 },
      (_, index) => `@misc{Key${index}, title={Title ${index}}}`,
    ).join('\n');
    expect(() => parseLiteratureBibtex(oversized)).toThrowError(
      expect.objectContaining({ code: 'literature_import_too_large' }),
    );
  });
});
