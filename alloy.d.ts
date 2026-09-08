/**
 * @file alloy.d.ts
 * TypeScript declarations for Alloy SDK.
 */

export type ProviderType = 'openai' | 'anthropic' | 'gemini' | 'vllm' | 'generic';

export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
  cachedInputPer1M?: number;
}

export interface AlloyOptions {
  maxCacheSize?: number;
  cacheTTLMs?: number;
  enableMemoryCache?: boolean;
  defaultProvider?: ProviderType;
  defaultModel?: string;
  defaultMaxTokens?: number;
  preserveCodeBlocks?: boolean;
  enableJsonMinification?: boolean;
  markdownDeclutter?: boolean;
  pricing?: ModelPricing;
}

export interface AlloyMessage {
  role: 'system' | 'user' | 'assistant' | 'model' | 'tool';
  content?: string | any[] | Record<string, any>;
  parts?: Array<{ text?: string; [key: string]: any }>;
  isStatic?: boolean;
  cache?: boolean;
  [key: string]: any;
}

export interface AlloyOptimizationOptions {
  provider?: ProviderType;
  preserveCodeBlocks?: boolean;
  enableJsonMinification?: boolean;
  markdownDeclutter?: boolean;
}

export interface AlloyTelemetry {
  rawChars: number;
  optimizedChars: number;
  rawTokens: number;
  optimizedTokens: number;
  savedTokens: number;
  reductionPercent: number;
}

export interface CacheStats {
  size: number;
  maxSize: number;
  hits: number;
  misses: number;
  evictions: number;
  hitRate: number;
}

export interface AlloyMeta {
  cacheHit: boolean;
  coalesced?: boolean;
  provider: ProviderType;
  model: string;
  executionTimeMs: number;
  rawTokens: number;
  optimizedTokens: number;
  savedTokens: number;
  reductionPercent: number;
  costSavedUSD: number;
  cacheStats: CacheStats;
}

export interface OptimizedPayload {
  messages: AlloyMessage[];
  systemInstruction?: string | any;
  telemetry: AlloyTelemetry;
}

export interface ExecuteOptions extends AlloyOptimizationOptions {
  model?: string;
  maxTokens?: number;
  skipCache?: boolean;
  cacheTTLMs?: number;
  /** Set false for calls that must never be replayed from the local cache. */
  cacheable?: boolean;
}

export declare const MODEL_PRICING: Record<string, ModelPricing>;

export declare function canonicalJsonStringify(value: any): string;

export declare function minifyJsonContext(text: string): string;

export declare function compressText(text: string, options?: AlloyOptimizationOptions): string;

export declare function estimateTokens(input: string | any[] | Record<string, any>): number;

export declare function optimizeMessages(
  messages?: AlloyMessage[],
  options?: AlloyOptimizationOptions
): { messages: AlloyMessage[]; systemInstruction?: string | any };

export declare function formatForGemini(
  sortedMessages: AlloyMessage[]
): { messages: AlloyMessage[]; systemInstruction?: string };

export declare function formatForAnthropic(
  sortedMessages: AlloyMessage[],
  maxBreakpoints?: number
): { messages: AlloyMessage[]; systemInstruction?: string };

export declare class LRUCache {
  constructor(options?: { maxSize?: number; ttlMs?: number });
  maxSize: number;
  ttlMs: number;
  get(key: string): any | null;
  set(key: string, data: any, customTTL?: number): void;
  has(key: string): boolean;
  delete(key: string): boolean;
  clear(): void;
  prune(): number;
  getStats(): CacheStats;
}

export declare class Alloy {
  constructor(options?: AlloyOptions);
  cache: LRUCache;
  defaultProvider: ProviderType;
  defaultModel: string;
  defaultMaxTokens: number;
  enableMemoryCache: boolean;
  preserveCodeBlocks: boolean;
  enableJsonMinification: boolean;
  markdownDeclutter: boolean;
  inFlight: Map<string, Promise<any>>;

  generateCacheKey(payload: any, provider: string): string;
  getPricing(modelName?: string): ModelPricing;

  optimize(
    payloadOrMessages: AlloyMessage[] | { messages?: AlloyMessage[]; contents?: AlloyMessage[] },
    options?: AlloyOptimizationOptions
  ): OptimizedPayload;

  execute<T = any>(
    apiCallFn: (payload: any) => Promise<T>,
    payload: any,
    options?: ExecuteOptions
  ): Promise<T & { _alloyMeta: AlloyMeta }>;

  wrap<T = any>(
    fn: (payload: any) => Promise<T>,
    defaultOptions?: ExecuteOptions
  ): (payload: any, options?: ExecuteOptions) => Promise<T & { _alloyMeta: AlloyMeta }>;

  clearCache(): void;
  getStats(): {
    cache: CacheStats;
    cumulative: {
      totalRequests: number;
      totalTokensSaved: number;
      totalCostSavedUSD: number;
    };
  };
}

export default Alloy;
