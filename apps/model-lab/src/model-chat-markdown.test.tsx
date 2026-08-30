import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ModelChatMarkdown,
  MODEL_CHAT_MATH_LIMITS,
  safeModelChatMarkdownUrl,
} from './model-chat-markdown';
import {
  formatModelChatTime,
  modelChatScrollState,
  modelCopilotProviderLabel,
} from './model-lab-app';

function renderChat(source: string) {
  return renderToStaticMarkup(<ModelChatMarkdown source={source} />);
}

describe('Model Chat Markdown', () => {
  it('renders GOSU-style Markdown with inline and display LaTeX through KaTeX', () => {
    const html = renderChat(String.raw`The update is $H_{t+1}=H_t+\Delta H_t$.

$$
\beta_{out}=\operatorname{soft}(\beta_{init};\tau)
$$

- preserves **tensor shapes**
- supports *math-aware Markdown*`);

    expect(html).toContain('class="model-chat-markdown"');
    expect(html).toContain('class="katex"');
    expect(html).toContain('class="katex-display"');
    expect(html).toContain('<math xmlns="http://www.w3.org/1998/Math/MathML"');
    expect(html).toContain(
      '<annotation encoding="application/x-tex">H_{t+1}=H_t+\\Delta H_t</annotation>',
    );
    expect(html).toContain('<strong>tensor shapes</strong>');
    expect(html).toContain('<em>math-aware Markdown</em>');
    expect(html).toContain('<ul>');
  });

  it('keeps malformed and over-budget formulas visible without executing untrusted content', () => {
    const malformed = renderChat(String.raw`Invalid: $\notacommand{$`);
    const overlong = 'x'.repeat(MODEL_CHAT_MATH_LIMITS.maxCharactersPerFormula + 1);
    const bounded = renderChat(`$${overlong}$`);
    const unsafe = renderChat(
      String.raw`<script>alert(1)</script>

[bad](javascript:alert(1))

![tracker](https://evil.example/t.png)`,
    );

    expect(malformed).toContain('katex-error');
    expect(bounded).not.toContain('class="katex"');
    expect(bounded).toContain(`<code>$${overlong}$</code>`);
    expect(unsafe).not.toContain('<script');
    expect(unsafe).not.toContain('<img');
    expect(unsafe).not.toContain('javascript:');
    expect(unsafe).toContain('Remote image blocked: tracker');
  });

  it('allows only HTTPS Markdown links', () => {
    expect(safeModelChatMarkdownUrl('https://example.com/paper')).toBe('https://example.com/paper');
    expect(safeModelChatMarkdownUrl('http://example.com/paper')).toBe('');
    expect(safeModelChatMarkdownUrl('javascript:alert(1)')).toBe('');
  });

  it('does not let provenance styling override Markdown emphasis', () => {
    const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    const appSource = readFileSync(new URL('./model-lab-app.tsx', import.meta.url), 'utf8');

    expect(styles).toContain('.chat-message__provenance {');
    expect(styles).not.toContain('.chat-message em {');
    expect(appSource).toContain('<span className="chat-message__provenance">');
  });

  it('keeps chat cards, long code, provenance, and display math inside the Copilot width', () => {
    const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

    expect(styles).toMatch(
      /\.chat-body \{[\s\S]*?width: 100%;[\s\S]*?min-width: 0;[\s\S]*?overflow-x: hidden;/u,
    );
    expect(styles).toMatch(
      /\.chat-message \{[\s\S]*?width: 100%;[\s\S]*?min-width: 0;[\s\S]*?max-width: 100%;[\s\S]*?overflow: hidden;/u,
    );
    expect(styles).toMatch(
      /\.model-chat-markdown :not\(pre\) > code \{[\s\S]*?overflow-wrap: anywhere;[\s\S]*?word-break: break-word;[\s\S]*?white-space: pre-wrap;/u,
    );
    expect(styles).toMatch(
      /\.model-chat-markdown \.katex-display > \.katex \{[\s\S]*?width: max-content;[\s\S]*?min-width: 100%;/u,
    );
    expect(styles).toMatch(
      /\.chat-message__provenance \{[\s\S]*?max-width: 100%;[\s\S]*?overflow-wrap: anywhere;/u,
    );
  });

  it('keeps the complete per-model conversation in a dedicated vertical scroll viewport', () => {
    const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    const appSource = readFileSync(new URL('./model-lab-app.tsx', import.meta.url), 'utf8');

    expect(appSource).toContain('aria-label="Model Copilot conversation history"');
    expect(appSource).toContain('{messages.map((message) => (');
    expect(appSource).not.toContain('messages.slice(-4)');
    expect(styles).toMatch(
      /\.model-chat--sidebar \{[\s\S]*?display: flex;[\s\S]*?flex-direction: column;/u,
    );
    expect(styles).toMatch(
      /\.model-chat--sidebar > \.model-chat__transcript-region \{[\s\S]*?flex: 1 1 0;/u,
    );
    expect(styles).toMatch(
      /\.chat-body \{[\s\S]*?position: relative;[\s\S]*?display: flex;[\s\S]*?flex-direction: column;[\s\S]*?height: 100%;[\s\S]*?overflow-y: scroll;[\s\S]*?overscroll-behavior-y: contain;[\s\S]*?scrollbar-gutter: stable both-edges;/u,
    );
    expect(styles).toMatch(/\.chat-message \{[\s\S]*?flex: 0 0 auto;/u);
    expect(styles).toMatch(/\.chat-message--user \{[\s\S]*?align-self: flex-end;/u);
    expect(
      modelChatScrollState({
        scrollTop: 0,
        scrollHeight: 1_200,
        clientHeight: 400,
      }),
    ).toEqual({ canScroll: true, atTop: true, nearBottom: false });
    expect(
      modelChatScrollState({
        scrollTop: 400,
        scrollHeight: 1_200,
        clientHeight: 400,
      }),
    ).toEqual({ canScroll: true, atTop: false, nearBottom: false });
    expect(
      modelChatScrollState({
        scrollTop: 800,
        scrollHeight: 1_200,
        clientHeight: 400,
      }),
    ).toEqual({ canScroll: true, atTop: false, nearBottom: true });
    expect(appSource).toContain('Scroll to earlier Model Copilot messages');
    expect(appSource).toContain('Jump to the latest Model Copilot message');
    expect(styles).toContain('.model-chat__scroll-jump {');
  });

  it('shows provider-neutral live agent progress and a real abort control', () => {
    const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    const appSource = readFileSync(new URL('./model-lab-app.tsx', import.meta.url), 'utf8');

    expect(appSource).toContain('Live Model Copilot agent activity');
    expect(appSource).toContain("progress.tool.replaceAll('_', ' ')");
    expect(appSource).toContain("{answering ? 'Stop' : 'Send'}");
    expect(appSource).toContain('copilotTurnAbortRef.current?.abort()');
    expect(appSource).toContain('message.usage.inputTokens.toLocaleString()');
    expect(styles).toContain('.model-chat__agent-progress {');
    expect(styles).toContain('.model-chat__stop-button {');
    expect(styles).toContain('.chat-message__usage {');
  });

  it('uses the GOSU Project Chat interaction structure in Model Copilot', () => {
    const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    const appSource = readFileSync(new URL('./model-lab-app.tsx', import.meta.url), 'utf8');

    expect(appSource).toContain('className="model-chat__identity"');
    expect(appSource).toContain("message.role === 'user' ? 'You' : 'GOSU'");
    expect(appSource).toContain('formatModelChatTime(message.createdAt)');
    expect(appSource).toContain('Show details');
    expect(appSource).toContain('Agent run details');
    expect(appSource).toContain('<span>LOCAL MODEL CONTEXT</span>');
    expect(appSource).toContain('aria-label="Message GOSU Model Copilot"');
    expect(appSource).toContain('Jump to the latest Model Copilot message');
    expect(styles).toMatch(
      /\.model-chat__composer-row \{[\s\S]*?grid-template-columns: 54px minmax\(0, 1fr\) 76px;/u,
    );
    expect(styles).toMatch(
      /\.model-chat--sidebar > \.model-chat__transcript-region \{[\s\S]*?flex: 1 1 0;/u,
    );
    expect(styles).toMatch(/\.model-chat--sidebar > \.chat-composer \{[\s\S]*?flex: 0 0 auto;/u);
    expect(styles).toContain('.chat-message--thinking {');
    expect(formatModelChatTime('2026-08-27T14:05:00')).toBe('02:05 PM');
    expect(formatModelChatTime('not-a-date')).toBe('');
  });

  it('uses the GOSU provider catalog and compact model-control design', () => {
    const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    const appSource = readFileSync(new URL('./model-lab-app.tsx', import.meta.url), 'utf8');

    expect(modelCopilotProviderLabel('codex')).toBe('OpenAI · Codex');
    expect(modelCopilotProviderLabel('claude-code')).toBe('Anthropic · Claude Code');
    expect(appSource).toContain('Auto · provider recommended');
    expect(appSource).toContain('<optgroup');
    expect(appSource).toContain('Unavailable model · choose again');
    expect(appSource).toContain('Unavailable reasoning · choose again');
    expect(appSource).toContain('gosuModelLabRuntime.listModels?.({ refresh: true })');
    expect(appSource).toContain('providerId: descriptor?.providerId ?? null');
    expect(styles).toMatch(
      /\.model-chat__model-controls \{[\s\S]*?grid-template-columns: minmax\(0, 1\.15fr\) minmax\(0, 0\.75fr\) auto;/u,
    );
    expect(styles).toContain('.model-chat__catalog-refresh {');
    expect(styles).toContain('.model-chat__toolbar-badges > span.warning {');
  });
});
