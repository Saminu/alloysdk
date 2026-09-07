/**
 * @file example.js
 * Comprehensive demonstration of Alloy token optimization, KV prefix alignment, and caching.
 */

import { Alloy } from './alloy.js';

async function main() {
  console.log('='.repeat(70));
  console.log(' ALLOY SDK DEMO: Token Optimization & Prompt Caching');
  console.log('='.repeat(70));

  const alloy = new Alloy({
    defaultProvider: 'gemini',
    defaultModel: 'gemini-2.5-flash',
    cacheTTLMs: 60000 // 1-minute cache
  });

  // 1. Raw unoptimized payload with whitespace, embedded JSON, and system instructions
  const rawPayload = [
    {
      role: 'system',
      content: `
        You are an enterprise AI underwriting analyst for commercial properties.
        Summarize key risk variables and calculate overall rating.
      `
    },
    {
      role: 'user',
      isStatic: true,
      content: `
        ### Property Underwriting Guidelines
        ------------------------------------
        *   Standard deductible: $5,000
        *   Maximum liability limit: $2,000,000
        ------------------------------------
      `
    },
    {
      role: 'user',
      content: `
        Client inspection notes:
        {
          "facility": "Oakridge Logistics Warehouse",
          "sqft": 125000,
          "yearBuilt": 2018,
          "fireSuppression": {
            "sprinklers": true,
            "certified": true,
            "inspectedYear": 2024
          },
          "claimsHistory": []
        }

        Please analyze this risk.
      `
    }
  ];

  console.log('\n[1] PURE OPTIMIZATION INSPECTION (alloy.optimize)');
  console.log('-'.repeat(50));
  const optimized = alloy.optimize(rawPayload, { provider: 'gemini' });

  console.log('System Instruction Extracted:\n ', optimized.systemInstruction);
  console.log('\nOptimized Gemini Messages Count:', optimized.messages.length);
  console.log('First Message Role:', optimized.messages[0].role);
  console.log('First Message Preview:', optimized.messages[0].parts[0].text);
  console.log('\nTelemetry Report:');
  console.table(optimized.telemetry);

  // 2. SIMULATED SDK EXECUTION (Cache Miss vs Cache Hit)
  console.log('\n[2] EXECUTION WORKFLOW & CACHE DEMO (alloy.execute)');
  console.log('-'.repeat(50));

  const mockLLMBackend = async (payload) => {
    // Simulate 350ms network roundtrip to Gemini API
    await new Promise(r => setTimeout(r, 150));
    return {
      text: 'Analysis: The property is low risk due to recent build (2018) and certified fire suppression.',
      candidates: [{ finishReason: 'STOP' }]
    };
  };

  console.log('Dispatching First Request (Cache Miss expected)...');
  const response1 = await alloy.execute(mockLLMBackend, {
    model: 'gemini-2.5-flash',
    messages: rawPayload
  });

  console.log(' Response text:', response1.text);
  console.log(' Telemetry:', {
    cacheHit: response1._alloyMeta.cacheHit,
    executionTimeMs: `${response1._alloyMeta.executionTimeMs}ms`,
    savedTokens: response1._alloyMeta.savedTokens,
    reductionPercent: `${response1._alloyMeta.reductionPercent}%`,
    costSavedUSD: `$${response1._alloyMeta.costSavedUSD}`
  });

  console.log('\nDispatching Identical Request (Instant Cache Hit expected)...');
  const response2 = await alloy.execute(mockLLMBackend, {
    model: 'gemini-2.5-flash',
    messages: rawPayload
  });

  console.log(' Response text:', response2.text);
  console.log(' Telemetry:', {
    cacheHit: response2._alloyMeta.cacheHit,
    executionTimeMs: `${response2._alloyMeta.executionTimeMs}ms (Instant)`,
    savedTokens: response2._alloyMeta.savedTokens,
    reductionPercent: `${response2._alloyMeta.reductionPercent}%`,
    costSavedUSD: `$${response2._alloyMeta.costSavedUSD}`
  });

  console.log('\n[3] CUMULATIVE ALLOY STATS');
  console.log('-'.repeat(50));
  console.log(JSON.stringify(alloy.getStats(), null, 2));
  console.log('='.repeat(70));
}

main().catch(console.error);
