-- Daily call counters for the spending caps (SAM images and model calls), checked before every call.
CREATE TABLE usage_counters (day TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('sam','model')),
  count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind));
