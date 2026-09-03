// Copy to LCE/src/core/responsive-compat.js via scripts/link-lce.mjs.
// No persistent LCE setting is changed by this adapter.
const listeners = new Set();
let ownership = { mouth: false, expressions: false };
let bound;
let observing = false;
export const responsiveOwns = capability => ownership[capability] === true;
export function observeResponsive(listener) {
  listeners.add(listener);
  function bind() {
    const api = globalThis.Liko?.Responsive_Liko;
    if (!api || api === bound || api.apiVersion !== 1 || typeof api.registerConsumer !== 'function') return;
    bound = api;
    api.registerConsumer('LCE', desired => {
      const previous = ownership;
      ownership = { mouth: desired.mouth === true, expressions: desired.expressions === true };
      if (previous.mouth !== ownership.mouth || previous.expressions !== ownership.expressions) {
        for (const callback of listeners) callback(ownership, previous);
      }
      return true;
    });
  }
  if (!observing) {
    observing = true;
    globalThis.addEventListener('Responsive_Liko:state', bind);
  }
  bind();
  listener(ownership, { mouth: false, expressions: false });
  return () => listeners.delete(listener);
}
