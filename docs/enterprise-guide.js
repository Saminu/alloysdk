const tabButtons = document.querySelectorAll('[data-tab]');
const codePanels = document.querySelectorAll('[role="tabpanel"]');
const copyButtons = document.querySelectorAll('[data-copy], [data-copy-target]');

tabButtons.forEach((button) => {
  button.addEventListener('click', () => {
    tabButtons.forEach((item) => item.setAttribute('aria-selected', String(item === button)));
    codePanels.forEach((panel) => { panel.hidden = panel.id !== button.dataset.tab; });
    document.querySelector('.code-example:not(.request-code) .copy-code').dataset.copyTarget = button.dataset.tab;
  });
});

copyButtons.forEach((button) => {
  button.addEventListener('click', async () => {
    const text = button.dataset.copy || document.getElementById(button.dataset.copyTarget).innerText;
    await navigator.clipboard.writeText(text);
    const original = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = original; }, 1200);
  });
});
