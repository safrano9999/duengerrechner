import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ProfileStore, schemaSQL } from './profiles.mjs';
export function sqliteStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  db.exec(schemaSQL);
  const store = new ProfileStore({
    all: async (sql, args) => db.prepare(sql).all(...args),
    batch: async queries => {
      db.exec('BEGIN IMMEDIATE');
      try { for (const [sql, args] of queries) db.prepare(sql).run(...args); db.exec('COMMIT'); }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  });
  store.close = () => db.close();
  return store;
}
