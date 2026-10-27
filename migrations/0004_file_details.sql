-- Name and size shown on the upload screen; created_at orders key frames as uploaded.
ALTER TABLE files ADD COLUMN name TEXT;
ALTER TABLE files ADD COLUMN bytes INTEGER;
ALTER TABLE files ADD COLUMN created_at TEXT;
