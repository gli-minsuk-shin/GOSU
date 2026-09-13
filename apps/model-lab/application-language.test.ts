import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  ApplicationLanguageService,
  applicationLanguageContext,
} from '../desktop/src/main/application-language-service';
import {
  createModelCopilotMiddleware,
  modelBuilderCodexExecutionPlan,
  modelLabLanguageArguments,
  modelBuilderUserFacingError,
} from './model-copilot-server';
import { modelLabMessage } from './model-lab-language-messages';

describe('shared Model Lab application language', () => {
  it('reads and updates canonical preference but rejects invalid or cross-origin writes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gosu-language-http-'));
    const service = new ApplicationLanguageService(join(directory, 'language.json'));
    const middleware = createModelCopilotMiddleware(undefined, undefined, undefined, service);
    const server = createServer((request, response) => {
      void middleware(request, response, () => {
        response.writeHead(404);
        response.end();
      });
    });
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('missing address');
      const origin = `http://127.0.0.1:${address.port}`;
      const url = `${origin}/api/application-language`;
      expect(await (await fetch(url)).json()).toEqual({ language: 'en', configured: false });
      const put = (body: unknown, from = origin) =>
        fetch(url, {
          method: 'PUT',
          headers: { Origin: from, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      expect((await put({ language: 'ko' }, 'https://evil.example')).status).toBe(403);
      expect((await put({ language: 'fr' })).status).toBe(400);
      expect((await put({ language: 'ko', configured: false })).status).toBe(400);
      expect(await (await put({ language: 'ko' })).json()).toEqual({
        language: 'ko',
        configured: true,
      });
      expect(service.get()).toEqual({ language: 'ko', configured: true });
      expect(await (await fetch(url)).json()).toEqual({ language: 'ko', configured: true });
      await writeFile(join(directory, 'language.json'), 'broken');
      expect((await fetch(url)).status).toBe(503);
      expect((await fetch(`${origin}/unrelated-static-file`)).status).toBe(404);
      expect(await (await put({ language: 'en' })).json()).toEqual({
        language: 'en',
        configured: true,
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('uses provider instruction boundaries for prose without rewriting source or code', () => {
    const prompt = 'H3 = concat(H1_new, H2)';
    applicationLanguageContext.run({ language: 'ko', configured: true }, () => {
      const args = modelLabLanguageArguments('claude-code');
      expect(args[0]).toBe('--append-system-prompt');
      expect(args[1]).toContain('Korean (한국어)');
      const [execution] = modelBuilderCodexExecutionPlan({
        executable: 'codex',
        schemaPath: '/tmp/schema',
        resultPath: '/tmp/result',
        imagePaths: [],
        prompt,
        cwd: '/tmp',
      });
      expect(execution!.prompt).toBe(prompt);
      expect(
        execution!.args.find((value) => value.startsWith('developer_instructions=')),
      ).toContain('Korean (한국어)');
    });
    expect(modelLabLanguageArguments('codex')).toEqual([]);
  });

  it('localizes controlled import progress and error prose while preserving technical evidence', () => {
    const progress =
      'Static Python AST selected Model.forward; retained 300 of 500 lines in its transitive architecture capsule without executing the file.';
    expect(modelLabMessage(progress, 'en')).toBe(progress);
    expect(modelLabMessage(progress, 'ko')).toContain('Model.forward');
    expect(modelLabMessage(progress, 'ko')).toContain('300/500행');
    expect(
      modelLabMessage(
        "LLM call 2 is still running · 30 seconds elapsed · 5 minute limit. Waiting for the provider's complete ModelIR response.",
        'ko',
      ),
    ).toContain('30초 경과');
    expect(modelLabMessage('H3 = concat(H1_new, H2)', 'ko')).toBe('H3 = concat(H1_new, H2)');
    applicationLanguageContext.run({ language: 'ko', configured: true }, () => {
      expect(modelBuilderUserFacingError('model_copilot_codex_exit_1')).toContain('Codex가 종료');
      expect(
        modelBuilderUserFacingError('model_builder_invalid_model_ir: source.py:7 H3'),
      ).toContain('source.py:7 H3');
    });
  });
});
