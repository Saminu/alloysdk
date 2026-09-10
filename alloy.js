/**
 * @file alloy.js
 * @description Enterprise-grade LLM Token Optimization, Context Compression, and Prompt Caching Middleware.
 * Runs in Node.js and compatible runtimes that provide the Node crypto module.
 */

import crypto from 'node:crypto';

/**
 * Model pricing catalog per 1M tokens (USD).
 */
export const MODEL_PRICING = {
  'gemini-2.5-flash': { inputPer1M: 0.075, outputPer1M: 0.30, cachedInputPer1M: 0.01875 },
  'gemini-1.5-pro': { inputPer1M: 1.25, outputPer1M: 5.00, cachedInputPer1M: 0.3125 },
  'gpt-4o': { inputPer1M: 2.50, outputPer1M: 10.00, cachedInputPer1M: 1.25 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.60, cachedInputPer1M: 0.075 },
  'claude-3-5-sonnet': { inputPer1M: 3.00, outputPer1M: 15.00, cachedInputPer1M: 0.30 },
  'claude-3-5-haiku': { inputPer1M: 0.80, outputPer1M: 4.00, cachedInputPer1M: 0.08 },
  'default': { inputPer1M: 1.00, outputPer1M: 3.00, cachedInputPer1M: 0.25 }
};

/**
 * Deterministically serialize any JavaScript object or primitive with sorted keys.
 * Ensures consistent hashing regardless of property insertion order.
 * @param {any} value
 * @returns {string}
 */
export function canonicalJsonStringify(value, seen = new Set()) {
  if (value === null || typeof value !== 'object') {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new TypeError('Cache keys support JSON values only.');
    }
    return serialized;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new TypeError('Cannot cache an invalid Date.');
    return JSON.stringify(value.toJSON());
  }
  if (seen.has(value)) throw new TypeError('Cannot cache circular payloads.');
  if (!Array.isArray(value) && (value instanceof Map || value instanceof Set || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null))) {
    throw new TypeError('Cache keys support plain JSON objects only.');
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return '[' + value.map(item => canonicalJsonStringify(item, seen)).join(',') + ']';
    }

    const sortedKeys = Object.keys(value).sort();
    const pairs = sortedKeys.map(k => JSON.stringify(k) + ':' + canonicalJsonStringify(value[k], seen));
    return '{' + pairs.join(',') + '}';
  } finally {
    seen.delete(value);
  }
}

/**
 * Robust, balanced-delimiter parser to find and minify JSON snippets embedded within unstructured text.
 * Preserves non-JSON text and string escaping.
 * @param {string} text
 * @returns {string}
 */
export function minifyJsonContext(text) {
  if (!text || typeof text !== 'string') return text;

  let result = '';
  let i = 0;

  while (i < text.length) {
    const char = text[i];
    if (char === '{' || char === '[') {
      const start = i;
      let depth = 0;
      let inString = false;
      let escape = false;
      let end = -1;

      for (let j = i; j < text.length; j++) {
        const c = text[j];

        if (escape) {
          escape = false;
          continue;
        }

        if (c === '\\' && inString) {
          escape = true;
          continue;
        }

        if (c === '"') {
          inString = !inString;
          continue;
        }

        if (!inString) {
          if (c === '{' || c === '[') {
            depth++;
          } else if (c === '}' || c === ']') {
            depth--;
          }

          if (depth === 0) {
            end = j;
            break;
          }
        }
      }

      if (end !== -1) {
        const candidate = text.slice(start, end + 1);
        try {
          const parsed = JSON.parse(candidate);
          // Only minify if it parsed successfully and has structured properties
          if (typeof parsed === 'object' && parsed !== null) {
            result += JSON.stringify(parsed);
            i = end + 1;
            continue;
          }
        } catch {
          // Not valid JSON; fall back to normal character copying
        }
      }
    }

    result += char;
    i++;
  }

  return result;
}

