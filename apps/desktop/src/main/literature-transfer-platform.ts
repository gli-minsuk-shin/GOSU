import { basename, extname } from 'node:path';

import { dialog, type BrowserWindow } from 'electron';

import type { LiteratureTransferFormat } from '../shared/literature-contracts';
import {
  MAX_LITERATURE_TRANSFER_BYTES,
  readBoundedLiteratureFile,
  writeAtomicLiteratureFile,
} from './literature-transfer-files';

const extensionByFormat: Record<LiteratureTransferFormat, string> = {
  json: 'json',
  csv: 'csv',
  bibtex: 'bib',
};

const filtersByFormat: Record<LiteratureTransferFormat, Electron.FileFilter> = {
  json: { name: 'GOSU Literature JSON', extensions: ['json'] },
  csv: { name: 'CSV', extensions: ['csv'] },
  bibtex: { name: 'BibTeX', extensions: ['bib', 'bibtex'] },
};

export type LiteratureImportSelection = Readonly<{
  status: 'cancelled' | 'selected';
  format: LiteratureTransferFormat | null;
  fileName: string | null;
  content?: string | undefined;
}>;

export type LiteratureExportSelection = Readonly<{
  status: 'cancelled' | 'exported';
  fileName: string | null;
}>;

export interface LiteratureTransferPlatform {
  chooseImport(format?: LiteratureTransferFormat): Promise<LiteratureImportSelection>;
  saveExport(format: LiteratureTransferFormat, content: string): Promise<LiteratureExportSelection>;
}

function inferFormat(path: string): LiteratureTransferFormat | null {
  const extension = extname(path).toLowerCase();
  if (extension === '.json') return 'json';
  if (extension === '.csv') return 'csv';
  if (extension === '.bib' || extension === '.bibtex') return 'bibtex';
  return null;
}

export function createLiteratureTransferPlatform(
  window: () => BrowserWindow | undefined,
): LiteratureTransferPlatform {
  return {
    async chooseImport(requestedFormat) {
      const owner = window();
      const options: Electron.OpenDialogOptions = {
        title: 'Import literature review',
        properties: ['openFile'],
        filters: requestedFormat
          ? [filtersByFormat[requestedFormat]]
          : [
              { name: 'Literature review', extensions: ['json', 'csv', 'bib', 'bibtex'] },
              filtersByFormat.json,
              filtersByFormat.csv,
              filtersByFormat.bibtex,
            ],
      };
      const result = owner
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options);
      const path = result.filePaths[0];
      if (result.canceled || !path) return { status: 'cancelled', format: null, fileName: null };
      const format = requestedFormat ?? inferFormat(path);
      if (!format) throw new Error('literature_import_invalid');
      const content = await readBoundedLiteratureFile(path);
      return {
        status: 'selected',
        format,
        fileName: basename(path).slice(0, 255),
        content,
      };
    },

    async saveExport(format, content) {
      if (Buffer.byteLength(content, 'utf8') > MAX_LITERATURE_TRANSFER_BYTES) {
        throw new Error('literature_export_too_large');
      }
      const owner = window();
      const options: Electron.SaveDialogOptions = {
        title: 'Export literature review',
        defaultPath: `gosu-literature.${extensionByFormat[format]}`,
        filters: [filtersByFormat[format]],
      };
      const result = owner
        ? await dialog.showSaveDialog(owner, options)
        : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return { status: 'cancelled', fileName: null };
      await writeAtomicLiteratureFile(result.filePath, content);
      return {
        status: 'exported',
        fileName: basename(result.filePath).slice(0, 255),
      };
    },
  };
}
