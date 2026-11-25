CREATE INDEX entries_expenses ON entries (owner_id, happened_on, vehicle_id)
  WHERE cost_minor IS NOT NULL;

CREATE TABLE osago_reminders (
  owner_id TEXT NOT NULL,
  vehicle_id TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  days_before INTEGER NOT NULL CHECK(days_before IN (1, 7, 30)),
  claimed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT,
  PRIMARY KEY (owner_id, vehicle_id, valid_until, days_before),
  FOREIGN KEY (owner_id, vehicle_id) REFERENCES vehicles (owner_id, id)
);
