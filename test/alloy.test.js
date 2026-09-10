import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Alloy,
  LRUCache,
  compressText,
  minifyJsonContext,
  canonicalJsonStringify,
  estimateTokens,
  optimizeMessages,
  formatForGemini,
  formatForAnthropic
} from '../alloy.js';

test('canonicalJsonStringify sorts object keys deterministically', () => {
  const objA = { z: 1, a: 2, m: { y: 10, b: 20 } };
  const objB = { a: 2, z: 1, m: { b: 20, y: 10 } };
  assert.equal(canonicalJsonStringify(objA), canonicalJsonStringify(objB));
  assert.equal(canonicalJsonStringify(objA), '{"a":2,"m":{"b":20,"y":10},"z":1}');
});

test('minifyJsonContext minifies JSON inside prose while handling strings with braces and escapes', () => {
  const input = `User note:
  {
    "name": "Acme Corp",
    "description": "Handles \\"special\\" {cases} nicely",
    "tags": [
      "alpha",
      "beta"
    ]
  }
  Please review.`;

  const minified = minifyJsonContext(input);
  assert.match(minified, /\{"name":"Acme Corp","description":"Handles \\"special\\" \{cases\} nicely","tags":\["alpha","beta"\]\}/);
  assert.ok(minified.includes('User note:'));
  assert.ok(minified.includes('Please review.'));
});

test('compressText restores code blocks without interpreting $ replacement patterns', () => {
  const input = [
    'Snippet:',
    '```bash',
    'echo $1',
    'price=$&',
    'cost=$$HOME',
    "tail=$'",
    '```',
    'Done.'
  ].join('\n');

  const compressed = compressText(input, { preserveCodeBlocks: true });

  assert.ok(compressed.includes('echo $1'));
  assert.ok(compressed.includes('price=$&'));
  assert.ok(compressed.includes('cost=$$HOME'));
  assert.ok(compressed.includes("tail=$'"));
  assert.ok(!compressed.includes('\u0000ALLOY_CODE_BLOCK_'));
});

test('compressText preserves code block indentation while collapsing prose whitespace', () => {
  const input = `
    Here is the instruction:

    \`\`\`python
    def calculate_risk(score):
        if score > 50:
            return "high"
        return "low"
    \`\`\`

    Please summarize this immediately.
  `;

  const compressed = compressText(input, { preserveCodeBlocks: true });

  // Prose should be trimmed/collapsed
  assert.ok(compressed.includes('Here is the instruction:'));
  assert.ok(compressed.includes('Please summarize this immediately.'));

  // Python code indentation inside ``` MUST be intact
  assert.ok(compressed.includes('    def calculate_risk(score):'));
  assert.ok(compressed.includes('        if score > 50:'));
});

test('compressText declutters markdown dividers and redundant bullet whitespace', () => {
  const input = `
    Item list:
    *    First item
    *    Second item
    
    ---------------------------------
    Summary note here.
  `;

  const compressed = compressText(input, { markdownDeclutter: true });
  assert.ok(compressed.includes('* First item'));
  assert.ok(compressed.includes('* Second item'));
  assert.ok(!compressed.includes('---------------------------------'));
});

test('estimateTokens calculates reasonable token values for strings and message objects', () => {
  const shortText = 'Hello world!';
  const tokens = estimateTokens(shortText);
  assert.ok(tokens >= 2 && tokens <= 4);

  const message = { role: 'user', content: 'What is the capital of France?' };
  const msgTokens = estimateTokens(message);
  assert.ok(msgTokens > tokens);
});

test('LRUCache stores, retrieves, refreshes LRU order, and respects TTL', async () => {
  const cache = new LRUCache({ maxSize: 2, ttlMs: 50 });

  cache.set('a', 'alpha');
  cache.set('b', 'beta');

  assert.equal(cache.get('a'), 'alpha'); // 'a' is accessed, so 'b' becomes oldest
  assert.equal(cache.get('b'), 'beta');  // 'b' is accessed, so 'a' becomes oldest

  // Add 'c' -> should evict 'a'
  cache.set('c', 'gamma');
  assert.equal(cache.get('a'), null);
  assert.equal(cache.get('b'), 'beta');
  assert.equal(cache.get('c'), 'gamma');

  const stats = cache.getStats();
  assert.equal(stats.evictions, 1);
  assert.equal(stats.hits, 4);

  // Test TTL expiration
  await new Promise(r => setTimeout(r, 60));
  assert.equal(cache.get('b'), null);
});

test('optimizeMessages preserves conversation order', () => {
  const messages = [
    { role: 'user', content: 'What is the status?' },
    { role: 'user', isStatic: true, content: 'Documentation context: Server is active.' },
    { role: 'system', content: 'You are an ops engineer.' }
  ];

  const result = optimizeMessages(messages, { provider: 'openai' });
  assert.equal(result.messages.length, 3);
  assert.equal(result.messages[0].content, 'What is the status?');
  assert.ok(result.messages[1].content.includes('Documentation context'));
  assert.equal(result.messages[2].role, 'system');
  // Internal flags should be stripped for openai
  assert.equal(result.messages[1].isStatic, undefined);
});

