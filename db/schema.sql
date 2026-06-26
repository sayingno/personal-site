CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  excerpt TEXT DEFAULT '',
  ticker TEXT,
  direction TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS about (
  id INTEGER PRIMARY KEY,
  content TEXT NOT NULL DEFAULT ''
);

INSERT OR IGNORE INTO about (id, content)
VALUES (
  1,
  '# About Me

Hey, I''m Jiawei. This is where I write about markets, trading research, ideas, and notes.'
);
