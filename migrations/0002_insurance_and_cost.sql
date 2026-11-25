DROP INDEX entries_history;
ALTER TABLE entries RENAME TO entries_before_insurance;

CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  vehicle_id TEXT NOT NULL,
  happened_on TEXT NOT NULL,
  mileage INTEGER CHECK (mileage >= 0),
  kind TEXT NOT NULL CHECK (kind IN ('service', 'repair', 'problem', 'note', 'insurance')),
  title TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),
  resolved_on TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cost_minor INTEGER CHECK (cost_minor >= 0),
  valid_until TEXT CHECK (valid_until IS NULL OR (kind = 'insurance' AND valid_until >= happened_on)),
  FOREIGN KEY (owner_id, vehicle_id) REFERENCES vehicles (owner_id, id)
);

INSERT INTO entries (id, owner_id, vehicle_id, happened_on, mileage, kind, title, details, tags, resolved_on, created_at)
SELECT id, owner_id, vehicle_id, happened_on, mileage, kind, title, details, tags, resolved_on, created_at
FROM entries_before_insurance;
DROP TABLE entries_before_insurance;

CREATE INDEX entries_history ON entries (owner_id, vehicle_id, happened_on DESC, created_at DESC);
