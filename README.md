# Alloy.js ⚡
> **Enterprise-Grade Token Optimization, Context Compression & Prompt Caching Middleware for LLMs**

Alloy is a lightweight Node.js middleware library that sits between your enterprise application and LLM inference endpoints (**Google Gemini**, **OpenAI**, **Anthropic**, and self-hosted **vLLM** models).

By combining conservative text compression, embedded JSON minification, local response caching, and output budgeting, Alloy reduces avoidable prompt overhead while preserving message order. Measure savings against your provider’s usage data before making cost commitments.

---

## 🚀 Key Features

* **Node.js Runtime**: Pure ECMAScript with native Node.js crypto. The browser playground is a separate, credential-free demonstration build.
* **Conservative Context Compression**: Minifies embedded JSON and redundant prose spacing while preserving fenced blocks and leading indentation (including YAML).
* **Embedded JSON Minifier**: Detects and minifies JSON payloads embedded inside natural language prompts, stripping formatting padding and newlines.
* **KV-Cache-Friendly Prefixes**: Preserves message order. Place system instructions and invariant static context (`isStatic: true`) first to maximize provider-side prefix reuse.
* **True LRU Memory Cache**: Key-order-agnostic SHA-256 cache with sub-millisecond lookups, TTL expiration, and automatic eviction.
* **Multi-Provider Adapters**:
  * **Google Gemini**: Automatically maps `role: 'assistant'` $\rightarrow$ `'model'`, packages `{ role, parts: [{ text }] }`, and isolates `systemInstruction`.
  * **Anthropic Claude**: Automatically manages up to 4 ephemeral `cache_control: { type: 'ephemeral' }` breakpoints on static content.
  * **OpenAI / Generic**: Strict KV prefix sequencing and payload normalization.
  * **vLLM**: OpenAI-compatible payloads for self-hosted serving. Keep invariant context at the beginning of each request so vLLM Automatic Prefix Caching can reuse its KV blocks.
* **Token & Cost Telemetry**: Built-in token and cost estimates; replace the price catalog or use provider usage metadata for billing-grade numbers.
* **Full TypeScript Definitions**: Shipped with complete `alloy.d.ts` declarations.

---

## 📦 Installation

```bash
npm install alloy-sdk
```
*(Or use directly as local file `import { Alloy } from './alloy.js'`)*

---

## 🛠️ Quickstart

### 1. Standalone Optimization (`alloy.optimize`)
Use Alloy as a pure prompt optimizer without wrapping your API calls:

```javascript
import { Alloy } from './alloy.js';

const alloy = new Alloy({ defaultProvider: 'gemini' });

const { messages, systemInstruction, telemetry } = alloy.optimize([
  { role: 'system', content: 'You are a financial risk analyst.' },
  {
    role: 'user',
    content: `
      Company financial record:
      {
        "revenue": 5000000,
        "ebitda": 1200000,
        "liabilities": 450000
      }
      
      Summarize the risk profile.
    `
  }
]);

console.log(telemetry);
// {
//   rawChars: 242,
//   optimizedChars: 154,
//   rawTokens: 52,
//   optimizedTokens: 33,
//   savedTokens: 19,
//   reductionPercent: 36.54
// }
```

---

### 2. Execution Wrapper with Caching (`alloy.execute`)

Wrap any standard SDK call to get automatic caching, token reduction, and telemetry:

#### Google Gemini SDK Example
```javascript
import { GoogleGenAI } from '@google/genai';
import { Alloy } from './alloy.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const alloy = new Alloy({
  defaultProvider: 'gemini',
  defaultModel: 'gemini-2.5-flash',
  cacheTTLMs: 300000 // 5-minute memory cache
});

const response = await alloy.execute(
  async (payload) => {
    return await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: payload.contents,
      config: {
        systemInstruction: payload.systemInstruction,
        maxOutputTokens: payload.maxOutputTokens
      }
    });
  },
  {
    messages: [
      { role: 'system', content: 'You are an enterprise analyst.' },
      { role: 'user', content: 'Here is data: { "status": "active" }' }
    ]
  }
);

console.log('Response:', response.text);
console.log('Alloy Telemetry:', response._alloyMeta);
```

