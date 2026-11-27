// Gallery motion: scroll reveal, pointer tilt with gloss, and view transitions.
// Everything degrades to fully visible, static content when motion is reduced
// or a browser API is missing.
const media = query => (typeof matchMedia === 'function' ? matchMedia(query) : { matches: false });
const reduceMotion = media('(prefers-reduced-motion: reduce)');
const finePointer = media('(hover: hover) and (pointer: fine)');
let observer = null;

export function motionAllowed() { return !reduceMotion.matches; }

export function initMotion() {
  if (!motionAllowed() || typeof IntersectionObserver !== 'function') return;
  observer = new IntersectionObserver(entries => {
    let batch = 0;
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.style.setProperty('--reveal-delay', `${Math.min(batch++, 5) * 70}ms`);
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.08 });
  // Hidden-until-revealed styles only apply once the observer exists.
  document.documentElement.classList.add('motion-ready');
}

// immediate: nodes already inside the viewport appear without animating,
// used when re-rendering after filtering so content never blinks out.
export function reveal(nodes, { immediate = false } = {}) {
  const list = [...nodes].filter(Boolean);
  if (!observer) { for (const node of list) node.classList.add('reveal', 'is-visible'); return; }
  const inView = immediate ? list.map(node => {
    const rect = node.getBoundingClientRect();
    return rect.top < innerHeight && rect.bottom > 0;
  }) : [];
  list.forEach((node, index) => {
    if (inView[index]) { node.classList.add('reveal', 'is-visible'); return; }
    node.classList.add('reveal');
    observer.observe(node);
  });
}

export function enableTilt(root, selector = '.artwork') {
  if (!root || !motionAllowed() || !finePointer.matches) return;
  let active = null, point = null, frame = 0;
  const reset = node => {
    node.classList.remove('is-tilting');
    for (const name of ['--rx', '--ry', '--gx', '--gy']) node.style.removeProperty(name);
  };
  const paint = () => {
    frame = 0;
    if (!active || !point || !active.isConnected) return;
    const rect = active.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.min(1, Math.max(0, (point.x - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (point.y - rect.top) / rect.height));
    active.style.setProperty('--ry', `${((x - 0.5) * 10).toFixed(2)}deg`);
    active.style.setProperty('--rx', `${((0.5 - y) * 8).toFixed(2)}deg`);
    active.style.setProperty('--gx', `${(x * 100).toFixed(1)}%`);
    active.style.setProperty('--gy', `${(y * 100).toFixed(1)}%`);
    active.classList.add('is-tilting');
  };
  root.addEventListener('pointermove', event => {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    const target = event.target instanceof Element ? event.target.closest(selector) : null;
    if (target !== active) { if (active) reset(active); active = target && root.contains(target) ? target : null; }
    if (!active) return;
    point = { x: event.clientX, y: event.clientY };
    if (!frame) frame = requestAnimationFrame(paint);
  });
  root.addEventListener('pointerleave', () => { if (active) reset(active); active = null; point = null; });
}

export function transition(update) {
  if (!motionAllowed() || typeof document.startViewTransition !== 'function') { update(); return; }
  document.startViewTransition(update);
}
