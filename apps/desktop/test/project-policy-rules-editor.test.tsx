import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  ProjectPolicyRulesEditor,
  projectPolicyRulesValidationMessage,
} from '../src/renderer/src/project-policy-rules-editor';

describe('Project policy rules editor', () => {
  it('renders a bounded accessible list with item-level edit and remove actions', () => {
    const html = renderToStaticMarkup(
      <ProjectPolicyRulesEditor
        projectName="Agentic study"
        rules={['Separate measured results from estimates.', 'State uncertainty explicitly.']}
        profileVersion={4}
        onSave={vi.fn(async () => true)}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain('PROJECT-WIDE POLICY');
    expect(html).toContain('Rules for Agentic study');
    expect(html).toContain('Applied to every existing and new chat session');
    expect(html).toContain('Separate measured results from estimates.');
    expect(html.match(/>Edit</gu)).toHaveLength(2);
    expect(html.match(/>Remove</gu)).toHaveLength(2);
    expect(html).toContain('2 / 20 rules');
    expect(html).toContain('Add rule');
  });

  it('exposes the same strict validation used by the Main process contract', () => {
    expect(projectPolicyRulesValidationMessage(['  Keep results reproducible.  '])).toBeNull();
    expect(
      projectPolicyRulesValidationMessage([
        'Keep results reproducible.',
        'keep results reproducible.',
      ]),
    ).toContain('unique');
    expect(projectPolicyRulesValidationMessage(['hidden\u200btext'])).toContain(
      'hidden or control characters',
    );
  });
});
