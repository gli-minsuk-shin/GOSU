import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import 'katex/dist/katex.min.css';
import { ModelLabApp } from './model-lab-app';
import './styles.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('model_lab_root_missing');
}

createRoot(root).render(
  <StrictMode>
    <ModelLabApp />
  </StrictMode>,
);