/**
 * Text compressor that safely strips redundant whitespace, normalizes formatting,
 * and preserves code blocks (e.g. ```code```) to prevent breaking code/YAML indentation.
 * @param {string} text
 * @param {Object} [options={}]
 * @param {boolean} [options.preserveCodeBlocks=true]
 * @param {boolean} [options.enableJsonMinification=true]
 * @param {boolean} [options.markdownDeclutter=true]
 * @returns {string}
 */
export function compressText(text, options = {}) {
  if (!text || typeof text !== 'string') return text;

  const {
    preserveCodeBlocks = true,
    enableJsonMinification = true,
    markdownDeclutter = true
  } = options;

  // 1. Separate fenced code blocks if preservation is enabled
  const codeBlocks = [];
  let processed = text;

  if (preserveCodeBlocks) {
    // Matches ```lang ... ``` or ~~~lang ... ~~~
    processed = processed.replace(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g, (match) => {
      const token = `\u0000ALLOY_CODE_BLOCK_${codeBlocks.length}\u0000`;
      codeBlocks.push(match);
      return token;
    });
  }

  // 2. Minify embedded JSON
  if (enableJsonMinification) {
    processed = minifyJsonContext(processed);
  }

  // 3. Normalize newlines
  processed = processed.replace(/\r\n/g, '\n');

  // 4. Markdown decluttering
  if (markdownDeclutter) {
    // Remove decorative horizontal dividers (e.g. ---, ***, === of 3 or more chars)
    processed = processed.replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, '');
    // Normalize bullet point whitespace: "*   item" -> "* item", "-   item" -> "- item"
    processed = processed.replace(/^([ \t]*[-*+])[ \t]{2,}/gm, '$1 ');
  }

  // 5. Line-by-line whitespace optimization
  processed = processed
    .split('\n')
    .map(line => {
      // If the line is a code block placeholder, leave it untouched
      if (line.includes('\u0000ALLOY_CODE_BLOCK_')) return line;
      // Preserve leading indentation: it may be meaningful in YAML or indented code.
      const leadingWhitespace = line.match(/^[ \t]*/)[0];
      return leadingWhitespace + line.slice(leadingWhitespace.length).replace(/[ \t]{2,}/g, ' ').trimEnd();
    })
    .join('\n');

  // 6. Enforce at most 2 consecutive newlines (one empty line)
  processed = processed.replace(/\n{3,}/g, '\n\n').trim();

  // 7. Restore preserved code blocks.
  // Use a function replacer so `$`, `$&`, `$1`, and `$$` in source code are copied literally.
  if (preserveCodeBlocks && codeBlocks.length > 0) {
    for (let i = 0; i < codeBlocks.length; i++) {
      const block = codeBlocks[i];
      processed = processed.replace(`\u0000ALLOY_CODE_BLOCK_${i}\u0000`, () => block);
    }
  }

  return processed;
}

/**
 * Estimates token count for a string or message array.
 * Uses calibrated subword heuristics (~3.8 chars/token for prose, ~2.8 for JSON/code).
 * @param {string|Array|Object} input
 * @returns {number}
 */
export function estimateTokens(input) {
  if (!input) return 0;

  if (typeof input === 'object') {
    if (Array.isArray(input)) {
      return input.reduce((sum, item) => sum + estimateTokens(item), 0);
    }
    if (input.content) {
      return estimateTokens(input.content) + 4; // role + overhead
    }
    if (input.parts && Array.isArray(input.parts)) {
      return input.parts.reduce((sum, p) => sum + estimateTokens(p.text || p), 0) + 4;
    }
    input = JSON.stringify(input);
  }

  if (typeof input !== 'string') return 0;
  if (input.length === 0) return 0;

  // Count words, symbols, numbers, and whitespace segments
  const words = input.trim().split(/\s+/).length;
  const chars = input.length;
  // Blend char-based and word-based subword heuristics
  const charEstimate = chars / 3.7;
  const wordEstimate = words * 1.25;

  return Math.max(1, Math.round((charEstimate * 0.7) + (wordEstimate * 0.3)));
}

