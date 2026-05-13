/**
 * Session persistence layer.
 * 
 * Stores session metadata and analytics in SQLite so users can:
 * - See historical session data
 * - Resume sessions
 * - Track efficiency trends over time
 */

import Database from 'better-sqlite3';
import { SessionMetrics } from '../core/analytics.js';
import { randomBytes } from 'crypto';
import path from 'path';
import os from 'os';
import fs from 'fs';

export class SessionManager {
  private db: Database.Database;

  constructor() {
    const dbPath = this.getDbPath();
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private getDbPath(): string {
    // Store in user's home config directory
    const configDir = path.join(os.homedir(), '.smartcode');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    return path.join(configDir, 'smartcode.db');
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        agent_name TEXT NOT NULL,
        optimization_level TEXT NOT NULL,
        response_style TEXT NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        duration_ms INTEGER,
        interaction_count INTEGER DEFAULT 0,
        agent_bytes_out INTEGER DEFAULT 0,
        user_bytes_in INTEGER DEFAULT 0,
        loops_detected INTEGER DEFAULT 0,
        loops_intervened INTEGER DEFAULT 0,
        loops_by_type TEXT DEFAULT '{}',
        cache_hits INTEGER DEFAULT 0,
        efficiency_gain_pct REAL DEFAULT 0.0,
        cwd TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS loop_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        count INTEGER NOT NULL,
        intervened INTEGER DEFAULT 0,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at);
      CREATE INDEX IF NOT EXISTS idx_loop_events_session ON loop_events(session_id);
    `);
  }

  /**
   * Generate a new session ID.
   */
  generateSessionId(): string {
    const bytes = randomBytes(12);
    return `ses_${bytes.toString('hex')}`;
  }

  /**
   * Create a new session record.
   */
  createSession(sessionId: string, agentName: string, optimizationLevel: string, responseStyle: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, agent_name, optimization_level, response_style, start_time, cwd)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(sessionId, agentName, optimizationLevel, responseStyle, Date.now(), process.cwd());
  }

  /**
   * Save final session metrics.
   */
  saveMetrics(metrics: SessionMetrics): void {
    const stmt = this.db.prepare(`
      UPDATE sessions SET
        end_time = ?,
        duration_ms = ?,
        interaction_count = ?,
        agent_bytes_out = ?,
        user_bytes_in = ?,
        loops_detected = ?,
        loops_intervened = ?,
        loops_by_type = ?,
        cache_hits = ?,
        efficiency_gain_pct = ?
      WHERE id = ?
    `);

    stmt.run(
      metrics.endTime,
      metrics.durationMs,
      metrics.interactionCount,
      metrics.agentBytesOut,
      metrics.userBytesIn,
      metrics.loopsDetected,
      metrics.loopsIntervened,
      JSON.stringify(metrics.loopsByType),
      metrics.cacheHits,
      metrics.efficiencyGainPct,
      metrics.sessionId
    );
  }

  /**
   * Get the N most recent sessions.
   */
  getRecentSessions(limit: number = 10): Array<Record<string, unknown>> {
    const stmt = this.db.prepare(`
      SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?
    `);
    return stmt.all(limit) as Array<Record<string, unknown>>;
  }

  /**
   * Get aggregate stats across all sessions.
   */
  getAggregateStats(): {
    totalSessions: number;
    totalLoopsDetected: number;
    totalLoopsIntervened: number;
    avgEfficiencyGain: number;
    totalDurationMs: number;
  } {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) as totalSessions,
        COALESCE(SUM(loops_detected), 0) as totalLoopsDetected,
        COALESCE(SUM(loops_intervened), 0) as totalLoopsIntervened,
        COALESCE(AVG(efficiency_gain_pct), 0) as avgEfficiencyGain,
        COALESCE(SUM(duration_ms), 0) as totalDurationMs
      FROM sessions
      WHERE end_time IS NOT NULL
    `).get() as Record<string, number>;

    return {
      totalSessions: row.totalSessions ?? 0,
      totalLoopsDetected: row.totalLoopsDetected ?? 0,
      totalLoopsIntervened: row.totalLoopsIntervened ?? 0,
      avgEfficiencyGain: Math.round((row.avgEfficiencyGain ?? 0) * 10) / 10,
      totalDurationMs: row.totalDurationMs ?? 0,
    };
  }

  close(): void {
    this.db.close();
  }
}
