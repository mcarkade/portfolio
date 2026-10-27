const RATE = 1.8; // Viewports per second, shared by every manual input source.
const BURST = .06;
const RESPONSE = .18;

export function createManualScroll(getLenis, { height = () => innerHeight, now = () => performance.now() } = {}) {
  let pending = 0, budget = BURST, inputTime = null, frameTime = null;
  let direction = 0, gesture = null, writing = false, velocity = 0, position = null;

  function reset() {
    pending = 0;
    budget = BURST;
    inputTime = frameTime = null;
    direction = 0;
    gesture = null;
    velocity = 0;
    position = null;
  }

  function virtualScroll({ deltaX, deltaY, event }) {
    const lenis = getLenis();
    const touch = event.type.startsWith('touch');
    const wheel = event.type === 'wheel';
    if (!lenis || (!touch && !wheel)) return false;
    if (event.ctrlKey || event.defaultPrevented || event.lenisStopPropagation || lenis.prefersReducedMotion) {
      reset();
      return false;
    }

    // Preserve native controls and the viewer/menu's own scrolling before claiming input.
    const vertical = Math.abs(deltaY) > Math.abs(deltaX);
    const prevent = `[data-lenis-prevent], [data-lenis-prevent-${touch ? 'touch' : 'wheel'}], [data-lenis-prevent-${vertical ? 'vertical' : 'horizontal'}], .nav.is-open, input, textarea, select, video, [contenteditable="true"]`;
    if (event.composedPath().some(node => node.matches?.(prevent))) {
      reset();
      return false;
    }
    if (lenis.isStopped || lenis.isLocked) {
      reset();
      return true; // Lenis still prevents page movement while an overlay locks it.
    }

    if (touch) {
      const touches = event.touches?.length ?? event.targetTouches.length;
      if (touches > 1 || gesture?.mode === 'pinch') {
        reset();
        if (touches) gesture = { mode: 'pinch' };
        return false;
      }
      if (event.type === 'touchstart') {
        reset();
        if (lenis.isIos && lenis.isTouchOnSelectionHandle(event)) return false;
        gesture = { x: 0, y: 0, mode: null };
        return false;
      }
      if (!gesture) return false;
      if (event.type === 'touchend') {
        const wasVertical = gesture.mode === 'vertical';
        gesture = null;
        // The remaining eased travel is the entire inertia allowance. Do not reuse
        // touchend's repeated lastDelta or Lenis's velocity exponent.
        if (wasVertical) {
          pending = Math.sign(pending) * Math.min(Math.abs(pending), BURST);
          if (event.cancelable) event.preventDefault();
        }
        return false;
      }
      gesture.x += deltaX;
      gesture.y += deltaY;
      if (!gesture.mode && Math.hypot(gesture.x, gesture.y) >= 7) {
        gesture.mode = Math.abs(gesture.x) > Math.abs(gesture.y) * 1.2 ? 'horizontal' : 'vertical';
      }
      if (gesture.mode === 'horizontal') return false;
      if (!gesture.mode) {
        if (event.cancelable) event.preventDefault();
        return false;
      }
    } else if (deltaY === 0) return false;

    if (!event.cancelable || !Number.isFinite(deltaY) || !Number.isFinite(height()) || height() <= 0) {
      reset();
      return false;
    }
    event.preventDefault();
    const time = now();
    const elapsed = inputTime === null ? 0 : Math.max(0, (time - inputTime) / 1000);
    budget = Math.min(BURST, budget + RATE * elapsed);
    inputTime = time;
    const sign = Math.sign(deltaY);
    if (sign && sign !== direction) {
      pending = 0; // A reversal discards the previous direction's unplayed travel.
      position = lenis.animatedScroll;
      direction = sign;
    }
    const admitted = Math.min(Math.abs(deltaY) / height(), budget);
    budget -= admitted;
    if (admitted) {
      if (frameTime === null) frameTime = time;
      if (position === null) position = lenis.animatedScroll;
      if (lenis.isScrolling) lenis.reset(); // Manual input takes over from navigation.
      pending = sign * Math.min(RATE * RESPONSE * 1.25, Math.abs(pending) + admitted);
    }
    return false;
  }

  function raf(time) {
    const lenis = getLenis();
    velocity = 0;
    if (!lenis || lenis.isStopped || lenis.isLocked || lenis.prefersReducedMotion) { reset(); return; }
    if (frameTime === null) return;
    const dt = (time - frameTime) / 1000;
    // Never replay suspended-tab time or let a slow frame make a large jump.
    if (!Number.isFinite(dt) || dt > .25) { reset(); return; }
    // Input can arrive after this frame's timestamp was sampled. Keep the gesture
    // and wait for the next frame instead of releasing the touch to native scroll.
    if (dt <= 0) return;
    frameTime = time;
    if (!pending) return;
    const step = Math.sign(pending) * Math.min(RATE * Math.min(dt, .05), Math.abs(pending) * (1 - Math.exp(-dt / RESPONSE)));
    const current = lenis.animatedScroll;
    // Retain fractional pixels across frames. Browsers can round scrollTo, and
    // repeatedly adding to the rounded position otherwise changes the speed.
    const target = Math.max(0, Math.min(lenis.limit, position + step * height()));
    position = target;
    pending -= step;
    if (Math.abs(pending) < .00001 || target === 0 || target === lenis.limit) pending = 0;
    writing = true;
    try { lenis.scrollTo(target, { immediate: true }); }
    finally { writing = false; }
    // Match Lenis's velocity units at 60 Hz for the film's existing effects.
    velocity = (lenis.animatedScroll - current) / dt / 60;
  }

  return { virtualScroll, raf, reset, onScroll: () => { if (!writing) reset(); }, get velocity() { return velocity; } };
}
