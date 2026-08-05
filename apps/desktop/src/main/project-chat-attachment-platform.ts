import { dialog, type BrowserWindow } from 'electron';

import { PROJECT_CHAT_ATTACHMENT_ACCEPTED_EXTENSIONS } from '../shared/project-chat-attachment-contracts';

export function createProjectChatAttachmentPicker(window: () => BrowserWindow | undefined) {
  return async () => {
    const owner = window();
    const options: Electron.OpenDialogOptions = {
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
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? [] : result.filePaths;
  };
}
