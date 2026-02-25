import Database from 'better-sqlite3';

/**
 * Initialize database with schema. No base models seeded —
 * models are discovered dynamically from the codebase.
 */
export function initDb(dbPath: string): void {
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      synthesized_content TEXT,
      content_dirty INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      timestamp TEXT,
      model_id INTEGER REFERENCES models(id)
    );

    CREATE TABLE IF NOT EXISTS summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id INTEGER NOT NULL REFERENCES models(id),
      tier INTEGER NOT NULL,
      text TEXT NOT NULL,
      start_timestamp TEXT,
      end_timestamp TEXT,
      is_dirty INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS summary_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      summary_id INTEGER NOT NULL REFERENCES summaries(id),
      source_type TEXT NOT NULL,
      source_id INTEGER NOT NULL
    );
  `);

  sqlite.close();
}

/**
 * Open an existing database.
 */
export function openDb(dbPath: string): Database.Database {
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  return sqlite;
}
