PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS rooms (
 id TEXT PRIMARY KEY,
 join_hash TEXT NOT NULL,
 host_hash TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 sequence INTEGER NOT NULL DEFAULT 0,
 revision INTEGER NOT NULL DEFAULT 0,
 generation INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS rooms_expiry ON rooms(expires_at);
CREATE TABLE IF NOT EXISTS contributions (
 id TEXT PRIMARY KEY,
 room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
 request_id TEXT NOT NULL,
 generation INTEGER NOT NULL,
 sequence INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 scores TEXT NOT NULL,
 anchors TEXT NOT NULL,
 photo TEXT NOT NULL,
 UNIQUE(room_id, request_id)
);
CREATE INDEX IF NOT EXISTS contribution_room ON contributions(room_id, sequence);
CREATE TABLE IF NOT EXISTS receipts (
 room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
 request_id TEXT NOT NULL,
 record_id TEXT NOT NULL,
 generation INTEGER NOT NULL,
 PRIMARY KEY(room_id,request_id)
);
CREATE TABLE IF NOT EXISTS rate_limits (
 key TEXT PRIMARY KEY,
 count INTEGER NOT NULL DEFAULT 1,
 reset_at INTEGER NOT NULL
);
