import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BriefingGuidanceStore } from './briefing-guidance-store';

const dirs: string[] = [];
const key = async () => Buffer.alloc(32, 7);
async function store() {
  const dir = await mkdtemp(join(tmpdir(), 'briefing-guidance-'));
  dirs.push(dir);
  return { dir, store: new BriefingGuidanceStore(dir, key) };
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('briefing guidance store', () => {
  it('adds, edits and deletes one line at a time per routine, sealed on disk', async () => {
    const { dir, store: s } = await store();
    expect(await s.list('personal')).toEqual([]);
    await s.add('personal', '  연구처(research.yonsei.ac.kr) 메일은\n반드시 포함 ');
    let items = await s.add('personal', '학회 광고는 한 줄로 묶기');
    expect(items.map((i) => i.text)).toEqual([
      '연구처(research.yonsei.ac.kr) 메일은 반드시 포함',
      '학회 광고는 한 줄로 묶기',
    ]);
    const [first, second] = items;
    items = await s.edit('personal', first!.id, 'nrf.re.kr 메일은 반드시 포함');
    expect(items[0]).toMatchObject({ id: first!.id, text: 'nrf.re.kr 메일은 반드시 포함' });
    expect(items[0]!.createdAt).toBe(first!.createdAt);
    items = await s.remove('personal', second!.id);
    expect(items.map((i) => i.text)).toEqual(['nrf.re.kr 메일은 반드시 포함']);
    // Other routines keep their own list, and the file never holds the text in the clear.
    expect(await s.list('other')).toEqual([]);
    const raw = await readFile(join(dir, 'guidance.v1.enc.json'), 'utf8');
    expect(raw).not.toContain('nrf.re.kr');
    expect(await new BriefingGuidanceStore(dir, key).list('personal')).toEqual(items);
  });

  it('rejects empty, too long, secret-looking or excess lines and unknown ids with their own codes', async () => {
    const { store: s } = await store();
    await expect(s.add('personal', '   ')).rejects.toThrow('briefing_guidance_text_invalid');
    await expect(s.add('personal', 'x'.repeat(301))).rejects.toThrow(
      'briefing_guidance_text_invalid',
    );
    await expect(s.add('personal', 'api_key = abcdefgh12345')).rejects.toThrow(
      'briefing_guidance_secret',
    );
    await expect(s.edit('personal', crypto.randomUUID(), '내용')).rejects.toThrow(
      'briefing_guidance_not_found',
    );
    await expect(s.remove('personal', crypto.randomUUID())).rejects.toThrow(
      'briefing_guidance_not_found',
    );
    for (let i = 0; i < 20; i++) await s.add('personal', `지침 ${i}`);
    await expect(s.add('personal', '21번째')).rejects.toThrow('briefing_guidance_limit');
    expect(await s.list('personal')).toHaveLength(20);
  });
});
