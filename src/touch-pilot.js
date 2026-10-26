export function initTouchPilot({ isActive, setMouse }) {
  const section = document.getElementById('lock');
  let gesture = null, enabled = false;
  section.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch' || !e.isPrimary || !isActive()) return;
    gesture = { id: e.pointerId, x: e.clientX, y: e.clientY, direction: null };
  }, { passive: true });
  section.addEventListener('pointermove', e => {
    if (!gesture || gesture.id !== e.pointerId || !isActive()) return;
    const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
    if (!gesture.direction && Math.hypot(dx, dy) >= 10) {
      gesture.direction = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'horizontal' : 'vertical';
      if (gesture.direction === 'horizontal') section.setPointerCapture(e.pointerId);
    }
    if (gesture.direction !== 'horizontal') return;
    enabled = true;
    setMouse(Math.max(-1, Math.min(1, e.clientX / innerWidth * 2 - 1)), Math.max(-1, Math.min(1, 1 - e.clientY / innerHeight * 2)));
  }, { passive: true });
  const release = () => { gesture = null; };
  section.addEventListener('pointerup', release);
  section.addEventListener('pointercancel', release);
  addEventListener('scroll', () => { if (!isActive()) { release(); enabled = false; } }, { passive: true });
  return { get active() { return enabled && isActive(); } };
}
