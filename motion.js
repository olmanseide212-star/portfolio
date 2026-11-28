// Showreel-grade zero-dependency motion engine:
// opening curtain, interactive hero atmosphere + bokeh canvas, custom gallery cursor,
// magnetic interactions, layered 3D card tilt, clip-path scroll reveal, and scroll choreography.
import { clamp, lerp, computeTilt, computeMagneticOffset, computeScrollMetrics, shouldPlayIntro } from './motion-math.js?v=20261127-cinema';

const INTRO_KEY = 'portfolio_intro_seen';
const media = query => (typeof matchMedia === 'function' ? matchMedia(query) : { matches: false });
const reduceMotion = media('(prefers-reduced-motion: reduce)');
const finePointer = media('(hover: hover) and (pointer: fine)');
let observer = null;
let introTimers = [];
let introCleanup = null;

export function motionAllowed() { return !reduceMotion.matches; }
export function compactViewport() { return media('(max-width: 600px)').matches; }

function readSeen() {
  try { return sessionStorage.getItem(INTRO_KEY) === '1'; } catch { return false; }
}
function markSeen() {
  try { sessionStorage.setItem(INTRO_KEY, '1'); } catch { /* private browsing */ }
}

export function initMotion() {
  if (!motionAllowed() || compactViewport() || typeof IntersectionObserver !== 'function') return;
  observer = new IntersectionObserver(entries => {
    let batch = 0;
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.style.setProperty('--reveal-delay', `${Math.min(batch++, 5) * 80}ms`);
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.08 });
  // Hidden-until-revealed styles only apply once the observer exists.
  document.documentElement.classList.add('motion-ready');
}

export function playIntro({ force = false } = {}) {
  const html = document.documentElement;
  const curtain = document.getElementById('curtain');
  const clearTimers = () => { for (const id of introTimers) clearTimeout(id); introTimers = []; };
  const releaseHero = replay => {
    html.classList.remove('intro-pending');
    if (replay) {
      html.classList.remove('hero-entered');
      void html.offsetWidth;
    }
    html.classList.add('hero-entered');
  };
  clearTimers();
  if (introCleanup) { introCleanup(); introCleanup = null; }
  const allowed = (force || !compactViewport()) && shouldPlayIntro({ reducedMotion: !motionAllowed(), seenInSession: readSeen(), force });
  if (!curtain || !allowed) {
    if (curtain) curtain.classList.remove('is-active', 'is-charging', 'is-opening');
    releaseHero(false);
    return;
  }
  const finish = () => {
    clearTimers();
    if (introCleanup) { introCleanup(); introCleanup = null; }
    curtain.classList.remove('is-active', 'is-charging', 'is-opening');
    releaseHero(false);
    markSeen();
  };
  const onSkipKey = event => { if (event.key === 'Escape' || event.key === ' ' || event.key === 'Enter') finish(); };
  curtain.addEventListener('click', finish);
  window.addEventListener('keydown', onSkipKey);
  introCleanup = () => {
    curtain.removeEventListener('click', finish);
    window.removeEventListener('keydown', onSkipKey);
  };
  html.classList.add('intro-pending');
  html.classList.remove('hero-entered');
  curtain.classList.remove('is-opening', 'is-charging');
  curtain.classList.add('is-active');
  void curtain.offsetWidth;
  curtain.classList.add('is-charging');
  introTimers.push(setTimeout(() => {
    curtain.classList.add('is-opening');
    releaseHero(true);
  }, 460));
  introTimers.push(setTimeout(finish, 1180));
  // Hard safety cap so the curtain can never stall over content.
  introTimers.push(setTimeout(finish, 2200));
}