/**
 * Least Recently Used (LRU) Memory Cache with individual TTL and access repositioning.
 */
export class LRUCache {
  /**
   * @param {Object} [options={}]
   * @param {number} [options.maxSize=500]
   * @param {number} [options.ttlMs=3600000]
   */
  constructor(options = {}) {
    this.maxSize = options.maxSize ?? 500;
    this.ttlMs = options.ttlMs ?? 60 * 60 * 1000;
    if (!Number.isInteger(this.maxSize) || this.maxSize < 1) {
      throw new RangeError('maxSize must be a positive integer.');
    }
    if (!Number.isFinite(this.ttlMs) || this.ttlMs < 0) {
      throw new RangeError('ttlMs must be a non-negative number.');
    }
    /** @type {Map<string, { data: any, expiresAt: number, size?: number }>} */
    this.cache = new Map();

    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      sets: 0
    };
  }

  /**
   * Get an entry from cache, refreshing its LRU position.
   * @param {string} key
   * @returns {any|null}
   */
  get(key) {
    if (!this.cache.has(key)) {
      this.stats.misses++;
      return null;
    }

    const entry = this.cache.get(key);

    if (Date.now() >= entry.expiresAt) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }

    // Refresh LRU order: delete and re-insert
    this.cache.delete(key);
    this.cache.set(key, entry);

    this.stats.hits++;
    return entry.data;
  }

  /**
   * Store an entry in cache with LRU eviction.
   * @param {string} key
   * @param {any} data
   * @param {number} [customTTL]
   */
  set(key, data, customTTL) {
    const ttl = customTTL !== undefined ? customTTL : this.ttlMs;

    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict oldest (first key in map iterator)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
        this.stats.evictions++;
      }
    }

    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttl
    });
    this.stats.sets++;
  }

  /**
   * Check if a valid, non-expired key exists.
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    if (!this.cache.has(key)) return false;
    const entry = this.cache.get(key);
    if (Date.now() >= entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Delete an entry.
   * @param {string} key
   * @returns {boolean}
   */
  delete(key) {
    return this.cache.delete(key);
  }

  /**
   * Clear entire cache.
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Remove expired entries.
   * @returns {number} number of expired items pruned
   */
  prune() {
    const now = Date.now();
    let pruned = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (now >= entry.expiresAt) {
        this.cache.delete(key);
        pruned++;
      }
    }
    return pruned;
  }

  /**
   * Cache telemetry statistics.
   */
  getStats() {
    const totalLookups = this.stats.hits + this.stats.misses;
    const hitRate = totalLookups > 0 ? (this.stats.hits / totalLookups) : 0;
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.stats.hits,
      misses: this.stats.misses,
      evictions: this.stats.evictions,
      hitRate: Number(hitRate.toFixed(4))
    };
  }
}

/**
 * Optimizes prompt messages for KV-prefix caching and provider-specific schemas.
 * @param {Array<Object>} messages
 * @param {Object} [options={}]
 * @param {'openai'|'anthropic'|'gemini'|'vllm'|'generic'} [options.provider='openai']
 * @param {boolean} [options.preserveCodeBlocks=true]
 * @param {boolean} [options.enableJsonMinification=true]
 * @param {boolean} [options.markdownDeclutter=true]
 * @returns {{ messages: Array<Object>, systemInstruction?: string|Object }}
 */
