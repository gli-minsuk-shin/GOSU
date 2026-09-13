import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import 'katex/dist/katex.min.css';
import { ModelLabApp } from './model-lab-app';
import { modelLabHostConfiguration } from './model-lab-environment';
import { installEmbeddedTypography } from './model-lab-typography';
import './styles.css';
import './model-lab-embedded.css';
import './project-model-workspace.css';

const root = document.getElementById('root');
installEmbeddedTypography(Boolean(modelLabHostConfiguration()));

if (!root) {
  throw new Error('model_lab_root_missing');
}

createRoot(root).render(
  <StrictMode>
    <ModelLabApp />
  </StrictMode>,
);
