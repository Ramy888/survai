-- New surveys made with the judges' passcode, per day: the link is shared outside the team, so it is capped.
CREATE TABLE judge_surveys (day TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0);