export function optimizeMessages(messages = [], options = {}) {
  const provider = options.provider || 'openai';

  // 1. Clean message content
  const cleaned = messages.map(msg => {
    let newContent = msg.content;

    if (typeof msg.content === 'string') {
      newContent = compressText(msg.content, options);
    } else if (Array.isArray(msg.content)) {
      // Multimodal / structured content blocks
      newContent = msg.content.map(part => {
        if (typeof part === 'string') {
          return compressText(part, options);
        }
        if (part && typeof part === 'object' && part.text) {
          return { ...part, text: compressText(part.text, options) };
        }
        return part;
      });
    } else if (msg.parts && Array.isArray(msg.parts)) {
      // Gemini parts format
      const newParts = msg.parts.map(part => {
        if (typeof part === 'string') {
          return { text: compressText(part, options) };
        }
        if (part && typeof part === 'object' && part.text) {
          return { ...part, text: compressText(part.text, options) };
        }
        return part;
      });
      return { ...msg, parts: newParts };
    }

    return {
      ...msg,
      content: newContent
    };
  });

  // Never reorder conversational turns: changing their order changes their meaning.
  // Put static context immediately after system messages when constructing the prompt
  // to obtain a stable provider-side prefix.
  const sorted = cleaned;

  // 3. Provider-specific transformations
  if (provider === 'gemini') {
    return formatForGemini(sorted);
  }

  if (provider === 'anthropic') {
    return formatForAnthropic(sorted);
  }

  // Default / OpenAI formatting
  const standardMessages = sorted.map(({ isStatic, cache, ...rest }) => rest);
  return { messages: standardMessages };
}

/**
 * Formats messages for Google Gemini SDK (@google/genai or @google/generative-ai).
 * - Converts role 'assistant' -> 'model'.
 * - Extracts system messages into `systemInstruction`.
 * - Formats contents as `{ role: 'user'|'model', parts: [{ text }] }`.
 * @param {Array<Object>} sortedMessages
 * @returns {{ messages: Array<Object>, systemInstruction?: string }}
 */
export function formatForGemini(sortedMessages) {
  const systemMessages = sortedMessages.filter(m => m.role === 'system');
  const nonSystemMessages = sortedMessages.filter(m => m.role !== 'system');

  let systemInstruction;
  if (systemMessages.length > 0) {
    systemInstruction = systemMessages
      .map(m => {
        if (typeof m.content === 'string') return m.content;
        if (m.parts && Array.isArray(m.parts)) {
          return m.parts.map(p => p.text || '').join('\n');
        }
        return JSON.stringify(m.content);
      })
      .join('\n\n');
  }

  const geminiContents = nonSystemMessages.map(msg => {
    let role = msg.role;
    if (role === 'assistant') role = 'model';
    if (role !== 'user' && role !== 'model') {
      throw new TypeError(`Gemini does not support the '${msg.role}' role in this adapter.`);
    }

    let parts = [];
    if (msg.parts && Array.isArray(msg.parts)) {
      parts = msg.parts;
    } else if (typeof msg.content === 'string') {
      parts = [{ text: msg.content }];
    } else if (Array.isArray(msg.content)) {
      parts = msg.content.map(c => {
        if (typeof c === 'string') return { text: c };
        if (c.text) return { ...c, text: c.text };
        return c;
      });
    } else if (msg.content) {
      parts = [{ text: JSON.stringify(msg.content) }];
    }

    return {
      role,
      parts
    };
  });

  return {
    messages: geminiContents,
    systemInstruction
  };
}

/**
 * Formats messages for Anthropic Claude SDK with ephemeral prompt caching.
 * - Supports up to 4 cache breakpoints on static or system messages.
 * - Separates system prompt.
 * @param {Array<Object>} sortedMessages
 * @param {number} [maxBreakpoints=4]
 * @returns {{ messages: Array<Object>, systemInstruction?: string }}
 */
