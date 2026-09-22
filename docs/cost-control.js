const motionButton = document.getElementById('flow-motion');
const flow = document.querySelector('.request-flow');
motionButton?.addEventListener('click', () => {
  const paused = flow.classList.toggle('paused');
  motionButton.setAttribute('aria-pressed', String(paused));
  motionButton.textContent = paused ? 'Resume animation' : 'Pause animation';
});

document.querySelector('[data-copy]')?.addEventListener('click', async (event) => {
  const source = document.getElementById(event.currentTarget.dataset.copy);
  const status = document.getElementById('copy-status');
  try {
    await navigator.clipboard.writeText(source.textContent);
    status.textContent = 'Example copied.';
  } catch {
    status.textContent = 'Copy unavailable. Select the example text to copy it manually.';
  }
});

const hero = document.querySelector('.hero');
const particleCanvas = hero?.querySelector('.hero-particles');
const heroMotionButton = hero?.querySelector('.hero-motion');

if (hero && particleCanvas && heroMotionButton) {
  const context = particleCanvas.getContext('2d');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const pointer = { x: -1000, y: -1000 };
  const particles = Array.from({ length: 42 }, (_, index) => ({
    lane: index % 4,
    phase: (index * 0.61803398875) % 1,
    radius: index % 7 === 0 ? 2.2 : 1.2,
  }));
  let width = 0;
  let height = 0;
  let frame = 0;
  let elapsed = 0;
  let lastTime = 0;
  let visible = true;
  let paused = false;

  const resize = () => {
    const bounds = hero.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = bounds.width;
    height = bounds.height;
    particleCanvas.width = Math.round(width * ratio);
    particleCanvas.height = Math.round(height * ratio);
    context?.setTransform(ratio, 0, 0, ratio, 0, 0);
  };

  const smooth = (value) => value * value * (3 - 2 * value);

  const draw = (time) => {
    frame = 0;
    if (!context || paused || reducedMotion.matches || !visible || document.hidden) return;
    if (lastTime) elapsed += Math.min(time - lastTime, 50);
    lastTime = time;
    context.clearRect(0, 0, width, height);
    const mobile = width <= 800;
    const centerY = height * (mobile ? .78 : .54);

    for (const particle of particles) {
      const progress = (elapsed * .000065 + particle.phase) % 1;
      const entryY = height * (mobile ? .66 + particle.lane * .075 : .34 + particle.lane * .085);
      const merge = smooth(Math.min(progress / .66, 1));
      const x = width * ((mobile ? .03 : .29) + progress * (mobile ? .94 : .67));
      let y = entryY + (centerY - entryY) * merge;
      if (progress > .66) y += (progress - .66) * height * .025;

      const dx = x - pointer.x;
      const dy = y - pointer.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 0 && distance < 95) {
        const displacement = (1 - distance / 95) * 18;
        y += (dy / distance) * displacement;
      }

      const fade = Math.min(progress * 9, (1 - progress) * 9, 1);
      context.beginPath();
      context.arc(x, y, particle.radius, 0, Math.PI * 2);
      context.fillStyle = particle.lane === 2
        ? `rgba(199,255,61,${fade * .75})`
        : `rgba(245,243,238,${fade * .57})`;
      context.shadowColor = particle.lane === 2 ? '#c7ff3d' : '#f5f3ee';
      context.shadowBlur = 10;
      context.fill();
    }
    context.shadowBlur = 0;
    frame = window.requestAnimationFrame(draw);
  };

  const start = () => {
    if (frame || !context || paused || reducedMotion.matches || !visible || document.hidden) return;
    lastTime = 0;
    frame = window.requestAnimationFrame(draw);
  };

  hero.addEventListener('pointermove', (event) => {
    const bounds = hero.getBoundingClientRect();
    pointer.x = event.clientX - bounds.left;
    pointer.y = event.clientY - bounds.top;
  });
  hero.addEventListener('pointerleave', () => {
    pointer.x = -1000;
    pointer.y = -1000;
  });
  heroMotionButton.addEventListener('click', () => {
    paused = !paused;
    heroMotionButton.setAttribute('aria-pressed', String(paused));
    heroMotionButton.textContent = paused ? 'Resume motion' : 'Pause motion';
    if (paused) window.cancelAnimationFrame(frame);
    frame = 0;
    start();
  });
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) {
      window.cancelAnimationFrame(frame);
      frame = 0;
      context?.clearRect(0, 0, width, height);
    } else start();
  });
  document.addEventListener('visibilitychange', start);
  new ResizeObserver(() => { resize(); start(); }).observe(hero);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (!visible) {
      window.cancelAnimationFrame(frame);
      frame = 0;
    } else start();
  }).observe(hero);
  resize();
  start();
}
