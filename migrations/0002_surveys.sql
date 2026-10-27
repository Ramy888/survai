-- Survey data model (spec v3). Random 128-bit ids (crypto.randomUUID).
CREATE TABLE surveys (id TEXT PRIMARY KEY, site TEXT NOT NULL, project TEXT NOT NULL,
  device_model TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 20),
  connects_to TEXT NOT NULL CHECK (connects_to IN ('same_room','other_room')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','uploading','processing',
    'layout_review','deliberating','approved')),
  layout_version INTEGER NOT NULL DEFAULT 0, deliberated_layout_version INTEGER,
  request_json TEXT, tech_specs_json TEXT, is_sample INTEGER NOT NULL DEFAULT 0,
  replay_slug TEXT UNIQUE, created_at TEXT NOT NULL);
CREATE TABLE survey_reps (survey_id TEXT NOT NULL, agent TEXT NOT NULL, PRIMARY KEY (survey_id, agent));
CREATE TABLE device_specs (survey_id TEXT PRIMARY KEY, height_u REAL, depth_mm INTEGER,
  power_w INTEGER, feed_type TEXT, feed_count INTEGER, breaker_rating_a INTEGER, airflow TEXT,
  weight_kg REAL, sources_json TEXT, confirmed INTEGER NOT NULL DEFAULT 0);
CREATE TABLE rooms (id TEXT PRIMARY KEY, survey_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('devices_hall','connect_to')), name TEXT NOT NULL,
  facts_json TEXT, layout_saved INTEGER NOT NULL DEFAULT 0, UNIQUE (survey_id, role));
CREATE TABLE files (id TEXT PRIMARY KEY, room_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('key_frame','path_clip','panel_photo','photo')),
  r2_key TEXT NOT NULL, masks_json TEXT, sharpness REAL);
CREATE TABLE layout_items (id TEXT PRIMARY KEY, room_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN
  ('rack','ac','door','panel','column','reserved','cable_path','ladder')), label TEXT,
  x_tiles REAL NOT NULL, y_tiles REAL NOT NULL, w_tiles REAL, d_tiles REAL, facing TEXT, props_json TEXT,
  source TEXT NOT NULL CHECK (source IN ('ai','engineer','lead')));
CREATE TABLE calcs (id TEXT PRIMARY KEY, survey_id TEXT NOT NULL, round INTEGER NOT NULL, rule TEXT,
  inputs_json TEXT NOT NULL, result_json TEXT NOT NULL, pass INTEGER NOT NULL);
CREATE TABLE findings (id TEXT PRIMARY KEY, survey_id TEXT NOT NULL, run INTEGER NOT NULL,
  round INTEGER NOT NULL, agent TEXT NOT NULL, verdict TEXT NOT NULL CHECK (verdict IN
  ('approve','object','question','unavailable')), body_json TEXT NOT NULL, override_reason TEXT,
  layout_version INTEGER NOT NULL, created_at TEXT NOT NULL, UNIQUE (survey_id, run, round, agent));
CREATE TABLE questions (id TEXT PRIMARY KEY, finding_id TEXT NOT NULL, text TEXT NOT NULL,
  answer_kind TEXT NOT NULL CHECK (answer_kind IN ('yes_no','number','text')), target_item_id TEXT,
  target_fact TEXT, answer TEXT, answered_at TEXT);
CREATE TABLE signoffs (survey_id TEXT NOT NULL, agent TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
  rep_name TEXT, decision TEXT CHECK (decision IN ('approve','object')), comment TEXT, decided_at TEXT,
  PRIMARY KEY (survey_id, agent));
-- Wrong passcodes per IP, for the 5-per-10-minutes limit.
CREATE TABLE passcode_failures (ip TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX findings_by_survey ON findings (survey_id, run, round);
CREATE INDEX files_by_room ON files (room_id);
CREATE INDEX items_by_room ON layout_items (room_id);
CREATE INDEX questions_by_finding ON questions (finding_id);
CREATE INDEX failures_by_ip ON passcode_failures (ip, at);