export function formatForAnthropic(sortedMessages, maxBreakpoints = 4) {
  const systemMessages = sortedMessages.filter(m => m.role === 'system');
  const nonSystemMessages = sortedMessages.filter(m => m.role !== 'system');

  let breakpointsUsed = 0;
  let systemInstruction;
  if (systemMessages.length > 0) {
    const systemBlocks = systemMessages.map(m => ({
      type: 'text',
      text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    }));
    // Anthropic applies a cache breakpoint to a content block; use one on the
    // final system block, which is the stable prefix users most often reuse.
    systemBlocks[systemBlocks.length - 1].cache_control = { type: 'ephemeral' };
    systemInstruction = systemBlocks;
    breakpointsUsed++;
  }

  const anthropicMessages = nonSystemMessages.map(msg => {
    const shouldCache = (msg.cache === true || msg.isStatic === true) && breakpointsUsed < maxBreakpoints;
    const { isStatic, cache, ...cleanMsg } = msg;

    if (!shouldCache) return cleanMsg;

    breakpointsUsed++;

    let contentBlocks = [];
    if (typeof cleanMsg.content === 'string') {
      contentBlocks = [{ type: 'text', text: cleanMsg.content }];
    } else if (Array.isArray(cleanMsg.content)) {
      contentBlocks = [...cleanMsg.content];
    } else {
      return cleanMsg;
    }

    const lastIdx = contentBlocks.length - 1;
    contentBlocks[lastIdx] = {
      ...contentBlocks[lastIdx],
      cache_control: { type: 'ephemeral' }
    };

    return {
      ...cleanMsg,
      content: contentBlocks
    };
  });

  return {
    messages: anthropicMessages,
    systemInstruction
  };
}

/**
 * Main Alloy SDK Class
 */
export class Alloy {
  /**
   * @param {Object} [options={}]
   * @param {number} [options.maxCacheSize=500] - Max cache entries.
   * @param {number} [options.cacheTTLMs=3600000] - Cache TTL in ms (default: 1 hr).
   * @param {boolean} [options.enableMemoryCache=true] - Enable local LRU cache.
 * @param {'openai'|'anthropic'|'gemini'|'vllm'|'generic'} [options.defaultProvider='openai']
   * @param {string} [options.defaultModel='gemini-2.5-flash'] - Target model name for pricing telemetry.
   * @param {boolean} [options.enableJsonMinification=true] - Minify embedded JSON.
   * @param {boolean} [options.preserveCodeBlocks=true] - Preserve code block indentation.
   * @param {boolean} [options.markdownDeclutter=true] - Strip redundant markdown dividers/markers.
   * @param {number} [options.defaultMaxTokens=256] - Default output token cap.
   * @param {Object} [options.pricing] - Custom pricing override { inputPer1M, outputPer1M, cachedInputPer1M }.
   */
  constructor(options = {}) {
    this.enableMemoryCache = options.enableMemoryCache !== false;
    this.defaultProvider = options.defaultProvider ?? 'openai';
    this.defaultModel = options.defaultModel ?? 'gemini-2.5-flash';
    this.defaultMaxTokens = options.defaultMaxTokens ?? 256;
    if (!Number.isInteger(this.defaultMaxTokens) || this.defaultMaxTokens < 1) {
      throw new RangeError('defaultMaxTokens must be a positive integer.');
    }
    this.preserveCodeBlocks = options.preserveCodeBlocks !== false;
    this.enableJsonMinification = options.enableJsonMinification !== false;
    this.markdownDeclutter = options.markdownDeclutter !== false;
    this.pricingOverride = options.pricing;

    this.cache = new LRUCache({
      maxSize: options.maxCacheSize ?? 500,
      ttlMs: options.cacheTTLMs ?? 60 * 60 * 1000
    });
    this.inFlight = new Map();

    // Cumulative stats
    this.cumulativeStats = {
      totalRequests: 0,
      totalTokensSaved: 0,
      totalCostSavedUSD: 0
    };
  }

