import type { BrowserWindow } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createProjectChatAttachmentPicker } from '../src/main/project-chat-attachment-platform';
import { PROJECT_CHAT_ATTACHMENT_ACCEPTED_EXTENSIONS } from '../src/shared/project-chat-attachment-contracts';

const electron = vi.hoisted(() => ({
  showOpenDialog: vi.fn(),
}));

vi.mock('electron', () => ({
  dialog: { showOpenDialog: electron.showOpenDialog },
}));

beforeEach(() => electron.showOpenDialog.mockReset());

describe('Project Chat attachment picker', () => {
  it('offers the bounded generic document, presentation, and image allowlist', async () => {
    const owner = {} as BrowserWindow;
    const selectedPaths = ['/private/research/report.docx', '/private/research/figure.png'];
    electron.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: selectedPaths });

    await expect(createProjectChatAttachmentPicker(() => owner)()).resolves.toEqual(selectedPaths);
    expect(electron.showOpenDialog).toHaveBeenCalledOnce();
    const [actualOwner, options] = electron.showOpenDialog.mock.calls[0]!;
    expect(actualOwner).toBe(owner);
    expect(options).toEqual({
      title: 'Attach research files to this Project Chat turn',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Research files',
          extensions: [...PROJECT_CHAT_ATTACHMENT_ACCEPTED_EXTENSIONS],
        },
        {
          name: 'Documents',
          extensions: ['pdf', 'docx', 'hwpx', 'txt', 'md', 'csv', 'json', 'tex'],
        },
        { name: 'Presentations', extensions: ['pptx'] },
        {
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'tif', 'tiff', 'bmp', 'avif'],
        },
      ],
    });
  });

  it('returns no paths when an ownerless picker is canceled', async () => {
    electron.showOpenDialog.mockResolvedValueOnce({
      canceled: true,
      filePaths: ['/private/research/ignored.pdf'],
    });

    await expect(createProjectChatAttachmentPicker(() => undefined)()).resolves.toEqual([]);
    expect(electron.showOpenDialog).toHaveBeenCalledOnce();
    expect(electron.showOpenDialog.mock.calls[0]).toHaveLength(1);
  });
});
