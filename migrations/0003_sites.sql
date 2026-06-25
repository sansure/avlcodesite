-- 多站点支持迁移
CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sites_name ON sites(name);
CREATE INDEX IF NOT EXISTS idx_sites_token ON sites(token);

ALTER TABLE visits ADD COLUMN site_id TEXT DEFAULT 'default';

CREATE INDEX IF NOT EXISTS idx_visits_site_id ON visits(site_id);
CREATE INDEX IF NOT EXISTS idx_visits_site_time ON visits(site_id, visit_time);
CREATE INDEX IF NOT EXISTS idx_visits_site_ip ON visits(site_id, ip_address);
CREATE INDEX IF NOT EXISTS idx_visits_site_page ON visits(site_id, page_url);
CREATE INDEX IF NOT EXISTS idx_visits_site_download ON visits(site_id, download_item);
CREATE INDEX IF NOT EXISTS idx_visits_site_session ON visits(site_id, session_id);

INSERT OR IGNORE INTO sites (id, name, token) VALUES (
  'default',
  '默认站点',
  'tk_' || lower(hex(randomblob(16)))
);