  /**
   * Generate a deterministic SHA-256 hash for caching.
   * @param {any} payload
   * @param {string} provider
   * @returns {string}
   */
  generateCacheKey(payload, provider) {
    const canonical = canonicalJsonStringify({ provider, payload });
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  /**
   * Look up pricing for a model.
   * @param {string} [modelName]
   * @returns {{ inputPer1M: number, outputPer1M: number, cachedInputPer1M: number }}
   */
  getPricing(modelName) {
    if (this.pricingOverride) return this.pricingOverride;
    const key = modelName || this.defaultModel;
    return MODEL_PRICING[key] || MODEL_PRICING['default'];
  }

  /**
   * Pure optimization function: optimizes messages and returns metadata without executing an API call.
   * Useful when integrating into custom pipelines, LangChain, or agentic frameworks.
   * @param {Array<Object>|Object} payloadOrMessages
   * @param {Object} [options={}]
   * @returns {{
   *   messages: Array<Object>,
   *   systemInstruction?: string|Object,
   *   telemetry: {
   *     rawChars: number,
   *     optimizedChars: number,
   *     rawTokens: number,
   *     optimizedTokens: number,
   *     savedTokens: number,
   *     reductionPercent: number
   *   }
   * }}
   */
  optimize(payloadOrMessages, options = {}) {
    const provider = options.provider || this.defaultProvider;
    const rawMessages = Array.isArray(payloadOrMessages)
      ? payloadOrMessages
      : (payloadOrMessages.messages || payloadOrMessages.contents || []);

    const rawChars = JSON.stringify(rawMessages).length;
    const rawTokens = estimateTokens(rawMessages);

    const optimizationOptions = {
      provider,
      preserveCodeBlocks: options.preserveCodeBlocks ?? this.preserveCodeBlocks,
      enableJsonMinification: options.enableJsonMinification ?? this.enableJsonMinification,
      markdownDeclutter: options.markdownDeclutter ?? this.markdownDeclutter
    };

    const { messages, systemInstruction } = optimizeMessages(rawMessages, optimizationOptions);

    const optimizedChars = JSON.stringify(messages).length + (systemInstruction ? JSON.stringify(systemInstruction).length : 0);
    const optimizedTokens = estimateTokens(messages) + (systemInstruction ? estimateTokens(systemInstruction) : 0);
    const savedTokens = Math.max(0, rawTokens - optimizedTokens);
    const reductionPercent = rawTokens > 0 ? Number(((savedTokens / rawTokens) * 100).toFixed(2)) : 0;

    return {
      messages,
      systemInstruction,
      telemetry: {
        rawChars,
        optimizedChars,
        rawTokens,
        optimizedTokens,
        savedTokens,
        reductionPercent
      }
    };
  }

  /**
   * Executes an LLM API call with token optimization, caching, output budgeting, and telemetry.
   * @template T
   * @param {(payload: Object) => Promise<T>} apiCallFn - Function executing the API call.
   * @param {Object} payload - Input payload ({ messages, contents, ... }).
   * @param {Object} [options={}]
   * @param {'openai'|'anthropic'|'gemini'|'vllm'|'generic'} [options.provider]
   * @param {string} [options.model]
   * @param {number} [options.maxTokens]
   * @param {boolean} [options.skipCache=false]
   * @param {number} [options.cacheTTLMs]
   * @returns {Promise<T & { _alloyMeta: Object }>}
   */
  async execute(apiCallFn, payload, options = {}) {
    const startTime = performance.now();
    const provider = options.provider || this.defaultProvider;
    const model = options.model || payload.model || this.defaultModel;
    const pricing = this.getPricing(model);

    // 1. Optimize payload
    const { messages, systemInstruction, telemetry } = this.optimize(payload, {
      ...options,
      provider
    });

    const maxTokens = options.maxTokens ?? payload.max_tokens ?? payload.maxOutputTokens ?? this.defaultMaxTokens;
    if (!Number.isInteger(maxTokens) || maxTokens < 1) {
      throw new RangeError('maxTokens must be a positive integer.');
    }

    // Construct final payload according to provider
    const finalPayload = {
      ...payload,
      messages,
      max_tokens: maxTokens
    };

    if (systemInstruction !== undefined) {
      finalPayload.systemInstruction = systemInstruction;
    }

    if (provider === 'gemini') {
      finalPayload.contents = messages;
      finalPayload.maxOutputTokens = maxTokens;
    }

    this.cumulativeStats.totalRequests++;

    // 2. Cache Check. Streams and tool/function calls are not safe to replay.
    const cacheAllowed = this.enableMemoryCache && !options.skipCache && options.cacheable !== false
      && !payload.stream && !payload.tools && !payload.functions;
    let cacheKey = null;
    if (cacheAllowed) {
      try {
        cacheKey = this.generateCacheKey(finalPayload, provider);
      } catch {
        // Non-JSON payloads are still valid for a provider, but must not be cached.
      }
    }
    if (cacheKey) {
      const cached = this.cache.get(cacheKey);
      if (cached !== null) {
        const executionTimeMs = Math.round(performance.now() - startTime);
        const costSavedUSD = Number(((telemetry.rawTokens / 1_000_000) * pricing.inputPer1M).toFixed(6));

        this.cumulativeStats.totalTokensSaved += telemetry.rawTokens;
        this.cumulativeStats.totalCostSavedUSD += costSavedUSD;

        return {
          ...cached,
          _alloyMeta: {
            cacheHit: true,
            provider,
            model,
            executionTimeMs,
            rawTokens: telemetry.rawTokens,
            optimizedTokens: 0,
            savedTokens: telemetry.rawTokens,
            reductionPercent: 100.0,
            costSavedUSD,
            cacheStats: this.cache.getStats()
          }
        };
      }

      const pending = this.inFlight.get(cacheKey);
      if (pending) {
        const response = await pending;
        const executionTimeMs = Math.round(performance.now() - startTime);
        const costSavedUSD = Number(((telemetry.rawTokens / 1_000_000) * pricing.inputPer1M).toFixed(6));
        this.cumulativeStats.totalTokensSaved += telemetry.rawTokens;
        this.cumulativeStats.totalCostSavedUSD += costSavedUSD;
        return {
          ...response,
          _alloyMeta: {
            cacheHit: true,
            coalesced: true,
            provider,
            model,
            executionTimeMs,
            rawTokens: telemetry.rawTokens,
            optimizedTokens: 0,
            savedTokens: telemetry.rawTokens,
            reductionPercent: 100.0,
            costSavedUSD,
            cacheStats: this.cache.getStats()
          }
        };
      }
    }

    // 3. Execute network request
    const request = Promise.resolve().then(() => apiCallFn(finalPayload));
    if (cacheKey) this.inFlight.set(cacheKey, request);
    let response;
    try {
      response = await request;
    } finally {
      if (cacheKey) this.inFlight.delete(cacheKey);
    }
    const executionTimeMs = Math.round(performance.now() - startTime);

    // 4. Save to cache
    if (cacheKey) {
      this.cache.set(cacheKey, response, options.cacheTTLMs);
    }

    // 5. Calculate cost savings
    const costSavedUSD = Number(((telemetry.savedTokens / 1_000_000) * pricing.inputPer1M).toFixed(6));
    this.cumulativeStats.totalTokensSaved += telemetry.savedTokens;
    this.cumulativeStats.totalCostSavedUSD += costSavedUSD;

    return {
      ...response,
      _alloyMeta: {
        cacheHit: false,
        provider,
        model,
        executionTimeMs,
        rawTokens: telemetry.rawTokens,
        optimizedTokens: telemetry.optimizedTokens,
        savedTokens: telemetry.savedTokens,
        reductionPercent: telemetry.reductionPercent,
        costSavedUSD,
        cacheStats: this.cache.getStats()
      }
    };
  }

  /**
   * Wrap an async SDK invocation function with Alloy defaults.
   * @param {(payload: Object) => Promise<any>} fn
   * @param {Object} [defaultOptions={}]
   * @returns {(payload: Object, options?: Object) => Promise<any>}
   */
  wrap(fn, defaultOptions = {}) {
    return (payload, options = {}) => {
      return this.execute(fn, payload, { ...defaultOptions, ...options });
    };
  }

  /**
   * Clear the memory cache.
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Returns current cache and optimization statistics.
   */
  getStats() {
    return {
      cache: this.cache.getStats(),
      cumulative: {
        ...this.cumulativeStats,
        totalCostSavedUSD: Number(this.cumulativeStats.totalCostSavedUSD.toFixed(6))
      }
    };
  }
}

// Default export
export default Alloy;
