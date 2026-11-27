// Pure math and gating helpers for gallery motion, tested independently in Node.
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const lerp = (start, end, factor) => start + (end - start) * factor;

export function computeTilt(clientX, clientY, rect, { maxY = 9, maxX = 7, shadow = 26 } = {}) {
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return { rx: 0, ry: 0, gx: 50, gy: 50, sx: 0, sy: 0, sheen: 50 };
  }
  const nx = clamp((clientX - rect.left) / rect.width, 0, 1);
  const ny = clamp((clientY - rect.top) / rect.height, 0, 1);
  const dx = (nx - 0.5) * 2;
  const dy = (ny - 0.5) * 2;
  return {
    ry: (dx * maxY) || 0,
    rx: (-dy * maxX) || 0,
    gx: nx * 100,
    gy: ny * 100,
    sx: (-dx * shadow) || 0,
    sy: (-dy * shadow) || 0,
    sheen: nx * 100
  };
}

export function computeMagneticOffset(clientX, clientY, rect, { strength = 0.28, max = 8 } = {}) {
  if (!rect || rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  const dx = clientX - (rect.left + rect.width / 2);
  const dy = clientY - (rect.top + rect.height / 2);
  return {
    x: clamp(dx * strength, -max, max),
    y: clamp(dy * strength, -max, max)
  };
}

export function computeScrollMetrics(scrollY, scrollHeight, viewportHeight, heroHeight) {
  const safeScroll = Math.max(0, Number.isFinite(scrollY) ? scrollY : 0);
  const maxScroll = Math.max(0, (Number.isFinite(scrollHeight) ? scrollHeight : 0) - (Number.isFinite(viewportHeight) ? viewportHeight : 0));
  const progress = maxScroll > 0 ? clamp(safeScroll / maxScroll, 0, 1) : 0;
  const heroRatio = heroHeight > 0 ? clamp(safeScroll / heroHeight, 0, 1) : 0;
  return { progress, heroRatio };
}

export function shouldPlayIntro({ reducedMotion = false, seenInSession = false, force = false } = {}) {
  if (reducedMotion) return false;
  if (force) return true;
  return !seenInSession;
}
