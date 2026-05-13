import Database from 'better-sqlite3';

export class CacheManager {
  private db: Database.Database;

  constructor() {
    // MVP: use an in-memory DB or a local file
    this.db = new Database('smartcode.db');
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS semantic_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prompt TEXT UNIQUE,
        optimized_prompt TEXT,
        response TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS session_analytics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        replays_avoided INTEGER DEFAULT 0,
        loops_prevented INTEGER DEFAULT 0,
        efficiency_gain_pct REAL DEFAULT 0.0
      );
    `);
  }

  public getCachedResponse(prompt: string): string | null {
    const stmt = this.db.prepare('SELECT response FROM semantic_cache WHERE prompt = ?');
    const row = stmt.get(prompt) as { response: string } | undefined;
    return row ? row.response : null;
  }

  public saveResponse(prompt: string, optimized: string, response: string) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO semantic_cache (prompt, optimized_prompt, response)
      VALUES (?, ?, ?)
    `);
    stmt.run(prompt, optimized, response);
  }
}
