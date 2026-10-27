-- Datasheet lookups per device model: one lookup costs ~$0.45 (Day-1), so each model is looked up once.
CREATE TABLE device_cache (model_key TEXT PRIMARY KEY, spec_json TEXT NOT NULL, created_at TEXT NOT NULL);