#### OpenAI SDK Example
```javascript
import OpenAI from 'openai';
import { Alloy } from './alloy.js';

const openai = new OpenAI();
const alloy = new Alloy({ defaultProvider: 'openai', defaultModel: 'gpt-4o' });

const response = await alloy.execute(
  async (payload) => {
    return await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: payload.messages,
      max_tokens: payload.max_tokens
    });
  },
  {
    messages: [
      { role: 'system', content: 'You are a code assistant.' },
      { role: 'user', isStatic: true, content: 'API Documentation: ...' },
      { role: 'user', content: 'How do I authenticate?' }
    ]
  }
);
```

#### vLLM OpenAI-Compatible Server

Alloy’s `vllm` provider uses the same message shape as OpenAI. It does not reorder conversation history; place your system and static RAG context first so vLLM can reuse the stable prefix.

```javascript
import OpenAI from 'openai';
import { Alloy } from 'alloy-sdk';

const vllm = new OpenAI({ baseURL: 'http://localhost:8000/v1', apiKey: 'local' });
const alloy = new Alloy({ defaultProvider: 'vllm', defaultModel: 'meta-llama/Llama-3.1-8B-Instruct' });

const response = await alloy.execute(
  payload => vllm.chat.completions.create(payload),
  {
    messages: [
      { role: 'system', content: 'You are a concise support assistant.' },
      { role: 'user', isStatic: true, content: 'Product reference: ...' },
      { role: 'user', content: 'How do I reset my password?' }
    ]
  },
  { provider: 'vllm', cacheable: true }
);
```

For high-throughput deployments, use Alloy’s local cache only for safe, non-streaming idempotent requests; vLLM’s server-side automatic prefix cache handles reusable prompt KV state.

---

## 📊 Benchmark & Cost Analysis

Tested against a representative enterprise insurance underwriting prompt containing multiline templates and structural JSON context:

| Pipeline Stage | Input Tokens | Tokens Saved | Single-Call Reduction | Billed Cost / 1M Calls |
|---|---|---|---|---|
| **Raw Unoptimized Baseline** | 284 Tokens | 0 Tokens | Baseline (0.00%) | $852.00 |
| **Alloy Whitespace Collapse** | 224 Tokens | 60 Tokens | **21.12% Savings** | $672.00 |
| **Alloy Full Stack (Trimming + JSON Minify)** | 158 Tokens | 126 Tokens | **44.37% Savings** | $474.00 |
| **Alloy Local Cache Hit (0ms latency)** | 0 Tokens | 284 Tokens | **100.00% Savings** | **$0.00** |

---

## ⚙️ Configuration Options

```javascript
new Alloy({
  // Memory Cache
  enableMemoryCache: true,      // Enable local in-memory LRU cache (default: true)
  maxCacheSize: 500,            // Maximum cached responses (default: 500)
  cacheTTLMs: 3600000,          // Cache expiration time in ms (default: 1 hour)

  // Providers & Models
  defaultProvider: 'gemini',    // 'gemini' | 'openai' | 'anthropic' | 'vllm' | 'generic'
  defaultModel: 'gemini-2.5-flash',
  defaultMaxTokens: 256,        // Output token budget cap

  // Optimization Rules
  preserveCodeBlocks: true,     // Preserve code block indentation (default: true)
  enableJsonMinification: true, // Minify embedded JSON objects (default: true)
  markdownDeclutter: true       // Strip decorative HRs and messy bullet spaces (default: true)
});
```

---

## 🧪 Testing

Run the native Node.js test suite:

```bash
npm test
```

Run the local benchmark (1,000 iterations; no API credentials required):

```bash
npm run benchmark
```

Run the live demonstration:

```bash
npm run example
```

---

## 📄 License
MIT
