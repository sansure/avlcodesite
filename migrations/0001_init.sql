-- 访问记录表
CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY,
  ip_address TEXT NOT NULL,
  ip_location TEXT DEFAULT '',
  user_agent TEXT,
  page_url TEXT NOT NULL,
  page_title TEXT DEFAULT '',
  referrer TEXT DEFAULT '',
  visit_time DATETIME DEFAULT CURRENT_TIMESTAMP,
  duration INTEGER DEFAULT 0,
  is_download INTEGER DEFAULT 0,
  download_item TEXT DEFAULT '',
  session_id TEXT DEFAULT ''
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_visit_time ON visits(visit_time);
CREATE INDEX IF NOT EXISTS idx_ip_address ON visits(ip_address);
CREATE INDEX IF NOT EXISTS idx_page_url ON visits(page_url);
CREATE INDEX IF NOT EXISTS idx_download_item ON visits(download_item);
CREATE INDEX IF NOT EXISTS idx_session ON visits(session_id);

-- IP 属地缓存表
CREATE TABLE IF NOT EXISTS geo_cache (
  ip TEXT PRIMARY KEY,
  country TEXT DEFAULT '',
  region TEXT DEFAULT '',
  city TEXT DEFAULT '',
  cached_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
