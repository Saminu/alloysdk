/**
 * @file alloy.js
 * @description Enterprise-grade LLM Token Optimization & Prompt Caching Middleware
 */

import crypto from 'node:crypto';

/**
 * @typedef {Object} AlloyOptions
 * @property {number} [maxCacheSize=500] - Maximum number of responses to keep in memory.
 * @property {number} [ttlMs=3600000] - Cache entry time-to-live in milliseconds (default: 1 hour).
 * @property {'openai'|'anthropic'} [defaultProvider='openai'] - Default target LLM provider.
 */

/**
 * @typedef {Object} AlloyMessage
 * @property {'system'|'user'|'assistant'|'tool'} role
 * @property {string|Array} content
 * @property {boolean} [isStatic] - Anchors non-system content (e.g., RAG context) to the cache prefix.
 * @property {boolean} [cache] - Forces an explicit Anthropic ephemeral cache breakpoint.
 */

export class Alloy {
  /**
   * @param {AlloyOptions} [options={}]
   */
  constructor(options = {}) {
    this.maxCacheSize = options.maxCacheSize || 500;
    this.ttlMs = options.ttlMs || 60 * 60 * 1000; // 1 hour default
    this.defaultProvider = options.defaultProvider || 'openai';
    
    /** @type {Map<string, { data: any, expiresAt: number }>} */
    this.memoryCache = new Map();
  }

  /**
   * Safe bracket-matching parser to minify nested JSON strings embedded within prose.
   * @param {string} text
   * @returns {string}
   */
  static minifyJsonContext(text) {
    if (!text || typeof text !== 'string') return text;

    let result = '';
    let i = 0;

    while (i < text.length) {
      if (text[i] === '{' || text[i] === '[') {
        const start = i;
        let depth = 0;
        let inString = false;
        let escape = false;
        let end = -1;

        for (let j = i; j < text.length; j++) {
          const char = text[j];
          if (escape) {
            escape = false;
            continue;
          }
          if (char === '\\' && inString) {
            escape = true;
            continue;
          }
          if (char === '"') {
            inString = !inString;
            continue;
          }
          if (!inString) {
            if (char === '{' || char === '[') depth++;
            else if (char === '}' || char === ']') depth--;

            if (depth === 0) {
              end = j;
              break;
            }
          }
        }

        if (end !== -1) {
          const jsonCandidate = text.slice(start, end + 1);
          try {
            const minified = JSON.stringify(JSON.parse(jsonCandidate));
            result += minified;
            i = end + 1;
            continue;
          } catch {
            // Invalid JSON block; fall through to character copy
          }
        }
      }
      result += text[i];
      i++;
    }

    return result;
  }

