/**
 * @file docs/alloy-web.js
 * Universal Browser Engine for Alloy.js Interactive Playground.
 */

export const MODEL_PRICING = {
  'gemini-2.5-flash': { inputPer1M: 0.075, outputPer1M: 0.30, label: 'Google Gemini 2.5 Flash' },
  'gemini-1.5-pro': { inputPer1M: 1.25, outputPer1M: 5.00, label: 'Google Gemini 1.5 Pro' },
  'gpt-4o': { inputPer1M: 2.50, outputPer1M: 10.00, label: 'OpenAI GPT-4o' },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.60, label: 'OpenAI GPT-4o-mini' },
  'claude-3-5-sonnet': { inputPer1M: 3.00, outputPer1M: 15.00, label: 'Anthropic Claude 3.5 Sonnet' }
};

export function canonicalJsonStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(item => canonicalJsonStringify(item)).join(',') + ']';
  }
  const sortedKeys = Object.keys(value).sort();
  const pairs = sortedKeys.map(k => JSON.stringify(k) + ':' + canonicalJsonStringify(value[k]));
  return '{' + pairs.join(',') + '}';
}

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
          if (c === '{' || c === '[') depth++;
          else if (c === '}' || c === ']') depth--;
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
          if (typeof parsed === 'object' && parsed !== null) {
            result += JSON.stringify(parsed);
            i = end + 1;
            continue;
          }
        } catch {}
      }
    }
    result += char;
    i++;
  }
  return result;
}

export function compressText(text, options = {}) {
  if (!text || typeof text !== 'string') return text;
  const {
    preserveCodeBlocks = true,
    enableJsonMinification = true,
    markdownDeclutter = true
  } = options;

  const codeBlocks = [];
  let processed = text;

  if (preserveCodeBlocks) {
    processed = processed.replace(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g, (match) => {
      const token = `__ALLOY_CODE_BLOCK_${codeBlocks.length}__`;
      codeBlocks.push(match);
      return token;
    });
  }

  if (enableJsonMinification) {
    processed = minifyJsonContext(processed);
  }

  processed = processed.replace(/\r\n/g, '\n');

  if (markdownDeclutter) {
    processed = processed.replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, '');
    processed = processed.replace(/^([ \t]*[-*+])[ \t]{2,}/gm, '$1 ');
  }

  processed = processed
    .split('\n')
    .map(line => {
      if (line.includes('__ALLOY_CODE_BLOCK_')) return line;
      return line.replace(/[ \t]+/g, ' ').trimEnd();
    })
    .join('\n');

  processed = processed.replace(/\n{3,}/g, '\n\n').trim();

  if (preserveCodeBlocks && codeBlocks.length > 0) {
    for (let i = 0; i < codeBlocks.length; i++) {
      processed = processed.replace(`__ALLOY_CODE_BLOCK_${i}__`, codeBlocks[i]);
    }
  }

  return processed;
}

export function estimateTokens(input) {
  if (!input) return 0;
  if (typeof input === 'object') {
    if (Array.isArray(input)) {
      return input.reduce((sum, item) => sum + estimateTokens(item), 0);
    }
    if (input.content) return estimateTokens(input.content) + 4;
    if (input.parts && Array.isArray(input.parts)) {
      return input.parts.reduce((sum, p) => sum + estimateTokens(p.text || p), 0) + 4;
    }
    input = JSON.stringify(input);
  }
  if (typeof input !== 'string') return 0;
  if (input.length === 0) return 0;

  const words = input.trim().split(/\s+/).length;
  const chars = input.length;
  const charEstimate = chars / 3.7;
  const wordEstimate = words * 1.25;
  return Math.max(1, Math.round((charEstimate * 0.7) + (wordEstimate * 0.3)));
}

export function optimizePayload(messages, provider = 'gemini', options = {}) {
  const cleaned = messages.map(msg => ({
    ...msg,
    content: typeof msg.content === 'string' ? compressText(msg.content, options) : msg.content
  }));

  const sorted = [...cleaned].sort((a, b) => {
    const rank = (m) => (m.role === 'system' ? 0 : m.isStatic ? 1 : 2);
    return rank(a) - rank(b);
  });

  if (provider === 'gemini') {
    const system = sorted.filter(m => m.role === 'system');
    const contents = sorted.filter(m => m.role !== 'system').map(m => ({
      role: m.role === 'assistant' ? 'model' : m.role,
      parts: [{ text: m.content }]
    }));
    return {
      provider,
      systemInstruction: system.map(m => m.content).join('\n\n') || undefined,
      contents
    };
  }

  if (provider === 'anthropic') {
    const system = sorted.filter(m => m.role === 'system');
    let breakpoints = 0;
    const transformed = sorted.filter(m => m.role !== 'system').map(m => {
      const shouldCache = (m.isStatic || m.cache) && breakpoints < 4;
      if (shouldCache) {
        breakpoints++;
        return {
          role: m.role,
          content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }]
        };
      }
      return { role: m.role, content: m.content };
    });
    return {
      provider,
      system: system.map(m => m.content).join('\n\n') || undefined,
      messages: transformed
    };
  }

  // OpenAI
  return {
    provider,
    messages: sorted.map(({ isStatic, cache, ...rest }) => rest)
  };
}
