import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SshAgentNoteEditor } from '../src/renderer/src/ssh-agent-note-editor';
import type { SshAgentNotes } from '../src/shared/ssh-agent-notes-contracts';

const SERVER = '11111111-1111-4111-8111-111111111111';
const notes = (text?: string): SshAgentNotes => ({
  version: 1,
  notes: text ? { [SERVER]: { text, updatedAt: '2026-09-22T00:00:00.000Z' } } : {},
});

function text(node: ReactTestInstance | string): string {
  return typeof node === 'string' ? node : node.children.map(text).join('');
}

describe('SSH agent note editor', () => {
  beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
  afterEach(() => vi.unstubAllGlobals());

  it('shows the saved instructions of this server and saves an edit', async () => {
    const api = {
      get: vi.fn(async () => notes('run as minsuk')),
      set: vi.fn(async () => notes('run every job under the name minsuk')),
    };
    let ui!: ReturnType<typeof create>;
    await act(async () => {
      ui = create(
        <SshAgentNoteEditor connectionId={SERVER} serverLabel="Training GPU" api={api} />,
      );
    });
    const area = () => ui.root.findByType('textarea');
    const save = () => ui.root.findAllByType('button').find((button) => text(button) !== '')!;

    expect(area().props.value).toBe('run as minsuk');
    expect(text(ui.root.findByProps({ className: 'ssh-agent-note-title' }))).toContain(
      'Instructions for AI · set',
    );
    // The field is never behind a closed panel: a collapsed <details> hid it from the user.
    expect(ui.root.findAllByType('details')).toHaveLength(0);
    expect(save().props.disabled).toBe(true);

    await act(async () => {
      (area().props as { onChange: (event: unknown) => void }).onChange({
        target: { value: 'run every job under the name minsuk' },
      });
    });
    expect(save().props.disabled).toBe(false);
    await act(async () => {
      (save().props as { onClick: () => void }).onClick();
    });

    expect(api.set).toHaveBeenCalledExactlyOnceWith({
      connectionId: SERVER,
      text: 'run every job under the name minsuk',
    });
    expect(text(ui.root.findByProps({ role: 'status' }))).toContain('Saved');
    expect(save().props.disabled).toBe(true);
  });

  it('keeps the typed text and says why when saving fails', async () => {
    const api = {
      get: vi.fn(async () => notes()),
      set: vi.fn(async () => {
        throw new Error('ssh_agent_notes_unreadable');
      }),
    };
    let ui!: ReturnType<typeof create>;
    await act(async () => {
      ui = create(
        <SshAgentNoteEditor connectionId={SERVER} serverLabel="Training GPU" api={api} />,
      );
    });
    expect(text(ui.root.findByProps({ className: 'ssh-agent-note-title' }))).not.toContain('· set');
    await act(async () => {
      (ui.root.findByType('textarea').props as { onChange: (event: unknown) => void }).onChange({
        target: { value: 'use GPU 2 only' },
      });
    });
    await act(async () => {
      (
        ui.root.findAllByType('button').find((button) => text(button) !== '')!.props as {
          onClick: () => void;
        }
      ).onClick();
    });

    expect(text(ui.root.findByProps({ role: 'alert' }))).toContain('notes file is damaged');
    expect(ui.root.findByType('textarea').props.value).toBe('use GPU 2 only');
  });

  it('says that the instructions could not be loaded instead of showing an empty box as if none existed', async () => {
    const api = {
      get: vi.fn(async () => {
        throw new Error('ssh_agent_notes_unavailable');
      }),
      set: vi.fn(),
    };
    let ui!: ReturnType<typeof create>;
    await act(async () => {
      ui = create(
        <SshAgentNoteEditor connectionId={SERVER} serverLabel="Training GPU" api={api} />,
      );
    });

    expect(text(ui.root.findByProps({ role: 'alert' }))).toContain('could not be loaded');
    expect(ui.root.findByType('textarea').props.disabled).toBe(true);
  });
});
