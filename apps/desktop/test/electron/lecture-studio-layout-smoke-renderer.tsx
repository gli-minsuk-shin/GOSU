import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import '../../src/renderer/src/styles.css';
import '../../src/renderer/src/lecture-studio-view.css';
import '../../src/renderer/src/lecture-external-source-picker.css';
import '../../src/renderer/src/pdf-preview.css';
import './lecture-studio-layout-smoke.css';
import type {
  LectureStudio,
  LectureStudioDetail,
  LectureStudioMessage,
  LectureStudioRevision,
} from '../../src/shared/lecture-studio-contracts';
import type { ProjectRecord } from '../../src/shared/workspace-contracts';
import {
  LectureStudioView,
  type LectureStudioViewAdapter,
} from '../../src/renderer/src/lecture-studio-view';
import type { LectureStudioLayoutState } from '../../src/renderer/src/lecture-studio-layout-state';
import { VolatileLectureStudioDrafts } from '../../src/renderer/src/lecture-studio-session-state';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const STUDIO_ID = '22222222-2222-4222-8222-222222222222';
const REVISION_ID = '33333333-3333-4333-8333-333333333333';
const ATTEMPT_ID = '44444444-4444-4444-8444-444444444444';
const NOW = '2026-08-13T00:00:00.000Z';
const CONTENT_SHA = 'a'.repeat(64);

function buildPdfFixture() {
  const streams = [
    '1 1 1 rg\n0 0 220 520 re f\n0 0 0 rg\n20 20 80 80 re f\n0 0 1 rg\n110 330 70 70 re f\n',
    '1 1 1 rg\n0 0 220 520 re f\n0 0.75 0 rg\n20 220 100 100 re f\n1 0.55 0 rg\n130 80 60 60 re f\n',
    '1 1 1 rg\n0 0 220 520 re f\n1 0 0 rg\n30 300 120 120 re f\n0.75 0 0.75 rg\n130 80 60 60 re f\n',
  ];
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 220 520] /Resources << >> /Contents 4 0 R >>',
    `<< /Length ${new TextEncoder().encode(streams[0]).byteLength} >>\nstream\n${streams[0]}endstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 220 520] /Resources << >> /Contents 6 0 R >>',
    `<< /Length ${new TextEncoder().encode(streams[1]).byteLength} >>\nstream\n${streams[1]}endstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 220 520] /Resources << >> /Contents 8 0 R >>',
    `<< /Length ${new TextEncoder().encode(streams[2]).byteLength} >>\nstream\n${streams[2]}endstream`,
  ];
  let source = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, body] of objects.entries()) {
    offsets.push(new TextEncoder().encode(source).byteLength);
    source += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xrefOffset = new TextEncoder().encode(source).byteLength;
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(source);
}

function encodeBase64(bytes: Uint8Array) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192));
  }
  return window.btoa(binary);
}

const project: ProjectRecord = {
  id: PROJECT_ID,
  name: 'Lecture layout fixture project',
  slug: 'lecture-layout-fixture-project',
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
};

const studio = {
  schemaVersion: 1,
  id: STUDIO_ID,
  title: 'Interactive research lecture',
  kind: 'lecture',
  durationMinutes: null,
  outputProjectId: PROJECT_ID,
  sourceProjectIds: [PROJECT_ID],
  sourceSelection: {
    literature: [{ projectId: PROJECT_ID, recordId: '55555555-5555-4555-8555-555555555555' }],
    experiments: [],
    manuscripts: [],
  },
  generationBrief: {
    notesTargetPages: 12,
    slidesTargetPages: 24,
    detailLevel: 'detailed',
    customInstructions: '',
  },
  status: 'ready',
  activeAttemptId: null,
  currentRevision: 1,
  version: 2,
  lastErrorCode: null,
  createdAt: NOW,
  updatedAt: NOW,
} satisfies LectureStudio;

