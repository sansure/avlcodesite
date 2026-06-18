# AVL Code 站长统计 - Cloudflare Workers 版

## 项目结构

```
hello-avlcode-worker/
├── src/index.js          # Worker 主程序（含全部 HTML/CSS/JS）
├── migrations/
│   └── 0001_init.sql     # D1 数据库迁移 SQL
├── wrangler.toml         # Cloudflare Workers 配置
├── setup_ssh_and_push.sh # SSH 推送脚本
└── README.md             # 本文件
```

## 部署步骤

### 1. 创建 D1 数据库

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Workers & Pages** → **D1**
3. 点击 **Create database**
   - 名称：`stats-db`
   - 区域：自动
4. 创建后记录 **Database ID**（当前值：`63eef9ce-28de-4290-9c9e-65e522013734`）

### 2. 执行 D1 迁移

在 Cloudflare Dashboard 的 D1 Console 中执行以下 SQL：

```sql
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
```

### 3. 创建 Worker

1. 进入 **Workers & Pages** → **Overview**
2. 点击 **Create application** → **Worker**
3. 输入名称：`stats-tracker`
4. 创建后进入 Worker 编辑页面

### 4. 绑定 D1 数据库

1. 在 Worker 页面，进入 **Settings** → **Variables**
2. 找到 **D1 Database Bindings**
3. 点击 **Add binding**
   - Variable name：`DB`
   - Database：选择 `stats-db`
4. 点击 **Save**

### 5. 部署代码

**方式一：直接粘贴代码**
1. 打开 Worker 的 **Quick Edit**
2. 将 `src/index.js` 全部内容粘贴到编辑器中
3. 点击 **Save and Deploy**

**方式二：连接 GitHub 仓库（推荐）**
1. 将代码推送到 GitHub 仓库
2. 在 Workers & Pages 中连接该仓库
3. 设置构建配置（无需构建命令）
4. 自动部署

### 6. 验证部署

访问以下 URL 验证功能：

```
https://stats-tracker.你的域名.workers.dev/admin
```

- 概览页面应显示 5 个统计卡片
- 详细统计页面应显示页面/下载/属地表格
- IP 列表页面应显示 IP 明细

### 7. 配置自定义域名（可选）

1. 在 Worker 的 **Triggers** → **Custom Domains**
2. 添加你的域名（如 `stats.avlcode.cn`）
3. 在 DNS 解析中添加 CNAME 记录指向 Worker

## 本地测试

本地版位于 `../pagecount/` 目录，使用 Python 标准库运行：

```bash
cd ../pagecount/
python3 app.py
```

访问 `http://localhost:8900/admin`

## 技术栈

- **运行时**：Cloudflare Workers (JavaScript)
- **数据库**：Cloudflare D1 (SQLite 兼容)
- **前端**：原生 HTML + CSS + Chart.js
- **GeoIP**：ip-api.com 在线 API + D1 缓存
- **本地版**：Python 标准库 http.server + SQLite3