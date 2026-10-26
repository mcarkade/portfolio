export function initTour({ getLenis }) {
  const root = document.querySelector('.tour');
  const play = root.querySelector('.tour__play');
  const speed = root.querySelector('.tour__speed');
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
    speed.textContent = `${rate}x`;
    speed.setAttribute('aria-label', `Tour speed ${rate}x`);
  });
  for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
    addEventListener(event, e => {
      const control = root.contains(e.target);
      if (!control || event === 'wheel' || (event === 'keydown' && !['Enter', ' '].includes(e.key))) stop();
    }, { passive: true, capture: true });
  }
  document.addEventListener('visibilitychange', stop);
  reduce.addEventListener('change', stop);
  return { stop };
}

export function initChapterRail() {
  const rail = document.querySelector('.chapter-rail');
  const links = [...rail.querySelectorAll('a')];
  function measure() {
    const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    const length = Math.max(220, rail.clientHeight);
    const positions = links.map(link => {
      const section = document.querySelector(link.getAttribute('href'));
      return Math.min(1, section.offsetTop / max) * length;
    });
    // Nearby chapters still need separate 44px targets.
    for (let i = 1; i < positions.length; i++) positions[i] = Math.max(positions[i], positions[i - 1] + 44);
    positions[positions.length - 1] = Math.min(length, positions.at(-1));
    for (let i = positions.length - 2; i >= 0; i--) positions[i] = Math.min(positions[i], positions[i + 1] - 44);
    links.forEach((link, i) => {
      link.style.setProperty('--at', `${positions[i] / length * 100}%`);
    });
  }
  let pending = 0;
  function update() {
    pending = 0;
    let current = null;
    for (const link of links) {
      if (document.querySelector(link.getAttribute('href')).getBoundingClientRect().top <= innerHeight * .25) current = link;
    }
    links.forEach(link => {
      if (link === current) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }
  addEventListener('scroll', () => { if (!pending) pending = requestAnimationFrame(update); }, { passive: true });
  new ResizeObserver(measure).observe(document.querySelector('main'));
  addEventListener('resize', measure);
  measure();
  update();
}
