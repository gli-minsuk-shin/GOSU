import { createHash } from 'node:crypto';

import type { LiteratureRecord } from '../shared/literature-contracts';
import type { ProjectRecord } from '../shared/workspace-contracts';

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function yaml(value: unknown) {
  return JSON.stringify(value);
}

function line(value: string | null | undefined) {
  return (value ?? '')
    .replace(/[\r\n]+/gu, ' ')
    .replace(/\[\[/gu, '\\[\\[')
    .replace(/!\[/gu, '\\![')
    .trim();
}

function markdownCell(value: string | null | undefined) {
  return line(value).replace(/\\/gu, '\\\\').replace(/\|/gu, '\\|') || '—';
}

function markdownText(value: string | null | undefined) {
  return line(value).replace(/^([#>*+-])/gu, '\\$1') || '—';
}

function layer(record: LiteratureRecord) {
  return record.discovery?.tier ?? 'unclassified';
}

const LAYER_ORDER = Object.freeze({ core: 0, rising: 1, broad: 2, unclassified: 3 });

export function serializeLiteratureReviewMarkdown(
  project: ProjectRecord,
  inputRecords: readonly LiteratureRecord[],
) {
  const records = [...inputRecords].sort((left, right) => {
    const layerDifference = LAYER_ORDER[layer(left)] - LAYER_ORDER[layer(right)];
    if (layerDifference !== 0) return layerDifference;
    const leftClassified = left.discovery?.classifiedAt ?? '';
    const rightClassified = right.discovery?.classifiedAt ?? '';
    if (leftClassified !== rightClassified) return rightClassified.localeCompare(leftClassified);
    const rankDifference =
      (left.discovery?.tierRank ?? Number.MAX_SAFE_INTEGER) -
      (right.discovery?.tierRank ?? Number.MAX_SAFE_INTEGER);
    if (rankDifference !== 0) return rankDifference;
    const yearDifference = (right.publishedYear ?? 0) - (left.publishedYear ?? 0);
    if (yearDifference !== 0) return yearDifference;
    const titleDifference = left.title.localeCompare(right.title, 'en', { sensitivity: 'base' });
    return titleDifference || left.id.localeCompare(right.id);
  });
  const canonical = JSON.stringify(
    records.map((record) => ({
      id: record.id,
      version: record.version,
      annotationVersion: record.annotationVersion,
      updatedAt: record.updatedAt,
    })),
  );
  const sourceSha256 = sha256(canonical);
  const latestUpdatedAt = records.reduce(
    (latest, record) => (record.updatedAt > latest ? record.updatedAt : latest),
    project.updatedAt,
  );
  const counts = { core: 0, rising: 0, broad: 0, unclassified: 0 };
  for (const record of records) counts[layer(record)] += 1;
  const rows = records.map((record) => {
    const tags = [
      ...(record.searchTags?.topics ?? []).map((tag) => `topic:${tag}`),
      ...(record.searchTags?.keywords ?? []).map((tag) => `keyword:${tag}`),
    ];
    const doi = record.doi
      ? `[${markdownCell(record.doi)}](https://doi.org/${encodeURIComponent(record.doi)})`
      : '—';
    return `| ${markdownCell(record.title)} | ${markdownCell(record.authors.join(', '))} | ${markdownCell(record.containerTitle)} | ${record.publishedYear ?? '—'} | ${record.citationCount ?? '—'} | ${markdownCell(layer(record))} | ${markdownCell(record.reviewStatus)} | ${markdownCell(tags.join(', '))} | ${doi} |`;
  });

  return `---
gosu_schema_version: 1
gosu_document_kind: "literature-review"
gosu_managed: true
gosu_project_id: ${yaml(project.id)}
gosu_source_sha256: ${yaml(sourceSha256)}
record_count: ${records.length}
metadata_only: true
updated_at: ${yaml(latestUpdatedAt)}
---
<!-- GOSU-MANAGED-FILE v1: this table is regenerated from the encrypted local Literature library. -->

# Literature Review — ${markdownText(project.name)}

> Metadata-only projection. Citation counts and discovery layers are provider metadata, not verified evidence quality. GOSU did not automatically read paper full text.

## Overview

| Layer | Papers |
|---|---:|
| Core & canonical | ${counts.core} |
| Rising & recent | ${counts.rising} |
| Broad discovery | ${counts.broad} |
| Imported / unclassified | ${counts.unclassified} |

## Evidence table

| Title | Authors | Journal / venue | Year | Cited by | Layer | Review status | Search tags | DOI |
|---|---|---|---:|---:|---|---|---|---|
${rows.length > 0 ? rows.join('\n') : '| _No saved papers yet_ | — | — | — | — | — | — | — | — |'}
`;
}

export function serializePaperNoteMarkdown(project: ProjectRecord, record: LiteratureRecord) {
  const tags = [
    ...(record.searchTags?.topics ?? []).map((tag) => `topic:${tag}`),
    ...(record.searchTags?.keywords ?? []).map((tag) => `keyword:${tag}`),
  ];
  return `---
gosu_schema_version: 1
gosu_document_kind: "literature-paper-note"
gosu_project_id: ${yaml(project.id)}
gosu_record_id: ${yaml(record.id)}
citation_key: ${yaml(record.citationKey)}
title: ${yaml(line(record.title))}
authors: ${yaml(record.authors.map(line))}
year: ${record.publishedYear ?? 'null'}
doi: ${yaml(record.doi)}
review_status: ${yaml(record.reviewStatus)}
search_tags: ${yaml(tags)}
metadata_only: true
full_text_reviewed: false
created_from_record_version: ${record.version}
---
<!-- GOSU-CREATED-PAPER-NOTE v1: user-owned after creation; GOSU never overwrites it. -->

# ${markdownText(record.title)}

> Created from bibliographic metadata only. The paper full text was not read or verified.

## Bibliographic metadata

- Authors: ${markdownText(record.authors.join(', '))}
- Journal / venue: ${markdownText(record.containerTitle)}
- Published: ${record.publishedYear ?? 'Unknown'}
- DOI: ${markdownText(record.doi)}
- Cited by: ${record.citationCount ?? 'Not provided'} _(provider metadata)_
- Search tags: ${markdownText(tags.join(', '))}
- GOSU record: \`${record.id}\`

## Human notes

${record.manualAnnotations.summary ? markdownText(record.manualAnnotations.summary) : ''}

## Relevance to this project

${record.manualAnnotations.relevance ? markdownText(record.manualAnnotations.relevance) : ''}

## Claims to verify


## Methods


## Results


## Limitations


## GOSU metadata-only draft

${record.aiAnnotations?.summary ? markdownText(record.aiAnnotations.summary) : ''}
`;
}

export function researchPaperNoteFileName(record: LiteratureRecord) {
  const preferred = record.citationKey || record.title;
  const normalized = preferred
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._ -]+/gu, '-')
    .replace(/\s+/gu, '-')
    .replace(/^[. -]+|[. -]+$/gu, '')
    .slice(0, 80);
  return `${normalized || 'paper'}--${record.id.slice(0, 12)}.md`;
}
