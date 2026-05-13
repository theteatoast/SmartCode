/**
 * Semantic cache with proper hashing and TTL.
 * 
 * Caches agent responses for prompts so identical or near-identical
 * requests can be served instantly without burning inference budget.
 * 
 * Uses SHA-256 for prompt hashing and configurable TTL for expiry.
 */

import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import path from 'path';
import os from 'os';
import fs from 'fs';

export interface CacheEntry {
  promptHash: string;
  prompt: string;
  response: string;
  agentName: string;
  hitCount: number;
  createdAt: number;
  lastHitAt: number;
}

export class CacheManager {
  private db: Database.Database;
  private defaultTtlMs: number;

  /** Running count of cache hits this session */
  public sessionHits: number = 0;

  /** Running count of cache misses this session */
  public sessionMisses: number = 0;

  constructor(ttlHours: number = 24) {
    const dbPath = this.getDbPath();
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.defaultTtlMs = ttlHours * 60 * 60 * 1000;
    this.init();
    this.cleanExpired();
  }

  private getDbPath(): string {
    const configDir = path.join(os.homedir(), '.smartcode');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    return path.join(configDir, 'smartcode.db');
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS semantic_cache (
        prompt_hash TEXT PRIMARY KEY,
        prompt TEXT NOT NULL,
        response TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        hit_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_hit_at INTEGER,
        ttl_ms INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_cache_created ON semantic_cache(created_at);
    `);
  }

  /**
   * Hash a prompt using SHA-256.
   * Normalizes whitespace before hashing for better matching.
   */
  private hashPrompt(prompt: string): string {
    const normalized = prompt.trim().replace(/\s+/g, ' ').toLowerCase();
    return createHash('sha256').update(normalized).digest('hex');
  }

  /**
   * Look up a cached response for a prompt.
   * Returns null if no cache entry exists or if it has expired.
   */
  getCachedResponse(prompt: string, agentName: string): string | null {
    const hash = this.hashPrompt(prompt);

    const stmt = this.db.prepare(`
      SELECT response, created_at, ttl_ms FROM semantic_cache
      WHERE prompt_hash = ? AND agent_name = ?
    `);

    const row = stmt.get(hash, agentName) as { response: string; created_at: number; ttl_ms: number } | undefined;

    if (!row) {
      this.sessionMisses++;
      return null;
    }

    // Check TTL
    if (Date.now() - row.created_at > row.ttl_ms) {
      // Expired — delete and return null
      this.db.prepare('DELETE FROM semantic_cache WHERE prompt_hash = ?').run(hash);
      this.sessionMisses++;
      return null;
    }

    // Update hit count and last hit time
    this.db.prepare(`
      UPDATE semantic_cache SET hit_count = hit_count + 1, last_hit_at = ? WHERE prompt_hash = ?
    `).run(Date.now(), hash);

    this.sessionHits++;
    return row.response;
  }

  /**
   * Save a prompt-response pair to the cache.
   */
  saveResponse(prompt: string, response: string, agentName: string, ttlMs?: number): void {
    const hash = this.hashPrompt(prompt);
    const ttl = ttlMs ?? this.defaultTtlMs;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO semantic_cache
        (prompt_hash, prompt, response, agent_name, hit_count, created_at, last_hit_at, ttl_ms)
      VALUES (?, ?, ?, ?, 0, ?, NULL, ?)
    `);

    stmt.run(hash, prompt.trim(), response, agentName, Date.now(), ttl);
  }

  /**
   * Remove expired cache entries.
   */
  cleanExpired(): number {
    const result = this.db.prepare(`
      DELETE FROM semantic_cache WHERE (created_at + ttl_ms) < ?
    `).run(Date.now());

    return result.changes;
  }

  /**
   * Get cache statistics.
   */
  getStats(): { totalEntries: number; totalHits: number; sessionHits: number; sessionMisses: number } {
    const row = this.db.prepare(`
      SELECT COUNT(*) as total, COALESCE(SUM(hit_count), 0) as totalHits
      FROM semantic_cache
    `).get() as { total: number; totalHits: number };

    return {
      totalEntries: row.total,
      totalHits: row.totalHits,
      sessionHits: this.sessionHits,
      sessionMisses: this.sessionMisses,
    };
  }

  close(): void {
    this.db.close();
  }
}
