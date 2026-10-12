CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, water TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0,1))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_default_profile ON profiles(is_default) WHERE is_default=1;
