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