export function initHeroAtmosphere(root, canvas) {
  if (!root || !motionAllowed()) return;
  let targetX = 0.62, targetY = 0.42, currentX = 0.62, currentY = 0.42;
  let pointerInside = false, visible = true, frame = 0;
  const ctx = canvas?.getContext('2d') || null;
  let width = 0, height = 0, dpr = 1;
  const motes = Array.from({ length: 28 }, (_, index) => {
    const seed = (index + 1) * 1.6180339;
    return {
      x: (seed * 73.1) % 1,
      y: (seed * 41.7) % 1,
      depth: 0.25 + ((index * 19) % 10) / 13,
      radius: 0.8 + ((index * 7) % 10) * 0.16,
      speed: 0.000018 + ((index * 11) % 7) * 0.000006,
      drift: (seed * 17) % (Math.PI * 2),
      warm: index % 3 !== 0
    };
  });
  const resize = () => {
    if (!canvas || !ctx) return;
    const rect = root.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  if (typeof ResizeObserver === 'function') new ResizeObserver(resize).observe(root);
  else window.addEventListener('resize', resize, { passive: true });
  root.addEventListener('pointermove', event => {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    const rect = root.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    pointerInside = true;
    targetX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    targetY = clamp((event.clientY - rect.top) / rect.height, 0, 1);
  });
  root.addEventListener('pointerleave', () => { pointerInside = false; });
  const tick = now => {
    frame = 0;
    if (!visible || document.hidden) return;
    if (!pointerInside) {
      targetX = 0.56 + Math.sin(now * 0.00042) * 0.16;
      targetY = 0.44 + Math.cos(now * 0.00031) * 0.12;
    }
    currentX = lerp(currentX, targetX, 0.065);
    currentY = lerp(currentY, targetY, 0.065);
    root.style.setProperty('--hx', `${(currentX * 100).toFixed(2)}%`);
    root.style.setProperty('--hy', `${(currentY * 100).toFixed(2)}%`);
    if (ctx && width && height) {
      ctx.clearRect(0, 0, width, height);
      const px = (currentX - 0.5) * -36;
      const py = (currentY - 0.5) * -22;
      for (const mote of motes) {
        mote.y -= mote.speed * 16;
        if (mote.y < -0.05) mote.y = 1.05;
        const sway = Math.sin(now * 0.0006 + mote.drift) * 10 * mote.depth;
        const x = mote.x * width + sway + px * mote.depth;
        const y = mote.y * height + py * mote.depth;
        const alpha = (0.14 + 0.18 * mote.depth) * (0.72 + 0.28 * Math.sin(now * 0.0014 + mote.drift));
        ctx.beginPath();
        ctx.arc(x, y, mote.radius * (0.7 + mote.depth * 0.6), 0, Math.PI * 2);
        ctx.fillStyle = mote.warm ? `rgba(216,196,152,${alpha.toFixed(3)})` : `rgba(243,241,235,${(alpha * 0.7).toFixed(3)})`;
        ctx.fill();
      }
    }
    frame = requestAnimationFrame(tick);
  };
  const start = () => { if (!frame && visible && !document.hidden) frame = requestAnimationFrame(tick); };
  const stop = () => { if (frame) { cancelAnimationFrame(frame); frame = 0; } };
  if (typeof IntersectionObserver === 'function') {
    new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      if (visible) start(); else stop();
    }, { threshold: 0.01 }).observe(root);
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });
  start();
}

export function initCursor() {
  if (!motionAllowed() || !finePointer.matches) return;
  const dot = document.getElementById('cursorDot');
  const ring = document.getElementById('cursorRing');
  if (!dot || !ring) return;
  const html = document.documentElement;
  let mx = -100, my = -100, rx = -100, ry = -100, shown = false, frame = 0;
  const modalOpen = () => Boolean(document.querySelector('dialog[open]'));
  const hide = () => {
    shown = false;
    dot.classList.remove('is-visible', 'is-pressed');
    ring.classList.remove('is-visible', 'is-view', 'is-pointer', 'is-pressed');
    html.classList.remove('cursor-hidden-native');
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
  };
  const step = () => {
    frame = 0;
    if (!shown) return;
    rx = lerp(rx, mx, 0.18);
    ry = lerp(ry, my, 0.18);
    ring.style.transform = `translate3d(${rx.toFixed(1)}px,${ry.toFixed(1)}px,0)`;
    if (Math.hypot(mx - rx, my - ry) > 0.2) frame = requestAnimationFrame(step);
  };
  const setMode = target => {
    const isArtwork = target instanceof Element && Boolean(target.closest('.artwork'));
    const isInteractive = !isArtwork && target instanceof Element && Boolean(target.closest('a,button,.contact-card,.filter'));
    ring.classList.toggle('is-view', isArtwork);
    ring.classList.toggle('is-pointer', isInteractive);
    dot.classList.toggle('is-view', isArtwork);
  };
  window.addEventListener('pointermove', event => {
    if (event.pointerType && event.pointerType !== 'mouse') { hide(); return; }
    if (modalOpen() || (event.target instanceof Element && event.target.closest('dialog,input,textarea,select'))) {
      hide(); return;
    }
    mx = event.clientX; my = event.clientY;
    if (!shown) { rx = mx; ry = my; shown = true; }
    dot.style.transform = `translate3d(${mx}px,${my}px,0)`;
    dot.classList.add('is-visible');
    ring.classList.add('is-visible');
    html.classList.add('cursor-hidden-native');
    setMode(event.target);
    if (!frame) frame = requestAnimationFrame(step);
  }, { passive: true });
  window.addEventListener('pointerdown', event => {
    if (!shown || (event.pointerType && event.pointerType !== 'mouse')) return;
    dot.classList.add('is-pressed'); ring.classList.add('is-pressed');
  }, { passive: true });
  window.addEventListener('pointerup', () => {
    dot.classList.remove('is-pressed'); ring.classList.remove('is-pressed');
  }, { passive: true });
  document.documentElement.addEventListener('mouseleave', hide);
  window.addEventListener('blur', hide);
  // Restore native cursor immediately whenever any native <dialog> opens into the Top Layer.
  if (typeof MutationObserver === 'function') {
    const dialogObserver = new MutationObserver(() => { if (modalOpen()) hide(); });
    document.querySelectorAll('dialog').forEach(dialog => dialogObserver.observe(dialog, { attributes: true, attributeFilter: ['open'] }));
  }
}

