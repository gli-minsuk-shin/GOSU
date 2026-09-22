import { createRoot } from 'react-dom/client';
import { ModelLabApp } from '../../model-lab/src/model-lab-app';
import '../../model-lab/node_modules/@xyflow/react/dist/style.css';
import '../../model-lab/src/styles.css';
// All provider calls are replaced by a cancellable local stream; no user source is read.
window.fetch = async (input, options) => {
  if (String(input).endsWith('/api/model-builder'))
    return new Response(
      new ReadableStream({
        start(controller) {
          const progress = {
            type: 'progress',
            progress: {
              phase: 'llm-running',
              message: 'Synthetic delayed generation · 15 minute limit · use Stop to cancel',
            },
          };
          controller.enqueue(new TextEncoder().encode(JSON.stringify(progress) + '\n'));
          options?.signal?.addEventListener(
            'abort',
            () => controller.error(new DOMException('Stopped', 'AbortError')),
            { once: true },
          );
        },
      }),
      { headers: { 'Content-Type': 'application/x-ndjson' } },
    );
  return new Response(JSON.stringify({ error: 'synthetic preview: provider disabled' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  });
};
function start() {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw Error('Import input missing');
  const transfer = new DataTransfer();
  transfer.items.add(
    new File(['class Example: pass'], 'synthetic_model.py', { type: 'text/x-python' }),
  );
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
createRoot(document.getElementById('root')!).render(
  <>
    <div style={{ padding: 12, background: '#eff5e7', color: '#24371b' }}>
      <button onClick={start}>모의 생성 시작</button> 합성 상태 검증 · 실제 LLM/사용자 모델 변경
      없음
    </div>
    <ModelLabApp />
  </>,
);
