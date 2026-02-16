CREATE TABLE IF NOT EXISTS leaderboard (
  device_id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL,
  score INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_score_updated
ON leaderboard(score DESC, updated_at ASC);
