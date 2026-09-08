import { performance } from 'node:perf_hooks';
import { Alloy, compressText, estimateTokens } from './alloy.js';

const ITERATIONS = 1_000;
const prompt = `
  Deployment request:

  ---
  {
    "service": "payments",
    "replicas": 3,
    "limits": {
      "cpu": "2",
      "memory": "4Gi"
    }
  }

  *   Keep the response concise.
`;

const options = { preserveCodeBlocks: true, enableJsonMinification: true, markdownDeclutter: true };
const alloy = new Alloy({ defaultProvider: 'openai' });
const messages = [{ role: 'system', content: 'You are a release assistant.' }, { role: 'user', content: prompt }];

function measure(label, fn) {
  const start = performance.now();
  let value;
  for (let index = 0; index < ITERATIONS; index++) value = fn();
  const elapsedMs = performance.now() - start;
  return { label, elapsedMs, opsPerSecond: Math.round((ITERATIONS / elapsedMs) * 1_000), value };
}

const compressed = compressText(prompt, options);
const compression = measure('compressText', () => compressText(prompt, options));
const optimization = measure('alloy.optimize', () => alloy.optimize(messages));

console.table([
  { operation: compression.label, iterations: ITERATIONS, ms: compression.elapsedMs.toFixed(2), opsPerSecond: compression.opsPerSecond },
  { operation: optimization.label, iterations: ITERATIONS, ms: optimization.elapsedMs.toFixed(2), opsPerSecond: optimization.opsPerSecond }
]);
console.table([{
  rawChars: prompt.length,
  optimizedChars: compressed.length,
  rawTokenEstimate: estimateTokens(prompt),
  optimizedTokenEstimate: estimateTokens(compressed),
  tokenEstimateSaved: Math.max(0, estimateTokens(prompt) - estimateTokens(compressed))
}]);