test('optimizeMessages formats correctly for Gemini (assistant -> model, parts format, systemInstruction)', () => {
  const messages = [
    { role: 'system', content: 'You are a financial analyst.' },
    { role: 'user', content: 'Here is the portfolio: { "equity": 5000 }' },
    { role: 'assistant', content: 'Loaded equity.' },
    { role: 'user', content: 'Assess the risk.' }
  ];

  const result = optimizeMessages(messages, { provider: 'gemini' });

  // System message extracted to systemInstruction
  assert.equal(result.systemInstruction, 'You are a financial analyst.');

  // System should not be in contents
  assert.equal(result.messages.length, 3);
  assert.equal(result.messages[0].role, 'user');
  assert.equal(result.messages[0].parts[0].text, 'Here is the portfolio: {"equity":5000}');

  // 'assistant' should be mapped to 'model'
  assert.equal(result.messages[1].role, 'model');
  assert.equal(result.messages[1].parts[0].text, 'Loaded equity.');

  assert.equal(result.messages[2].role, 'user');
  assert.equal(result.messages[2].parts[0].text, 'Assess the risk.');
});

test('optimizeMessages formats correctly for Anthropic (cache_control breakpoints)', () => {
  const messages = [
    { role: 'system', content: 'System instruction block.' },
    { role: 'user', isStatic: true, content: 'Heavy static context.' },
    { role: 'user', content: 'Dynamic question.' }
  ];

  const result = optimizeMessages(messages, { provider: 'anthropic' });

  assert.deepEqual(result.systemInstruction, [{
    type: 'text',
    text: 'System instruction block.',
    cache_control: { type: 'ephemeral' }
  }]);
  assert.equal(result.messages.length, 2);

  // Static user message should have cache_control ephemeral
  const staticMsg = result.messages[0];
  assert.equal(staticMsg.content[0].type, 'text');
  assert.equal(staticMsg.content[0].text, 'Heavy static context.');
  assert.deepEqual(staticMsg.content[0].cache_control, { type: 'ephemeral' });

  // Dynamic user message should NOT have cache_control
  const dynamicMsg = result.messages[1];
  assert.equal(typeof dynamicMsg.content, 'string');
});

test('canonical cache keys distinguish Dates and reject non-JSON values', () => {
  const alloy = new Alloy();
  const early = alloy.generateCacheKey({ at: new Date('2025-01-01T00:00:00Z') }, 'openai');
  const late = alloy.generateCacheKey({ at: new Date('2026-01-01T00:00:00Z') }, 'openai');
  assert.notEqual(early, late);
  assert.throws(() => alloy.generateCacheKey({ value: new Map() }, 'openai'), TypeError);
});

test('compressText preserves meaningful YAML indentation', () => {
  const yaml = 'parent:\n  child: value\n    grandchild: value';
  assert.equal(compressText(yaml), yaml);
});

test('Alloy coalesces identical concurrent cacheable calls and bypasses streams', async () => {
  const alloy = new Alloy();
  let calls = 0;
  const api = async () => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 10));
    return { text: 'ok' };
  };

  const payload = { messages: [{ role: 'user', content: 'same request' }] };
  const [first, second] = await Promise.all([alloy.execute(api, payload), alloy.execute(api, payload)]);
  assert.equal(calls, 1);
  assert.equal(first._alloyMeta.cacheHit, false);
  assert.equal(second._alloyMeta.coalesced, true);

  await alloy.execute(api, { ...payload, stream: true });
  await alloy.execute(api, { ...payload, stream: true });
  assert.equal(calls, 3);
});

test('Alloy.optimize provides full telemetry without API execution', () => {
  const alloy = new Alloy({ defaultProvider: 'openai' });
  const rawMessages = [
    {
      role: 'user',
      content: `
        Details:
        {
          "account": "12345",
          "tier": "enterprise",
          "active": true
        }
        
        Please process this.
      `
    }
  ];

  const { messages, telemetry } = alloy.optimize(rawMessages);
  assert.ok(telemetry.rawChars > telemetry.optimizedChars);
  assert.ok(telemetry.rawTokens > telemetry.optimizedTokens);
  assert.ok(telemetry.savedTokens > 0);
  assert.ok(telemetry.reductionPercent > 0);
  assert.ok(messages[0].content.includes('{"account":"12345","tier":"enterprise","active":true}'));
});

test('Alloy.execute handles execution, caching, output budgeting, and telemetry', async () => {
  const alloy = new Alloy({
    defaultProvider: 'gemini',
    defaultModel: 'gemini-2.5-flash',
    cacheTTLMs: 10000
  });

  let callCount = 0;
  const mockApiCall = async (payload) => {
    callCount++;
    return {
      text: `Generated response for model ${payload.model}`,
      usage: { promptTokens: 42, completionTokens: 15 }
    };
  };

  const payload = {
    model: 'gemini-2.5-flash',
    messages: [
      { role: 'system', content: 'You are a helper.' },
      {
        role: 'user',
        content: `
          Configuration:
          {
            "env": "production",
            "retries": 3
          }
        `
      }
    ]
  };

  // First call (cache miss)
  const res1 = await alloy.execute(mockApiCall, payload);
  assert.equal(callCount, 1);
  assert.equal(res1._alloyMeta.cacheHit, false);
  assert.ok(res1._alloyMeta.savedTokens > 0);
  assert.equal(res1._alloyMeta.model, 'gemini-2.5-flash');

  // Second call with same payload (cache hit)
  const res2 = await alloy.execute(mockApiCall, payload);
  assert.equal(callCount, 1); // Mock was NOT called again
  assert.equal(res2._alloyMeta.cacheHit, true);
  assert.equal(res2._alloyMeta.reductionPercent, 100.0);
  assert.equal(res2.text, res1.text);

  // Verify cumulative statistics
  const stats = alloy.getStats();
  assert.equal(stats.cumulative.totalRequests, 2);
  assert.ok(stats.cumulative.totalTokensSaved > 0);
  assert.equal(stats.cache.hits, 1);
  assert.equal(stats.cache.misses, 1);
});
