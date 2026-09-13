import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  ApplicationLanguageService,
  applicationLanguageContext,
  applicationLanguageSnapshot,
  withApplicationLanguageInstructions,
  bindApplicationLanguageCallback,
} from '../src/main/application-language-service';

describe('application language persistence', () => {
  it('returns the committed preference if a renderer notification fails, but rejects disk failures', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gosu-language-notify-'));
    try {
      const path = join(directory, 'language.json');
      const service = new ApplicationLanguageService(path, () => {
        throw new Error('renderer_closed');
      });
      expect(service.set('ko')).toEqual({ language: 'ko', configured: true });
      expect(service.get()).toEqual({ language: 'ko', configured: true });
      const blocked = new ApplicationLanguageService(directory);
      expect(() => blocked.set('en')).toThrow();
      expect(service.get()).toEqual({ language: 'ko', configured: true });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('shares one validated atomic preference between independent readers without modifying history', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gosu-language-'));
    try {
      const path = join(directory, 'application-language.json');
      const app = new ApplicationLanguageService(path);
      const modelLab = new ApplicationLanguageService(path);
      expect(app.get()).toEqual({ language: 'en', configured: false });
      expect(app.set('ko')).toEqual({ language: 'ko', configured: true });
      expect(modelLab.get()).toEqual(app.get());
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect(() => modelLab.set('ja')).toThrow();
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
        language: 'ko',
        configured: true,
      });
      modelLab.set('en');
      expect(app.get()).toEqual({ language: 'en', configured: true });
      await writeFile(path, 'invalid');
      expect(() => app.get()).toThrow('application_language_preference_invalid');
      expect(app.set('ko')).toEqual({ language: 'ko', configured: true });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('snapshots language per asynchronous run and isolates simultaneous runs', async () => {
    const delayedTool = applicationLanguageContext.run({ language: 'ko', configured: true }, () =>
      bindApplicationLanguageCallback(() => applicationLanguageSnapshot()),
    );
    expect(
      applicationLanguageContext.run({ language: 'en', configured: true }, delayedTool),
    ).toEqual({ language: 'ko', configured: true });
    const run = (language: 'ko' | 'en') =>
      applicationLanguageContext.run({ language, configured: true }, async () => {
        await Promise.resolve();
        return {
          preference: applicationLanguageSnapshot(),
          instructions: withApplicationLanguageInstructions('Authorized project only.'),
        };
      });
    const [ko, en] = await Promise.all([run('ko'), run('en')]);
    expect(ko.preference.language).toBe('ko');
    expect(ko.instructions).toContain('Korean (한국어)');
    expect(en.instructions).toContain('in English');
    expect(withApplicationLanguageInstructions('legacy')).toBe('legacy');
  });
});
