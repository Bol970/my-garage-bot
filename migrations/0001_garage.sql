CREATE TABLE garages (
  owner_id TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT '{}',
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE garage_updates (
  update_id INTEGER PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES garages (owner_id),
  processed_at INTEGER NOT NULL
);
CREATE INDEX garage_updates_processed ON garage_updates (processed_at);

CREATE TABLE vehicles (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES garages (owner_id),
  nickname TEXT NOT NULL,
  model TEXT NOT NULL,
  model_year INTEGER,
  initial_mileage INTEGER CHECK (initial_mileage >= 0),
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (owner_id, id)
);
CREATE INDEX vehicles_owner ON vehicles (owner_id, is_demo, created_at);

CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  vehicle_id TEXT NOT NULL,
  happened_on TEXT NOT NULL,
  mileage INTEGER CHECK (mileage >= 0),
  kind TEXT NOT NULL CHECK (kind IN ('service', 'repair', 'problem', 'note')),
  title TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),
  resolved_on TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id, vehicle_id) REFERENCES vehicles (owner_id, id)
);
CREATE INDEX entries_history ON entries (owner_id, vehicle_id, happened_on DESC, created_at DESC);
