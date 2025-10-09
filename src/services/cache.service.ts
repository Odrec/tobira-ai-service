import { config } from '../config';

interface CacheEntry<T> {
  data: T;
  expires: number;
}

/**
 * Simple in-memory cache service
 * For production, consider using Redis
 */
class CacheService {
  private cache: Map<string, CacheEntry<any>>;
  private hits: number = 0;
  private misses: number = 0;

  constructor() {
    this.cache = new Map();
    
    // Cleanup expired entries every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  /**
   * Get value from cache
   */
  async get<T = any>(key: string): Promise<T | null> {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.misses++;
      return null;
    }

    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry.data as T;
  }

  /**
   * Set value in cache with TTL
   */
  async set<T = any>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const ttl = ttlSeconds || config.performance.cacheTtlSeconds;
    const expires = Date.now() + (ttl * 1000);

    this.cache.set(key, {
      data: value,
      expires,
    });
  }

  /**
   * Check if key exists and is not expired
   */
  async has(key: string): Promise<boolean> {
    const entry = this.cache.get(key);
    if (!entry) return false;
    
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return false;
    }
    
    return true;
  }

  /**
   * Invalidate/delete a cache entry
   */
  async invalidate(key: string): Promise<void> {
    this.cache.delete(key);
  }

  /**
   * Clear all cache entries
   */
  async clear(): Promise<void> {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Remove expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expires) {
        this.cache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      console.log(`Cache cleanup: removed ${removed} expired entries`);
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? (this.hits / total) * 100 : 0;

    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: hitRate.toFixed(2) + '%',
    };
  }

  /**
   * Generate cache key for summary
   */
  static summaryKey(eventId: number | string, language: string): string {
    return `summary:${eventId}:${language}`;
  }

  /**
   * Generate cache key for transcript
   */
  static transcriptKey(eventId: number | string, language: string): string {
    return `transcript:${eventId}:${language}`;
  }
}

// Export class and singleton instance
export { CacheService };
export const cache = new CacheService();
export default cache;