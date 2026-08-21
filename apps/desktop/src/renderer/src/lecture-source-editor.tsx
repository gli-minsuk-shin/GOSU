import {
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import './lecture-source-editor.css';

export type LectureSourceDocumentKind = 'lecture-notes' | 'slides';

export type LectureSourceDrafts = Readonly<Record<LectureSourceDocumentKind, string>>;

export type LectureSourceEditorPhase =
  'idle' | 'validating' | 'compiling-notes' | 'compiling-slides' | 'saving';

export type LectureSourceEditorIssue = Readonly<{
  message: string;
  document?: LectureSourceDocumentKind;
  line?: number;
  column?: number;
}>;

export type LectureSourceSelection = Readonly<{
  start: number;
  end: number;
}>;

export type LectureSourceFocusRequest = Readonly<{
  key: number;
  document: LectureSourceDocumentKind;
  selection: LectureSourceSelection;
}>;

export type LectureSourceEditorProps = Readonly<{
  revision: number;
  baseSources: LectureSourceDrafts;
  drafts: LectureSourceDrafts;
  activeDocument: LectureSourceDocumentKind;
  onActiveDocumentChange: (document: LectureSourceDocumentKind) => void;
  onDraftChange: (document: LectureSourceDocumentKind, source: string) => void;
  onSelectionChange?: (
    document: LectureSourceDocumentKind,
    selection: LectureSourceSelection,
  ) => void;
  onSave: () => void | Promise<void>;
  onCancel: () => void;
  phase?: LectureSourceEditorPhase;
  disabled?: boolean;
  statusMessage?: string | null;
  issue?: LectureSourceEditorIssue | null;
  idPrefix?: string;
  maxLength?: number;
  focusRequest?: LectureSourceFocusRequest | null;
}>;

const SOURCE_DOCUMENTS = ['lecture-notes', 'slides'] as const;

const SOURCE_DOCUMENT_LABELS: Record<LectureSourceDocumentKind, string> = {
  'lecture-notes': 'Lecture notes',
  slides: 'Slides',
};

const SOURCE_EDITOR_PHASE_LABELS: Record<Exclude<LectureSourceEditorPhase, 'idle'>, string> = {
  validating: 'Validating LaTeX…',
  'compiling-notes': 'Compiling the lecture-notes PDF…',
  'compiling-slides': 'Compiling the slides PDF…',
  saving: 'Saving the new revision…',
};

const DEFAULT_MAX_SOURCE_LENGTH = 200_000;

export function lectureSourceDocumentLabel(document: LectureSourceDocumentKind) {
  return SOURCE_DOCUMENT_LABELS[document];
}

export function lectureSourceDirtyDocuments(
  baseSources: LectureSourceDrafts,
  drafts: LectureSourceDrafts,
) {
  return SOURCE_DOCUMENTS.filter((document) => baseSources[document] !== drafts[document]);
}

export function isLectureSourceSaveShortcut(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
) {
  return (
    event.key.toLocaleLowerCase() === 's' &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey
  );
}

export function isLectureSourceFileDrag(types: ArrayLike<string>) {
  return Array.from(types).includes('Files');
}

export function lectureSourceOffsetForPosition(source: string, line: number, column = 1) {
  const safeLine = Math.max(1, Math.trunc(line));
  const safeColumn = Math.max(1, Math.trunc(column));
  const lines = source.split('\n');
  const lineIndex = Math.min(safeLine - 1, Math.max(0, lines.length - 1));
  let offset = 0;
  for (let index = 0; index < lineIndex; index += 1) offset += lines[index]!.length + 1;
  return offset + Math.min(safeColumn - 1, lines[lineIndex]?.length ?? 0);
}

export function insertLectureSourceAtSelection(
  source: string,
  insertion: string,
  selection: LectureSourceSelection,
) {
  const start = Math.max(0, Math.min(Math.trunc(selection.start), source.length));
  const end = Math.max(start, Math.min(Math.trunc(selection.end), source.length));
  const nextSource = `${source.slice(0, start)}${insertion}${source.slice(end)}`;
  const cursor = start + insertion.length;
  return { source: nextSource, selection: { start: cursor, end: cursor } } as const;
}

function dirtyStatus(dirtyDocuments: readonly LectureSourceDocumentKind[]) {
  if (dirtyDocuments.length === 0) return 'No unsaved changes.';
  return `Unsaved changes in ${dirtyDocuments
    .map((document) => lectureSourceDocumentLabel(document))
    .join(' and ')}.`;
}

function sourceLineCount(source: string) {
  return source === '' ? 1 : source.split('\n').length;
}

export function LectureSourceEditor({
  revision,
  baseSources,
  drafts,
  activeDocument,
  onActiveDocumentChange,
  onDraftChange,
  onSelectionChange,
  onSave,
  onCancel,
  phase = 'idle',
  disabled = false,
  statusMessage = null,
  issue = null,
  idPrefix,
  maxLength = DEFAULT_MAX_SOURCE_LENGTH,
  focusRequest = null,
}: LectureSourceEditorProps) {
  const generatedId = useId();
  const prefix = idPrefix ?? `lecture-source-${generatedId.replaceAll(':', '')}`;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const issueRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Partial<Record<LectureSourceDocumentKind, HTMLButtonElement | null>>>({});
  const previousIssue = useRef<LectureSourceEditorIssue | null>(null);
  const [blockedFileDropNotice, setBlockedFileDropNotice] = useState<string | null>(null);
  const dirtyDocuments = lectureSourceDirtyDocuments(baseSources, drafts);
  const dirty = dirtyDocuments.length > 0;
  const busy = phase !== 'idle';
  const activeLabel = lectureSourceDocumentLabel(activeDocument);
  const statusId = `${prefix}-status`;
  const issueId = `${prefix}-issue`;
  const panelId = `${prefix}-panel`;
  const activeTabId = `${prefix}-tab-${activeDocument}`;
  const source = drafts[activeDocument];
  const canSave = dirty && !busy && !disabled;
  const status =
    phase === 'idle'
      ? (blockedFileDropNotice ?? statusMessage ?? dirtyStatus(dirtyDocuments))
      : SOURCE_EDITOR_PHASE_LABELS[phase];

  useEffect(() => {
    if (issue && issue !== previousIssue.current) issueRef.current?.focus();
    previousIssue.current = issue;
  }, [issue]);

  useEffect(() => {
    if (!focusRequest || focusRequest.document !== activeDocument) return;
    const frame = requestAnimationFrame(() => {
      const target = textareaRef.current;
      if (!target) return;
      const start = Math.max(0, Math.min(focusRequest.selection.start, target.value.length));
      const end = Math.max(start, Math.min(focusRequest.selection.end, target.value.length));
      target.focus();
      target.setSelectionRange(start, end);
    });
    return () => cancelAnimationFrame(frame);
  }, [activeDocument, focusRequest]);

  const selectDocument = (document: LectureSourceDocumentKind, focus = false) => {
    setBlockedFileDropNotice(null);
    onActiveDocumentChange(document);
    if (focus) requestAnimationFrame(() => tabRefs.current[document]?.focus());
  };

  const onTabKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    document: LectureSourceDocumentKind,
  ) => {
    const currentIndex = SOURCE_DOCUMENTS.indexOf(document);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % SOURCE_DOCUMENTS.length;
    if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + SOURCE_DOCUMENTS.length) % SOURCE_DOCUMENTS.length;
    }
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = SOURCE_DOCUMENTS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    selectDocument(SOURCE_DOCUMENTS[nextIndex]!, true);
  };

  const saveShortcut = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!isLectureSourceSaveShortcut(event)) return;
    event.preventDefault();
    if (canSave) void onSave();
  };

  const blockFileDrag = (event: ReactDragEvent<HTMLElement>) => {
    if (!isLectureSourceFileDrag(event.dataTransfer.types)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'none';
  };

  const blockFileDrop = (event: ReactDragEvent<HTMLElement>) => {
    if (!isLectureSourceFileDrag(event.dataTransfer.types)) return;
    event.preventDefault();
    setBlockedFileDropNotice('Drop image files into the Figure library, not the LaTeX editor.');
  };

  const goToIssue = () => {
    if (!issue?.line) return;
    const targetDocument = issue.document ?? activeDocument;
    if (targetDocument !== activeDocument) onActiveDocumentChange(targetDocument);
    requestAnimationFrame(() => {
      const target = textareaRef.current;
      if (!target) return;
      const offset = lectureSourceOffsetForPosition(
        drafts[targetDocument],
        issue.line!,
        issue.column,
      );
      target.focus();
      target.setSelectionRange(offset, offset);
    });
  };

  return (
    <section
      className="lecture-source-editor"
      aria-labelledby={`${prefix}-heading`}
      onKeyDownCapture={saveShortcut}
      onDragOver={blockFileDrag}
      onDrop={blockFileDrop}
    >
      <header className="lecture-source-editor-header">
        <div>
          <span className="eyebrow">Direct LaTeX edit</span>
          <h3 id={`${prefix}-heading`}>Edit revision {revision}</h3>
          <p>Saving creates revision {revision + 1}. Earlier revisions stay unchanged.</p>
        </div>
        <div className="lecture-source-editor-actions">
          <span className="lecture-source-editor-pdf-note">
            PDFs are validated and compiled on save.
          </span>
          <button type="button" className="ghost-button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!canSave}
            onClick={() => void onSave()}
          >
            {busy ? 'Saving…' : `Save as revision ${revision + 1}`}
          </button>
        </div>
      </header>

      <div className="lecture-source-editor-tabs" role="tablist" aria-label="LaTeX documents">
        {SOURCE_DOCUMENTS.map((document) => {
          const label = lectureSourceDocumentLabel(document);
          const documentDirty = dirtyDocuments.includes(document);
          const selected = document === activeDocument;
          return (
            <button
              type="button"
              role="tab"
              id={`${prefix}-tab-${document}`}
              aria-controls={panelId}
              aria-selected={selected}
              aria-label={`${label}${documentDirty ? ', unsaved changes' : ''}`}
              tabIndex={selected ? 0 : -1}
              className={selected ? 'active' : ''}
              key={document}
              ref={(element) => {
                tabRefs.current[document] = element;
              }}
              onClick={() => selectDocument(document)}
              onKeyDown={(event) => onTabKeyDown(event, document)}
            >
              <span>{label}</span>
              {documentDirty && <i aria-hidden="true" />}
            </button>
          );
        })}
      </div>

      {issue && (
        <div
          className="lecture-source-editor-issue"
          id={issueId}
          role="alert"
          tabIndex={-1}
          ref={issueRef}
        >
          <div>
            <strong>Review this LaTeX</strong>
            <span>{issue.message}</span>
            {issue.line && (
              <small>
                {issue.document ? `${lectureSourceDocumentLabel(issue.document)} · ` : ''}line{' '}
                {issue.line}
                {issue.column ? `, column ${issue.column}` : ''}
              </small>
            )}
          </div>
          {issue.line && (
            <button type="button" className="ghost-button" onClick={goToIssue}>
              Go to line
            </button>
          )}
        </div>
      )}

      <div
        className="lecture-source-editor-panel"
        id={panelId}
        role="tabpanel"
        aria-labelledby={activeTabId}
      >
        <label className="sr-only" htmlFor={`${prefix}-textarea`}>
          {activeLabel} LaTeX for revision {revision}
        </label>
        <textarea
          id={`${prefix}-textarea`}
          ref={textareaRef}
          value={source}
          onChange={(event) => {
            setBlockedFileDropNotice(null);
            onDraftChange(activeDocument, event.target.value);
          }}
          onSelect={(event) =>
            onSelectionChange?.(activeDocument, {
              start: event.currentTarget.selectionStart,
              end: event.currentTarget.selectionEnd,
            })
          }
          disabled={disabled || busy}
          maxLength={maxLength}
          spellCheck={false}
          wrap="off"
          aria-invalid={issue !== null}
          aria-describedby={`${statusId}${issue ? ` ${issueId}` : ''}`}
        />
      </div>

      <footer className="lecture-source-editor-footer">
        <span>
          {sourceLineCount(source).toLocaleString()} lines · {source.length.toLocaleString()} /{' '}
          {maxLength.toLocaleString()} characters
        </span>
        <span id={statusId} role="status" aria-live="polite" aria-atomic="true">
          {status}
        </span>
        <span>⌘S or Ctrl+S saves a new revision. Tab moves focus.</span>
      </footer>
    </section>
  );
}
