import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ModelChatMarkdown,
  MODEL_CHAT_MATH_LIMITS,
  safeModelChatMarkdownUrl,
} from './model-chat-markdown';

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
      /\.model-chat--sidebar \{[\s\S]*?grid-template-rows: auto auto minmax\(0, 1fr\) auto;/u,
    );
    expect(styles).toMatch(
      /\.chat-body \{[\s\S]*?overflow-y: auto;[\s\S]*?overscroll-behavior-y: contain;[\s\S]*?scrollbar-gutter: stable;[\s\S]*?touch-action: pan-y;/u,
    );
  });

  it('shows provider-neutral live agent progress and a real abort control', () => {
    const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    const appSource = readFileSync(new URL('./model-lab-app.tsx', import.meta.url), 'utf8');

    expect(appSource).toContain('Live Model Copilot agent activity');
    expect(appSource).toContain("progress.tool.replaceAll('_', ' ')");
    expect(appSource).toContain("answering ? 'Stop' : 'Ask'");
    expect(appSource).toContain('copilotTurnAbortRef.current?.abort()');
    expect(appSource).toContain('message.usage.inputTokens.toLocaleString()');
    expect(styles).toContain('.model-chat__agent-progress {');
    expect(styles).toContain('.model-chat__stop-button {');
    expect(styles).toContain('.chat-message__usage {');
  });
});
