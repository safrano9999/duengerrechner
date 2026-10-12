import { AppError } from './domain.mjs';
export const schemaSQL = `CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, water TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0,1))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_default_profile ON profiles(is_default) WHERE is_default=1;`;
const decode = row => ({ ...row, water: JSON.parse(row.water), is_default: Boolean(row.is_default) });
// Both adapters execute each write as a transaction (SQLite) or atomic D1 batch.
export class ProfileStore {
  constructor(db) { this.db = db; }
  async list() { return (await this.db.all('SELECT * FROM profiles ORDER BY name, id', [])).map(decode); }
  async save(data, id) {
    if (id && !(await this.list()).some(p => p.id === id)) throw new AppError(404, 'Unknown water profile');
    id ??= crypto.randomUUID();
    const queries = [];
    if (data.is_default) queries.push(['UPDATE profiles SET is_default=0', []]);
    queries.push([`INSERT INTO profiles(id,name,water,is_default) VALUES(?,?,?,
      CASE WHEN ?=1 OR NOT EXISTS(SELECT 1 FROM profiles WHERE is_default=1) THEN 1 ELSE 0 END)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, water=excluded.water,
      is_default=MAX(profiles.is_default,excluded.is_default)`, [id, data.name, JSON.stringify(data.water), Number(data.is_default)]]);
    await this.db.batch(queries);
    return (await this.list()).find(p => p.id === id);
  }
  async delete(id) {
    if (!(await this.list()).some(p => p.id === id)) throw new AppError(404, 'Unknown water profile');
    await this.db.batch([
      ['DELETE FROM profiles WHERE id=?', [id]],
      [`UPDATE profiles SET is_default=1 WHERE id=(SELECT id FROM profiles ORDER BY name,id LIMIT 1)
        AND NOT EXISTS(SELECT 1 FROM profiles WHERE is_default=1)`, []],
    ]);
    return true;
  }
}
export function d1Store(db) {
  if (!db) throw new AppError(503, 'D1 binding DB is missing; apply the documented database setup');
  return new ProfileStore({
    all: async (sql, args) => (await db.prepare(sql).bind(...args).all()).results,
    batch: queries => db.batch(queries.map(([sql, args]) => db.prepare(sql).bind(...args))),
  });
}
