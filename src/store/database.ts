import fs from 'node:fs';
import path from 'node:path';
import BetterSqlite3, { type Database } from 'better-sqlite3';
import { migrate } from './migrations.js';

export const IN_MEMORY = ':memory:';

/** Opens (creating the parent directory if needed), tunes and migrates the SQLite database. */
export function openDatabase(file: string): Database {
  if (file !== IN_MEMORY) fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new BetterSqlite3(file);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  if (file !== IN_MEMORY) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  }
  migrate(db);
  return db;
}
