// Isolated UI fixture: never invoke an actual model/provider or write real Model Lab data.
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, options) => {
  const path =
    typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
  if (path.includes('/api/model-lab-storage')) return new Response(null, { status: 204 });
  if (path.includes('/api/'))
    return new Response(JSON.stringify({ error: 'Fixture: provider calls disabled' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  return nativeFetch(input, options);
};
void import('../../../model-lab/src/main');
