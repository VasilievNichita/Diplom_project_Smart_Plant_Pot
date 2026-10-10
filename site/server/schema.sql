CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS plants (
  id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, sensor_id TEXT NOT NULL UNIQUE, latin TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS channels (
  mode TEXT NOT NULL CHECK(mode IN ('demo','real')), id INTEGER NOT NULL CHECK(id IN (1,2)),
  plant_id TEXT NOT NULL REFERENCES plants(id), revision INTEGER NOT NULL DEFAULT 1,
  armed INTEGER NOT NULL DEFAULT 0 CHECK(armed IN (0,1)), pump_ml_s REAL,
  max_dose_ml REAL NOT NULL DEFAULT 30, daily_limit_ml REAL NOT NULL DEFAULT 100,
  cooldown_s INTEGER NOT NULL DEFAULT 1800,
  PRIMARY KEY(mode,id), UNIQUE(mode,plant_id)
);
CREATE TABLE IF NOT EXISTS calibrations (
  id TEXT PRIMARY KEY, plant_id TEXT NOT NULL REFERENCES plants(id), sensor_id TEXT NOT NULL,
  dry_adc INTEGER NOT NULL, wet_adc INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cal_plant ON calibrations(plant_id,created_at DESC);
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL CHECK(mode IN ('demo','real')), plant_id TEXT NOT NULL REFERENCES plants(id),
  date TEXT NOT NULL, payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_mode ON events(mode,seq DESC);
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY, mode TEXT NOT NULL CHECK(mode IN ('demo','real')),
  plant_id TEXT NOT NULL REFERENCES plants(id), date TEXT NOT NULL, note TEXT NOT NULL,
  name TEXT NOT NULL, mime TEXT NOT NULL, digest TEXT NOT NULL, bytes BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, last_seen TEXT, reservoir_ok INTEGER,
  firmware TEXT NOT NULL DEFAULT '', last_boot TEXT, last_sequence INTEGER
);
CREATE TABLE IF NOT EXISTS telemetry_packets (
  device_id TEXT NOT NULL REFERENCES devices(id), boot_id TEXT NOT NULL, sequence INTEGER NOT NULL,
  digest TEXT NOT NULL, received_at TEXT NOT NULL,
  PRIMARY KEY(device_id,boot_id,sequence)
);
CREATE TABLE IF NOT EXISTS measurements (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL REFERENCES devices(id),
  plant_id TEXT NOT NULL REFERENCES plants(id), sensor_id TEXT NOT NULL, channel_id INTEGER NOT NULL,
  binding_revision INTEGER NOT NULL, date TEXT NOT NULL, observed_at TEXT,
  raw INTEGER, moisture REAL, calibration_id TEXT REFERENCES calibrations(id),
  temperature REAL, humidity REAL, lux REAL, quality TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS measurements_plant ON measurements(plant_id,seq DESC);
CREATE INDEX IF NOT EXISTS measurements_date ON measurements(date);
CREATE TABLE IF NOT EXISTS commands (
  id TEXT PRIMARY KEY, request_key TEXT NOT NULL UNIQUE, device_id TEXT NOT NULL REFERENCES devices(id),
  channel_id INTEGER NOT NULL, plant_id TEXT NOT NULL REFERENCES plants(id), sensor_id TEXT NOT NULL,
  binding_revision INTEGER NOT NULL, requested_ml REAL NOT NULL, duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','delivered','completed','failed','expired','unknown','cancelled')),
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, delivered_at TEXT, finished_at TEXT, result TEXT
);
CREATE INDEX IF NOT EXISTS commands_status ON commands(status);