export function enableMagnetic(root = document.body, selector = '.filter,.contact-card,.brand-mark,.nav-links a,.nav-links button,.footer-actions a,.footer-actions button') {
  if (!root || !motionAllowed() || !finePointer.matches) return;
  let active = null, point = null, frame = 0;
  const reset = node => {
    node.classList.remove('is-magnetic');
    node.style.removeProperty('--mag-x');
    node.style.removeProperty('--mag-y');
  };
  const paint = () => {
    frame = 0;
    if (!active || !point || !active.isConnected) return;
    const { x, y } = computeMagneticOffset(point.x, point.y, active.getBoundingClientRect(), { strength: 0.26, max: 7 });
    active.style.setProperty('--mag-x', `${x.toFixed(2)}px`);
    active.style.setProperty('--mag-y', `${y.toFixed(2)}px`);
    active.classList.add('is-magnetic');
  };
  root.addEventListener('pointermove', event => {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    const raw = event.target instanceof Element ? event.target.closest(selector) : null;
    const target = raw && !raw.closest('dialog') && !raw.disabled ? raw : null;
    if (target !== active) { if (active) reset(active); active = target; }
    if (!active) return;
    point = { x: event.clientX, y: event.clientY };
    if (!frame) frame = requestAnimationFrame(paint);
  }, { passive: true });
  root.addEventListener('pointerleave', () => { if (active) reset(active); active = null; point = null; });
}

export function initScrollChoreography() {
  const bar = document.getElementById('scrollProgress');
  const hero = document.querySelector('.hero');
  const top = document.getElementById('top');
  if (!bar && !hero) return;
  let frame = 0;
  const update = () => {
    frame = 0;
    const heroHeight = top ? top.offsetHeight : 0;
    const { progress, heroRatio } = computeScrollMetrics(window.scrollY, document.documentElement.scrollHeight, window.innerHeight, heroHeight);
    if (bar) bar.style.transform = `scaleX(${progress.toFixed(4)})`;
    if (hero && motionAllowed()) {
      const offset = compactViewport() ? 0 : heroRatio;
      hero.style.setProperty('--hero-shift', `${(offset * 84).toFixed(1)}px`);
      hero.style.setProperty('--hero-scale', (1 - offset * 0.055).toFixed(4));
      hero.style.setProperty('--hero-opacity', (1 - offset * 0.68).toFixed(3));
    }
  };
  const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  update();
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
    for (const name of ['--rx', '--ry', '--gx', '--gy', '--sx', '--sy', '--sheen']) node.style.removeProperty(name);
  };
  const paint = () => {
    frame = 0;
    if (!active || !point || !active.isConnected) return;
    const tilt = computeTilt(point.x, point.y, active.getBoundingClientRect());
    active.style.setProperty('--ry', `${tilt.ry.toFixed(2)}deg`);
    active.style.setProperty('--rx', `${tilt.rx.toFixed(2)}deg`);
    active.style.setProperty('--gx', `${tilt.gx.toFixed(1)}%`);
    active.style.setProperty('--gy', `${tilt.gy.toFixed(1)}%`);
    active.style.setProperty('--sx', `${tilt.sx.toFixed(1)}px`);
    active.style.setProperty('--sy', `${tilt.sy.toFixed(1)}px`);
    active.style.setProperty('--sheen', `${tilt.sheen.toFixed(1)}%`);
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
