import { dialog, type BrowserWindow } from 'electron';

export function createProjectChatAttachmentPicker(window: () => BrowserWindow | undefined) {
  return async () => {
    const owner = window();
    const options: Electron.OpenDialogOptions = {
      title: 'Attach PDFs to this Project Chat turn',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? [] : result.filePaths;
  };
}
