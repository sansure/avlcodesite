-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT DEFAULT 'admin',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Session 表
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- 插入默认用户: antiy / antiy?100avlcode
-- 密码哈希使用 PBKDF2-SHA256, salt=avlcodesite, iterations=100000
-- 哈希值由 Python hashlib.pbkdf2_hmac('sha256') 生成
INSERT OR IGNORE INTO users (username, password_hash, salt, role)
VALUES (
  'antiy',
  '4e06be02a5d6880ea618109f488e56e3801f00e74ad9258a7272313f01bd732c',
  'avlcodesite',
  'admin'
);