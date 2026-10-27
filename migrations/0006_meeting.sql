-- The Survey Lead's note per round (it does not vote, so it is not a finding) and what the round led to.
CREATE TABLE lead_notes (survey_id TEXT NOT NULL, run INTEGER NOT NULL, round INTEGER NOT NULL, body_json TEXT NOT NULL,
  model TEXT NOT NULL, fell_back INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL CHECK (outcome IN ('next','waiting','done')), created_at TEXT NOT NULL,
  PRIMARY KEY (survey_id, run, round));
-- A fresh run after a layout edit must not mix with the previous run's calculations.
ALTER TABLE calcs ADD COLUMN run INTEGER NOT NULL DEFAULT 1;
