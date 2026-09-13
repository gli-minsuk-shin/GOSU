import { uiText, useUiText } from '@gosu/ui/language';
import { useEffect, useRef, useState } from 'react';
import { projectModelCopies } from './project-model-transfer';
import type { ModelLabStorage } from './model-lab-environment';

export function ProjectModelCopyDialog({
  modelId,
  modelName,
  revision,
  storage,
  onClose,
  onCopied,
}: {
  modelId: string;
  modelName: string;
  revision: number;
  storage: ModelLabStorage | null;
  onClose: () => void;
  onCopied: (message: string) => void;
}) {
  useUiText();
  const dialog = useRef<HTMLDialogElement>(null);
  const [projects, setProjects] = useState<readonly { id: string; name: string }[] | null>(null);
  const [target, setTarget] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    dialog.current?.showModal();
    let active = true;
    void projectModelCopies
      .targets()
      .then((value) => {
        if (active) {
          setProjects(value);
          setTarget(value[0]?.id ?? '');
        }
      })
      .catch(() => {
        if (active) setError(uiText('Could not list destination projects.'));
      });
    return () => {
      active = false;
    };
  }, []);
  const copy = async () => {
    if (!target || busy) return;
    setBusy(true);
    setError('');
    try {
      await storage?.flush?.();
      const receipt = await projectModelCopies.create({
        targetProjectId: target,
        sourceModelId: modelId,
        sourceRevision: revision,
        requestId,
      });
      onCopied(
        `Copied ${modelName} r${revision} to ${projects?.find((project) => project.id === target)?.name}. ${receipt.modelIds.length} independent model${receipt.modelIds.length === 1 ? '' : 's'}; original unchanged.`,
      );
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : uiText('Model copy failed'));
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="project-model-copy-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2>{uiText('Duplicate to project')}</h2>
      <p>
        <strong>{modelName}</strong>
        {uiText(' · selected revision r')}
        {revision}
      </p>
      <label>
        {uiText('Destination project')}
        <select
          aria-label={uiText('Destination project')}
          value={target}
          disabled={busy || !projects?.length}
          onChange={(event) => setTarget(event.target.value)}
        >
          {!projects && <option value="">{uiText('Loading projects…')}</option>}
          {projects?.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      <p>
        {uiText(
          'Copy this saved revision, its nested models and available generated Python files as independent r0 models. The original stays here. Unapplied drafts, conversation and memory are not copied.',
        )}
      </p>
      {projects?.length === 0 && <p>{uiText('No other active project is available.')}</p>}
      {error && <p role="alert">{error}</p>}
      <footer>
        <button type="button" disabled={busy} onClick={onClose}>
          {uiText('Cancel')}
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={busy || !target}
          onClick={() => {
            void copy();
          }}
        >
          {busy ? uiText('Copying…') : uiText('Duplicate model')}
        </button>
      </footer>
    </dialog>
  );
}
