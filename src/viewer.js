export function initViewer({ getLenis, onOpen }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'viewer';
  dialog.setAttribute('aria-labelledby', 'viewer-title');
  dialog.setAttribute('data-lenis-prevent', '');
  dialog.innerHTML = `
    <button class="viewer__close" type="button" aria-label="Close project">×</button>
    <div class="viewer__stage"></div>
    <div class="viewer__footer">
      <h2 id="viewer-title"></h2>
      <div class="viewer__actions">
        <button class="viewer__prev" type="button" aria-label="Previous media">←</button>
        <button class="viewer__next" type="button" aria-label="Next media">→</button>
        <a class="viewer__link" target="_blank" rel="noopener" aria-label="Open project">↗</a>
      </div>
    </div>`;
  document.body.append(dialog);
  const stage = dialog.querySelector('.viewer__stage');
  const title = dialog.querySelector('h2');
  const external = dialog.querySelector('a');
  const previous = dialog.querySelector('.viewer__prev');
  const next = dialog.querySelector('.viewer__next');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let media = [], index = 0, origin, scrollY = 0, wasStopped = false, gesture;

  function show(step = 0) {
    index = (index + step + media.length) % media.length;
    stage.querySelector('video')?.pause();
    const item = media[index];
    const el = document.createElement(item.video ? 'video' : 'img');
    if (item.video) {
      el.controls = true;
      el.playsInline = true;
      el.muted = true;
      el.loop = true;
      el.preload = 'metadata';
      el.setAttribute('aria-label', title.textContent);
      el.poster = media[0].src;
    } else {
      el.alt = title.textContent;
      el.draggable = false;
    }
    el.src = item.src;
    stage.replaceChildren(el);
    if (!reduce.matches) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 350 });
  }

  function open(link) {
    if (dialog.open) return;
    onOpen?.();
    origin = link;
    scrollY = window.scrollY;
    wasStopped = getLenis()?.isStopped || false;
    getLenis()?.stop();
    document.body.classList.add('viewer-open');
    title.textContent = link.dataset.gallery;
    media = [link.dataset.image, link.dataset.alternate].filter(Boolean).map(name => ({ src: `/media/${name}` }));
    if (link.dataset.video) media.push({ src: `/media/${link.dataset.video}`, video: true });
    index = 0;
    const url = link.getAttribute('href');
    external.hidden = !/^https:\/\//.test(url);
    if (!external.hidden) external.href = url;
    else external.removeAttribute('href');
    previous.hidden = next.hidden = media.length < 2;
    show();
    dialog.showModal();
    dialog.querySelector('button').focus({ preventScroll: true });
    if (!reduce.matches) dialog.animate([
      { clipPath: 'inset(48% 0 48% 0)' }, { clipPath: 'inset(0% 0 0% 0)' },
    ], { duration: 650, easing: 'cubic-bezier(.22,1,.36,1)' });
  }

  function close() { if (dialog.open) dialog.close(); }
  dialog.addEventListener('close', () => {
    stage.querySelector('video')?.pause();
    stage.replaceChildren();
    document.body.classList.remove('viewer-open');
    origin?.focus({ preventScroll: true });
    if (!wasStopped) getLenis()?.start();
    if (getLenis()) getLenis().scrollTo(scrollY, { immediate: true, force: true });
    else window.scrollTo(0, scrollY);
  });
  dialog.querySelector('.viewer__close').addEventListener('click', close);
  dialog.addEventListener('click', e => { if (e.target === dialog) close(); });
  previous.addEventListener('click', () => show(-1));
  next.addEventListener('click', () => show(1));
  dialog.addEventListener('keydown', e => {
    // Native video controls retain their own arrow-key seeking.
    if (e.target.tagName !== 'VIDEO' && ['ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      show(e.key === 'ArrowLeft' ? -1 : 1);
    }
    if (e.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('button, a[href], video')].filter(el => !el.hidden);
    const first = controls[0], last = controls.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  stage.addEventListener('pointerdown', e => {
    if (e.target.tagName === 'VIDEO' && (e.pointerType !== 'touch' || e.clientY > e.target.getBoundingClientRect().bottom - 56)) return;
    gesture = { id: e.pointerId, x: e.clientX, y: e.clientY };
  });
  stage.addEventListener('pointermove', e => {
    if (!gesture || gesture.id !== e.pointerId) return;
    const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointerup', e => {
    if (!gesture || gesture.id !== e.pointerId) return;
    const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) show(dx < 0 ? 1 : -1);
    gesture = null;
  });
  stage.addEventListener('pointercancel', () => { gesture = null; });
  document.querySelectorAll('.gallery-access a[data-image]').forEach(link => {
    if (link.getAttribute('href').startsWith('#')) return;
    link.setAttribute('aria-haspopup', 'dialog');
    link.removeAttribute('target');
    link.addEventListener('click', e => { e.preventDefault(); open(link); });
  });
}
