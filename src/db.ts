import Database from 'better-sqlite3';

// Base models for code awareness — seed categories that most codebases have
export const BASE_MODELS: Record<string, string> = {
  architecture: 'High-level system design — how major components connect, data flow, and key design decisions',
  server: 'Backend — API routes, middleware, request handling, streaming, server-side state',
  client: 'Frontend — UI components, state management, rendering patterns, user interactions',
  database: 'Data layer — schema design, migrations, ORM usage, storage patterns',
  deployment: 'Infrastructure — build process, hosting, service management, CI/CD',
};

/**
 * Initialize database with schema and seed base models.
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
      is_base INTEGER DEFAULT 0,
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

  // Seed base models
  const insertModel = sqlite.prepare(
    'INSERT OR IGNORE INTO models (name, description, is_base, content_dirty) VALUES (?, ?, 1, 1)'
  );
  for (const [name, description] of Object.entries(BASE_MODELS)) {
    insertModel.run(name, description);
  }

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
