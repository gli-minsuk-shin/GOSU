import { dialog, type BrowserWindow } from 'electron';

import { VaultReader } from './vault-reader';

export class VaultAccess {
  private reader?: VaultReader;

  async choose(window: BrowserWindow) {
    const result = await dialog.showOpenDialog(window, {
      title: 'Choose an Obsidian folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    this.reader = await VaultReader.open(result.filePaths[0]);
    return { root: this.reader.root, files: await this.reader.listMarkdown() };
  }

  async listMarkdown() {
    return this.reader?.listMarkdown() ?? [];
  }

  async readMarkdown(relativePath: string) {
    if (!this.reader) throw new Error('vault_not_selected');
    return this.reader.readMarkdown(relativePath);
  }
}
