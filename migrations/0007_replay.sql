-- Public replay reruns: one per IP per window (like passcode_failures), and the run the engineer approved, so the
-- sample's report keeps showing that run after a live rerun adds a newer one.
CREATE TABLE rerun_requests (ip TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX reruns_by_ip ON rerun_requests (ip, at);
ALTER TABLE surveys ADD COLUMN approved_run INTEGER;
