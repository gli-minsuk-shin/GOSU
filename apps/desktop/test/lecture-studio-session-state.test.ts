import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { VolatileLectureStudioDrafts } from '../src/renderer/src/lecture-studio-session-state';

describe('VolatileLectureStudioDrafts', () => {
  it('preserves independent unsent drafts while the renderer session remains open', () => {
    const drafts = new VolatileLectureStudioDrafts();

    drafts.write('studio-a', 'Keep this unsent revision request.');
    drafts.write('studio-b', '  Preserve intentional whitespace too.  ');

    expect(drafts.read('studio-a')).toBe('Keep this unsent revision request.');
    expect(drafts.read('studio-b')).toBe('  Preserve intentional whitespace too.  ');
    expect(drafts.read('studio-c')).toBe('');
  });

  it('removes a draft after a successful send clears the composer', () => {
    const drafts = new VolatileLectureStudioDrafts();
    drafts.write('studio-a', 'A pending request');

    drafts.write('studio-a', '');

    expect(drafts.read('studio-a')).toBe('');
  });

  it('is owned by DesktopApp so a Lecture view remount reuses the same volatile store', () => {
    const desktopApp = readFileSync(
      new URL('../src/renderer/src/desktop-app.tsx', import.meta.url),
      'utf8',
    );
    const lectureView = readFileSync(
      new URL('../src/renderer/src/lecture-studio-view.tsx', import.meta.url),
      'utf8',
    );

    expect(desktopApp).toContain('useRef(new VolatileLectureStudioDrafts())');
    expect(desktopApp).toContain('draftStore={lectureStudioDraftsRef.current}');
    expect(lectureView).toContain('draftStore.read(selectedStudio.id)');
    expect(lectureView).toContain('draftStore.write(selectedStudio.id, draft)');
  });
});
