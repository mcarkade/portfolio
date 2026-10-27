export function initTour({ getLenis }) {
  const root = document.querySelector('.tour');
  const play = root.querySelector('.tour__play');
  const speed = root.querySelector('.tour__speed');
  const rateGlyph = speed.querySelector('span');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let playing = false, rate = 1, frame = 0, last = 0;
  const blocked = () => reduce.matches || document.hidden || document.body.matches('.is-loading, .is-intro, .viewer-open') || document.querySelector('.nav.is-open');
  function stop() {
    playing = false;
    cancelAnimationFrame(frame);
    play.setAttribute('aria-pressed', 'false');
    play.setAttribute('aria-label', 'Start tour');
    root.classList.remove('is-playing');
  }
  function tick(now) {
    if (!playing || blocked()) { stop(); return; }
    const end = document.getElementById('contact').offsetTop;
    const y = getLenis()?.animatedScroll ?? window.scrollY;
    const target = Math.min(end, y + Math.min((now - last) / 1000, .06) * innerHeight * .13 * rate);
    last = now;
    if (getLenis()) getLenis().scrollTo(target, { immediate: true });
    else window.scrollTo(0, target);
    if (target >= end - 1) { stop(); return; }
    frame = requestAnimationFrame(tick);
  }
  play.addEventListener('click', () => {
    if (playing) { stop(); return; }
    if (blocked()) return;
    const end = document.getElementById('contact').offsetTop;
    if (window.scrollY >= end - 2) {
      if (getLenis()) getLenis().scrollTo(0, { immediate: true });
      else window.scrollTo(0, 0);
    }
    playing = true;
    play.setAttribute('aria-pressed', 'true');
    play.setAttribute('aria-label', 'Stop tour');
    root.classList.add('is-playing');
    last = performance.now();
    frame = requestAnimationFrame(tick);
  });
  speed.addEventListener('click', () => {
    rate = rate === 1 ? 2 : 1;
    rateGlyph.textContent = `${rate}×`;
    speed.setAttribute('aria-label', `Tour speed ${rate}x. Switch to ${rate === 1 ? 2 : 1}x`);
    speed.setAttribute('aria-pressed', String(rate === 2));
  });
  for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
    addEventListener(event, e => {
      const control = root.contains(e.target);
      if (!control || event === 'wheel' || (event === 'keydown' && !['Enter', ' '].includes(e.key))) stop();
    }, { passive: true, capture: true });
  }
  document.addEventListener('visibilitychange', stop);
  addEventListener('blur', stop);
  reduce.addEventListener('change', stop);
  return { stop };
}

export function initChapterRail() {
  const rail = document.querySelector('.chapter-rail');
  const links = [...rail.querySelectorAll('a')];
  const sections = links.map(link => document.querySelector(link.getAttribute('href')));
  let pending = 0;

  function update() {
    pending = 0;
    const y = window.scrollY + innerHeight * .25;
    let current = 0;
    sections.forEach((section, i) => { if (section.offsetTop <= y) current = i; });
    links.forEach((link, i) => {
      if (i === current) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }
  function scheduleUpdate() {
    if (!pending) pending = requestAnimationFrame(update);
  }
  addEventListener('scroll', scheduleUpdate, { passive: true });
  addEventListener('resize', scheduleUpdate);
  new ResizeObserver(scheduleUpdate).observe(document.querySelector('main'));
  update();
}