const revision = {
  schemaVersion: 1,
  id: REVISION_ID,
  studioId: STUDIO_ID,
  revision: 1,
  attemptId: ATTEMPT_ID,
  sourceManifest: {
    schemaVersion: 1,
    selectedProjectIds: [PROJECT_ID],
    literature: [],
    experiments: [],
  },
  sourceManifestSha256: CONTENT_SHA,
  lectureNotesMarkdown:
    '# Interactive research lecture\n\nThe preview remains mounted while the surrounding rails resize.\n\n## Evidence\n\n- Frozen sources\n- Revision provenance\n- Interactive refinement',
  slidesMarkdown:
    '# Interactive research lecture\n\n---\n\n## Layout\n\nThe center document remains stable.',
  artifacts: [
    {
      kind: 'lecture-notes',
      relativePath: 'Lecture Notes & Slides/layout-fixture/lecture-notes.md',
      contentSha256: CONTENT_SHA,
      savedAt: NOW,
    },
    {
      kind: 'slides',
      relativePath: 'Lecture Notes & Slides/layout-fixture/slides.md',
      contentSha256: CONTENT_SHA,
      savedAt: NOW,
    },
  ],
  invocation: {
    schemaVersion: 1,
    invocationId: '66666666-6666-4666-8666-666666666666',
    providerId: 'codex',
    requestedModelId: null,
    resolvedModelId: 'fixture-model',
    catalogVersion: 'fixture-v1',
    reasoningOptionId: 'medium',
    startedAt: NOW,
  },
  createdAt: NOW,
} as unknown as LectureStudioRevision;

const messages = Array.from({ length: 14 }, (_, index) => ({
  schemaVersion: 1,
  id: `77777777-7777-4777-8${String(index).padStart(3, '0')}-777777777777`,
  studioId: STUDIO_ID,
  role: index % 2 === 0 ? 'user' : 'assistant',
  status: 'complete',
  content: `Layout fixture message ${index + 1}. Keep the preview visible while editing.`,
  attemptId: null,
  revision: null,
  invocation: null,
  createdAt: NOW,
  completedAt: NOW,
})) as LectureStudioMessage[];

const detail: LectureStudioDetail = {
  schemaVersion: 1,
  studio,
  revisions: [revision],
  messages,
};

const pdf = buildPdfFixture();
const adapter: LectureStudioViewAdapter = {
  list: async () => ({ schemaVersion: 1, studios: [studio] }),
  detail: async () => detail,
  candidates: async () => ({ schemaVersion: 1, projects: [] }),
  stageExternalSources: async () => {
    throw new Error('not used in ready Studio fixture');
  },
  removeStagedExternalSource: async () => {
    throw new Error('not used in ready Studio fixture');
  },
  discardExternalSourceSet: async () => ({ discarded: true }),
  importOverleaf: async () => {
    throw new Error('not used in ready Studio fixture');
  },
  create: async () => studio,
  generate: async () => ({ studio, revision, assistantMessage: messages[1] }),
  send: async () => ({ studio, revision, assistantMessage: messages[1] }),
  cancel: async () => studio,
  compilePdf: async () => ({
    schemaVersion: 1,
    artifactId: '88888888-8888-4888-8888-888888888888',
    title: 'Lecture notes',
    fileName: 'lecture-notes.pdf',
    compilerDisplayName: 'Fixture compiler',
    sourceDescription: 'Lecture Studio layout fixture',
    pdfSha256: `sha256:${'b'.repeat(64)}`,
    sizeBytes: pdf.byteLength,
    compiledAt: NOW,
    pdfBase64: encodeBase64(pdf),
  }),
  exportArtifact: async () => ({ schemaVersion: 1, status: 'cancelled' }),
  openArtifact: async () => ({ schemaVersion: 1, status: 'cancelled' }),
  revealArtifact: async () => ({ schemaVersion: 1, status: 'cancelled' }),
  onEvent: () => () => undefined,
};

function Fixture() {
  const [layout, setLayout] = useState<LectureStudioLayoutState>({
    schemaVersion: 1,
    studioRailCollapsed: false,
    chatCollapsed: false,
  });
  return (
    <main className="lecture-studio-layout-smoke-shell">
      <section className="desktop-content desktop-content-lecture">
        <LectureStudioView
          projects={[project]}
          adapter={adapter}
          draftStore={new VolatileLectureStudioDrafts()}
          models={[
            {
              modelId: 'fixture-model',
              displayName: 'Fixture model',
              isDefault: true,
              reasoningOptions: [{ id: 'medium', label: 'medium', isDefault: true }],
            },
          ]}
          modelsLoading={false}
          onRefreshModels={() => undefined}
          layout={layout}
          onLayoutChange={setLayout}
        />
      </section>
    </main>
  );
}

const root = document.querySelector('#root');
if (!root) throw new Error('missing_lecture_studio_layout_smoke_root');
createRoot(root).render(<Fixture />);
