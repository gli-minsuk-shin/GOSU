import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, lstat, open, readdir, link, unlink, rename } from 'node:fs/promises';
import { preparePaperSummaries, type PreparedPaper } from './paper-summary-ingestion';
import type { ModelRouting } from '@gosu/contracts';
import { homedir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { systemBriefingKey } from './briefing-system-key';
import {
  PaperSummarySaveSchema,
  PaperSummaryRecordSchema,
  safePaperLink,
  type PaperSummaryRecord,
  type PaperSummarySaveReceipt,
} from './src/paper-summary-contract';

const DEFAULT_DIRECTORY = join(homedir(), 'Library', 'Application Support', 'GOSU', 'briefing-lab');
const SUFFIX = '.paper.enc.json';
const MAX_BYTES = 2000000;
/** Explicitly approved cross-app copies only. One immutable encrypted file per exact analysis,
 * with atomic create-only publication so separate GOSU/Briefing processes cannot overwrite it. */
export class SharedPaperSummaryLibrary {
  private key: Promise<Buffer> | undefined;
  constructor(
    private directory = DEFAULT_DIRECTORY,
    private keyProvider = systemBriefingKey,
    private prepare = preparePaperSummaries,
    private routing?: () => Promise<ModelRouting>,
  ) {}
  private async folder() {
    const path = join(this.directory, 'approved-paper-summaries');
    await mkdir(path, { recursive: true, mode: 0o700 });
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('paper_library_path_unsafe');
    return path;
  }
  private getKey() {
    return (this.key ??= this.keyProvider(this.directory).catch((e) => {
      this.key = undefined;
      throw e;
    }));
  }
  private async read(id: string, attempt = 0): Promise<PaperSummaryRecord> {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('paper_library_id_invalid');
    const path = join(await this.folder(), id + SUFFIX);
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      // A second app can observe the brief publication window before the temp link is removed.
      if (stat.nlink === 2 && attempt < 8) {
        await file.close();
        await delay(5);
        return this.read(id, attempt + 1);
      }
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_BYTES)
        throw new Error('paper_library_file_invalid');
      const raw = JSON.parse(await file.readFile('utf8')) as {
        version: number;
        iv: string;
        tag: string;
        data: string;
      };
      if (
        raw.version !== 1 ||
        typeof raw.iv !== 'string' ||
        typeof raw.tag !== 'string' ||
        typeof raw.data !== 'string'
      )
        throw new Error('paper_library_file_invalid');
      const decipher = createDecipheriv(
        'aes-256-gcm',
        await this.getKey(),
        Buffer.from(raw.iv, 'base64'),
      );
      decipher.setAAD(Buffer.from('gosu-approved-paper:' + id));
      decipher.setAuthTag(Buffer.from(raw.tag, 'base64'));
      const value = PaperSummaryRecordSchema.parse(
        JSON.parse(
          Buffer.concat([
            decipher.update(Buffer.from(raw.data, 'base64')),
            decipher.final(),
          ]).toString('utf8'),
        ),
      );
      if (value.id !== id) throw new Error('paper_library_file_invalid');
      return value;
    } finally {
      await file.close();
    }
  }
  async list() {
    const files = (await readdir(await this.folder())).filter((n) =>
      /^[a-f0-9]{64}\.paper\.enc\.json$/.test(n),
    );
    // Tolerate a small concurrent-writer quota overshoot without hiding accepted records.
    if (files.length > 2000) throw new Error('paper_library_limit');
    const records: PaperSummaryRecord[] = [];
    for (let i = 0; i < files.length; i += 16)
      records.push(
        ...(await Promise.all(files.slice(i, i + 16).map((n) => this.read(n.slice(0, 64))))),
      );
    return records.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }
  async save(
    raw: unknown,
    origin: PaperSummaryRecord['origin'],
    signal = AbortSignal.timeout(240000),
    beforeCommit?: () => Promise<void>,
  ): Promise<PaperSummarySaveReceipt> {
    const { candidate } = PaperSummarySaveSchema.parse(raw);
    if (candidate.sourceUrls.some((url) => !safePaperLink(url)))
      throw new Error('paper_library_source_invalid');
    const prepared = await this.prepare(candidate, await this.list(), this.routing, signal);
    if (!prepared.length) throw new Error('paper_library_source_invalid');
    const receipts = [];
    for (const paper of prepared) {
      if (signal.aborted) throw new Error('source_cancelled');
      await beforeCommit?.();
      if (signal.aborted) throw new Error('source_cancelled');
      receipts.push(await this.savePrepared(paper, origin));
    }
    return { ...receipts[0]!, alreadySaved: receipts.every((r) => r.alreadySaved) };
  }
  async remove(ids: string[]) {
    if (!ids.length || ids.length > 100 || ids.some((id) => !/^[a-f0-9]{64}$/.test(id)))
      throw new Error('paper_library_id_invalid');
    const folder = await this.folder();
    for (const id of ids) await this.read(id);
    for (const id of ids)
      await rename(join(folder, id + SUFFIX), join(folder, id + SUFFIX + '.trash'));
    return ids;
  }
  private async savePrepared(
    candidate: PreparedPaper,
    origin: PaperSummaryRecord['origin'],
  ): Promise<PaperSummarySaveReceipt> {
    const id = createHash('sha256')
      .update(
        JSON.stringify(
          candidate.paper
            ? { format: 'verified-paper-v1', sourceUrl: candidate.sourceUrls[0] }
            : {
                title: candidate.title,
                question: candidate.question,
                markdown: candidate.markdown,
                sourceUrls: [...candidate.sourceUrls].sort(),
              },
        ),
      )
      .digest('hex');
    try {
      const existing = await this.read(id);
      return { id, savedAt: existing.savedAt, alreadySaved: true };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    const folder = await this.folder();
    if ((await readdir(folder)).filter((n) => n.endsWith(SUFFIX)).length >= 1000)
      throw new Error('paper_library_limit');
    const record = PaperSummaryRecordSchema.parse({
      ...candidate,
      id,
      savedAt: new Date().toISOString(),
      origin,
    });
    const published = await this.publish(folder, record, 'create-only');
    const saved = await this.read(id);
    return { id, savedAt: saved.savedAt, alreadySaved: !published };
  }

  /**
   * Seal one record and put it in place. `create-only` links, so two processes cannot overwrite a
   * different analysis that already carries this id, and answers false when one is there.
   * `replace` renames over this record's own file, which is how a record gains a note about itself.
   */
  private async publish(
    folder: string,
    record: PaperSummaryRecord,
    mode: 'create-only' | 'replace',
  ) {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', await this.getKey(), iv);
    cipher.setAAD(Buffer.from('gosu-approved-paper:' + record.id));
    const data = Buffer.concat([cipher.update(JSON.stringify(record), 'utf8'), cipher.final()]);
    const sealed = JSON.stringify({
      version: 1,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64'),
    });
    if (Buffer.byteLength(sealed) > MAX_BYTES) throw new Error('paper_library_size_limit');
    const temp = join(folder, randomUUID() + '.pending'),
      target = join(folder, record.id + SUFFIX);
    const file = await open(temp, 'wx', 0o600);
    try {
      await file.writeFile(sealed);
      await file.sync();
    } finally {
      await file.close();
    }
    if (mode === 'replace') {
      // rename replaces atomically: a crash leaves either the old record or the new one, never a
      // half-written file, and the paper itself is never lost to a note about it.
      await rename(temp, target);
      return true;
    }
    let published = false;
    try {
      try {
        await link(temp, target);
        published = true;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      }
    } finally {
      await unlink(temp);
    }
    return published;
  }
}