  /**
   * Non-destructive text compression that strips whitespace without breaking markdown formatting.
   * @param {string} text
   * @returns {string}
   */
  static compressText(text) {
    if (!text || typeof text !== 'string') return text;
    
    const minified = this.minifyJsonContext(text);
    return minified
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+/g, ' ')      // Collapse multiple spaces/tabs
      .replace(/\n\s*\n/g, '\n\n')  // Enforce max 2 consecutive line breaks
      .trim();
  }

  /**
   * Optimizes prompt messages for KV-prefix caching and provider mechanics.
   * @param {AlloyMessage[]} messages
   * @param {'openai'|'anthropic'} provider
   * @returns {AlloyMessage[]}
   */
  static optimizeMessages(messages = [], provider = 'openai') {
    // 1. Clean message content
    const cleaned = messages.map(msg => ({
      ...msg,
      content: typeof msg.content === 'string' ? this.compressText(msg.content) : msg.content
    }));

    // 2. Align prefix for KV Caching (System -> Static -> Dynamic)
    const sorted = [...cleaned].sort((a, b) => {
      const rank = (m) => (m.role === 'system' ? 0 : m.isStatic ? 1 : 2);
      return rank(a) - rank(b);
    });

    // 3. Provider-specific transformations
    if (provider === 'anthropic') {
      return this.applyAnthropicCacheControl(sorted);
    }

    // OpenAI/Standard provider clean-up
    return sorted.map(({ isStatic, cache, ...rest }) => rest);
  }

  /**
   * Attaches ephemeral cache control headers for Anthropic API.
   * @param {AlloyMessage[]} messages
   * @param {number} [maxBreakpoints=4]
   * @private
   */
  static applyAnthropicCacheControl(messages, maxBreakpoints = 4) {
    let breakpointsUsed = 0;

    return messages.map((msg, index) => {
      const isSystem = msg.role === 'system';
      const isLastSystem = isSystem && (index === messages.length - 1 || messages[index + 1]?.role !== 'system');
      const shouldCache = (isLastSystem || msg.cache === true || msg.isStatic) && breakpointsUsed < maxBreakpoints;

      const { cache, isStatic, ...cleanMsg } = msg;

      if (!shouldCache) return cleanMsg;

      breakpointsUsed++;

      let contentBlocks = [];
      if (typeof msg.content === 'string') {
        contentBlocks = [{ type: 'text', text: msg.content }];
      } else if (Array.isArray(msg.content)) {
        contentBlocks = [...msg.content];
      } else {
        return cleanMsg;
      }

      const lastIdx = contentBlocks.length - 1;
      contentBlocks[lastIdx] = {
        ...contentBlocks[lastIdx],
        cache_control: { type: 'ephemeral' }
      };

      return { ...cleanMsg, content: contentBlocks };
    });
  }

  /**
   * Generates a deterministic SHA-256 cache key for an optimized payload.
   * @param {Object} payload
   * @param {string} provider
   * @returns {string}
   */
  generateCacheKey(payload, provider) {
    return crypto
      .createHash('sha256')
      .update(JSON.stringify({ provider, payload }))
      .digest('hex');
  }

  /**
   * Evicts expired or stale LRU items from memory.
   * @private
   */
  pruneCache() {
    const now = Date.now();
    for (const [key, entry] of this.memoryCache.entries()) {
      if (now > entry.expiresAt) {
        this.memoryCache.delete(key);
      }
    }

    if (this.memoryCache.size >= this.maxCacheSize) {
      const oldestKey = this.memoryCache.keys().next().value;
      this.memoryCache.delete(oldestKey);
    }
  }

  /**
   * Wrapper function to execute API requests through Alloy optimization.
   * @template T
   * @param {(payload: Object) => Promise<T>} apiCallFn - The SDK API call execution function.
   * @param {Object} payload - The raw request payload.
   * @param {Object} [options={}]
   * @param {'openai'|'anthropic'} [options.provider]
   * @param {number} [options.maxTokens]
   * @returns {Promise<T & { _alloyMeta: Object }>}
   */
  async execute(apiCallFn, payload, options = {}) {
    const startTime = performance.now();
    const provider = options.provider || this.defaultProvider;
    
    // Calculate raw size for telemetry
    const originalCharCount = JSON.stringify(payload.messages).length;

    // Optimize input messages
    const optimizedMessages = Alloy.optimizeMessages(payload.messages, provider);
    
    const finalPayload = {
      ...payload,
      messages: optimizedMessages,
      max_tokens: payload.max_tokens || options.maxTokens || 150
    };

    const optimizedCharCount = JSON.stringify(finalPayload.messages).length;
    const cacheKey = this.generateCacheKey(finalPayload, provider);

    // 1. Check local cache
    this.pruneCache();
    if (this.memoryCache.has(cacheKey)) {
      const cachedResponse = this.memoryCache.get(cacheKey).data;
      return {
        ...cachedResponse,
        _alloyMeta: {
          cacheHit: true,
          provider,
          executionTimeMs: Math.round(performance.now() - startTime),
          savedChars: originalCharCount,
          estimatedSavedTokens: Math.round(originalCharCount / 4)
        }
      };
    }

    // 2. Execute network request
    const response = await apiCallFn(finalPayload);
    const executionTimeMs = Math.round(performance.now() - startTime);

    // 3. Store in memory cache
    this.memoryCache.set(cacheKey, {
      data: response,
      expiresAt: Date.now() + this.ttlMs
    });

    const savedChars = Math.max(0, originalCharCount - optimizedCharCount);

    return {
      ...response,
      _alloyMeta: {
        cacheHit: false,
        provider,
        executionTimeMs,
        savedChars,
        estimatedSavedTokens: Math.round(savedChars / 4)
      }
    };
  }
}