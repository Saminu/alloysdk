import { compressText, estimateTokens, optimizePayload, runLiveTest } from './alloy-web.js';

const PRESETS = {
  underwriting: `Commercial underwriting submission

--------------------------------------------------
Risk data:
{
  "facility": "Apex Global Cold Storage",
  "yearBuilt": 2019,
  "safetySystems": {
    "esfrSprinklers": true,
    "centralStationAlarm": true
  },
  "lossHistory": []
}

*   Assess material risk factors.
*   Return two concise sentences.`,
  devops: `AWS ECS deployment reference

*   Cluster: production-us-east-1
*   Container port: 8080

\`\`\`json
{
  "networkMode": "awsvpc",
  "containerDefinitions": [{ "name": "web", "portMappings": [{ "containerPort": 8080 }] }]
}
\`\`\`

How should I configure this service?`,
  medical: `Clinical assessment record

{
  "vitals": { "bloodPressure": "128/84", "heartRateBpm": 74 },
  "medications": [
    { "name": "Lisinopril", "dosage": "10mg daily" },
    { "name": "Metformin", "dosage": "500mg twice daily" }
  ]
}

Summarize the current medication regimen.`,
  rag: `Retrieved customer context

*   Account status: Active
*   Verified KYC: true

[
  { "id": "TX-101", "amount": 142.50, "merchant": "Whole Foods" },
  { "id": "TX-103", "amount": 540.00, "merchant": "Delta Airlines" }
]

Did the airline ticket purchase go through?`
};

const input = document.getElementById('prompt-input');
const preset = document.getElementById('preset-select');
const provider = document.getElementById('provider-select');
const output = document.querySelector('#optimized-output code');
const rawBadge = document.getElementById('raw-token-badge');
const providerBadge = document.getElementById('provider-output-badge');
const copy = document.getElementById('btn-copy-optimized');
const testButton = document.getElementById('btn-run-live-test');
const testResult = document.getElementById('live-test-result');
const savings = document.getElementById('hero-savings');

function options() {
  return {
    preserveCodeBlocks: document.getElementById('toggle-code').checked,
    enableJsonMinification: document.getElementById('toggle-json').checked,
    markdownDeclutter: document.getElementById('toggle-markdown').checked
  };
}

function render() {
  const raw = input.value;
  const config = options();
  const optimized = compressText(raw, config);
  const rawTokens = estimateTokens(raw);
  const optimizedTokens = estimateTokens(optimized);
  const charsSaved = Math.max(0, raw.length - optimized.length);
  const tokensSaved = Math.max(0, rawTokens - optimizedTokens);
  const ratio = rawTokens ? (tokensSaved / rawTokens) * 100 : 0;
  const payload = optimizePayload([{ role: 'user', content: raw }], provider.value, config);

  output.textContent = JSON.stringify(payload, null, 2);
  rawBadge.textContent = `${rawTokens} TOK · ${raw.length} CH`;
  providerBadge.textContent = provider.value === 'vllm' ? 'VLLM FORMAT' : `${provider.value.toUpperCase()} FORMAT`;
  document.getElementById('stat-chars-saved').textContent = charsSaved.toLocaleString();
  document.getElementById('stat-tokens-saved').textContent = tokensSaved.toLocaleString();
  document.getElementById('stat-percent-saved').textContent = `${ratio.toFixed(1)}%`;
  document.getElementById('stat-cost-saved').textContent = `$${(tokensSaved * 0.075).toFixed(2)}`;
  savings.textContent = `${ratio.toFixed(1)}%`;
}

preset.addEventListener('change', () => { input.value = PRESETS[preset.value]; render(); });
[input, provider, document.getElementById('toggle-code'), document.getElementById('toggle-json'), document.getElementById('toggle-markdown')].forEach(element => element.addEventListener(element === input ? 'input' : 'change', render));

copy.addEventListener('click', async () => {
  await navigator.clipboard.writeText(output.textContent);
  copy.textContent = 'Copied';
  setTimeout(() => { copy.textContent = 'Copy'; }, 1200);
});

testButton.addEventListener('click', async () => {
  testButton.disabled = true;
  testButton.textContent = 'Running…';
  try {
    const result = await runLiveTest();
    testResult.textContent = `${result.passed ? '✓ PASSED' : '✕ FAILED'}\n${result.checks.map(check => `${check.passed ? '✓' : '✕'} ${check.name}`).join('\n')}`;
    testResult.classList.toggle('failed', !result.passed);
  } catch (error) {
    testResult.textContent = `✕ FAILED\n${error.message}`;
    testResult.classList.add('failed');
  } finally {
    testButton.disabled = false;
    testButton.innerHTML = 'Run smoke test <span>→</span>';
  }
});

input.value = PRESETS.underwriting;
render();
