// AVL Code 站长统计 - Cloudflare Workers + D1 版本
// 功能：访问追踪、IP属地、页面统计、下载统计、管理后台

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS 头
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 静态资源
    if (path.startsWith('/static/')) {
      return serveStatic(path, corsHeaders);
    }

    // 管理后台页面
    if (path === '/admin' || path === '/admin/') {
      return new Response(renderDashboard(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders }
      });
    }
    if (path === '/admin/stats') {
      return new Response(renderStats(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders }
      });
    }
    if (path === '/admin/ips') {
      return new Response(renderIpList(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders }
      });
    }

    // API 路由
    if (path.startsWith('/admin/api/')) {
      return handleAdminApi(request, env, corsHeaders);
    }

    // 追踪接口
    if (path === '/track' && request.method === 'POST') {
      return handleTrack(request, env, corsHeaders);
    }
    if (path === '/track/view') {
      return handleTrackView(corsHeaders);
    }

    // 默认响应
    return new Response('Hello AVL Code Worker!', {
      headers: { 'Content-Type': 'text/plain', ...corsHeaders }
    });
  }
};

// ==================== 静态资源 ====================
function serveStatic(path, corsHeaders) {
  const file = path.replace('/static/', '');
  const files = {
    'css/style.css': CSS,
    'js/main.js': JS,
    'img/avl-code-logo.png': '', // 简化处理，实际可上传到 R2
  };
  
  const content = files[file];
  if (content === undefined) {
    return new Response('Not Found', { status: 404, headers: corsHeaders });
  }
  
  let contentType = 'text/plain';
  if (file.endsWith('.css')) contentType = 'text/css';
  else if (file.endsWith('.js')) contentType = 'application/javascript';
  else if (file.endsWith('.png')) contentType = 'image/png';
  
  return new Response(content, {
    headers: { 'Content-Type': contentType, ...corsHeaders }
  });
}

// ==================== 追踪处理 ====================
async function handleTrack(request, env, corsHeaders) {
  try {
    const data = await request.json();
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const ua = request.headers.get('User-Agent') || '';
    const now = new Date().toISOString();
    
    // 简单 session_id 生成
    const session_id = generateSessionId(ip, ua);
    
    // IP 属地查询
    let location = '内网IP';
    if (!isPrivateIp(ip)) {
      location = await queryIpLocation(ip, env);
    }

    // 插入访问记录
    await env.DB.prepare(`
      INSERT INTO visits (ip_address, ip_location, user_agent, page_url, page_title, referrer, duration, is_download, download_item, session_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      ip,
      location,
      ua,
      data.page_url || '/',
      data.page_title || '',
      data.referrer || '',
      data.duration || 0,
      data.is_download ? 1 : 0,
      data.download_item || '',
      session_id
    ).run();

    return new Response(JSON.stringify({ status: 'ok' }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}

function handleTrackView(corsHeaders) {
  // 1x1 透明 GIF（Workers 兼容：base64 → Uint8Array）
  const gifB64 = 'R0lGODlhAQABAPAAAAAAAAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
  const binaryStr = atob(gifB64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return new Response(bytes, {
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-cache',
      ...corsHeaders
    }
  });
}

// ==================== GeoIP 查询 ====================
async function queryIpLocation(ip, env) {
  try {
    // 1. 查 D1 缓存
    const cached = await env.DB.prepare(
      'SELECT country, region, city FROM geo_cache WHERE ip = ?'
    ).bind(ip).first();
    
    if (cached) {
      return [cached.country, cached.region, cached.city].filter(Boolean).join(' ') || '未知';
    }
    
    // 2. 调用在线 API（ip-api.com，免费版 45 次/分钟，够用）
    const resp = await fetch(`http://ip-api.com/json/${ip}?lang=zh-CN`, {
      headers: { 'User-Agent': 'AVLCode-Stats/1.0' },
      signal: AbortSignal.timeout(3000)
    });
    
    if (resp.ok) {
      const data = await resp.json();
      if (data.status === 'success') {
        const country = data.country || '';
        const region = data.regionName || '';
        const city = data.city || '';
        const location = [country, region, city].filter(Boolean).join(' ') || country || '未知';
        
        // 3. 写入 D1 缓存
        await env.DB.prepare(
          'INSERT OR REPLACE INTO geo_cache (ip, country, region, city, cached_at) VALUES (?, ?, ?, ?, ?)'
        ).bind(ip, country, region, city, new Date().toISOString()).run();
        
        return location;
      }
    }
    
    // API 失败时存空值避免重复查询
    await env.DB.prepare(
      'INSERT OR REPLACE INTO geo_cache (ip, country, region, city, cached_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(ip, '', '', '', new Date().toISOString()).run();
    
    return '未知';
  } catch (err) {
    // 网络错误等，静默处理
    try {
      await env.DB.prepare(
        'INSERT OR REPLACE INTO geo_cache (ip, country, region, city, cached_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(ip, '', '', '', new Date().toISOString()).run();
    } catch (_) {}
    return '未知';
  }
}

// ==================== 管理后台 API ====================
async function handleAdminApi(request, env, corsHeaders) {
  const url = new URL(request.url);
  const path = url.pathname;
  
  try {
    let result;
    
    if (path === '/admin/api/summary') {
      result = await getStatsSummary(env);
    } else if (path === '/admin/api/hourly') {
      const hours = parseInt(url.searchParams.get('hours') || '24');
      result = await getHourlyStats(env, hours);
    } else if (path === '/admin/api/daily') {
      const days = parseInt(url.searchParams.get('days') || '30');
      result = await getDailyStats(env, days);
    } else if (path === '/admin/api/pages') {
      const days = parseInt(url.searchParams.get('days') || '30');
      result = await getPageStats(env, days);
    } else if (path === '/admin/api/downloads') {
      const days = parseInt(url.searchParams.get('days') || '30');
      result = await getDownloadStats(env, days);
    } else if (path === '/admin/api/locations') {
      const days = parseInt(url.searchParams.get('days') || '30');
      result = await getLocationStats(env, days);
    } else if (path === '/admin/api/ips') {
      const limit = parseInt(url.searchParams.get('limit') || '100');
      const offset = parseInt(url.searchParams.get('offset') || '0');
      const location = url.searchParams.get('location') || '';
      const download = url.searchParams.get('download') || '';
      result = await getIpList(env, limit, offset, location, download);
    } else if (path === '/admin/api/recent') {
      const limit = parseInt(url.searchParams.get('limit') || '50');
      result = await getRecentVisits(env, limit);
    } else {
      return new Response('Not Found', { status: 404, headers: corsHeaders });
    }

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}

// ==================== 数据库查询函数 ====================
async function getStatsSummary(env) {
  const totalUnique = await env.DB.prepare('SELECT COUNT(DISTINCT ip_address) as cnt FROM visits').first();
  const totalViews = await env.DB.prepare('SELECT COUNT(*) as cnt FROM visits').first();
  const totalDownloads = await env.DB.prepare('SELECT COUNT(*) as cnt FROM visits WHERE is_download=1').first();
  
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  const dailyUnique = await env.DB.prepare(
    'SELECT COUNT(DISTINCT ip_address) as cnt FROM visits WHERE visit_time >= ?'
  ).bind(yesterday).first();
  const dailyViews = await env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM visits WHERE visit_time >= ?'
  ).bind(yesterday).first();

  return {
    total_unique: totalUnique?.cnt || 0,
    total_views: totalViews?.cnt || 0,
    total_downloads: totalDownloads?.cnt || 0,
    daily_unique: dailyUnique?.cnt || 0,
    daily_views: dailyViews?.cnt || 0
  };
}

async function getHourlyStats(env, hours) {
  const startTime = new Date(Date.now() - hours * 3600000).toISOString();
  const { results } = await env.DB.prepare(`
    SELECT strftime('%Y-%m-%d %H:00:00', visit_time) as hour, COUNT(*) as views, COUNT(DISTINCT ip_address) as visitors
    FROM visits WHERE visit_time >= ?
    GROUP BY hour ORDER BY hour ASC
  `).bind(startTime).all();
  
  return results.map(r => ({ hour: r.hour, views: r.views, visitors: r.visitors }));
}

async function getDailyStats(env, days) {
  const startTime = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
  const { results } = await env.DB.prepare(`
    SELECT DATE(visit_time) as date, COUNT(*) as views, COUNT(DISTINCT ip_address) as visitors,
           SUM(CASE WHEN is_download=1 THEN 1 ELSE 0 END) as downloads
    FROM visits WHERE visit_time >= ?
    GROUP BY DATE(visit_time) ORDER BY date ASC
  `).bind(startTime).all();
  
  return results.map(r => ({
    date: r.date,
    views: r.views,
    visitors: r.visitors,
    downloads: r.downloads || 0
  }));
}

async function getPageStats(env, days) {
  const startTime = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
  const { results } = await env.DB.prepare(`
    SELECT page_url, COUNT(*) as views, COUNT(DISTINCT ip_address) as visitors, AVG(duration) as avg_duration
    FROM visits WHERE visit_time >= ?
    GROUP BY page_url ORDER BY views DESC
  `).bind(startTime).all();
  
  return results.map(r => ({
    page_url: r.page_url,
    views: r.views,
    visitors: r.visitors,
    avg_duration: Math.round((r.avg_duration || 0) * 10) / 10
  }));
}

async function getDownloadStats(env, days) {
  const startTime = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
  const { results } = await env.DB.prepare(`
    SELECT download_item, COUNT(*) as count FROM visits
    WHERE visit_time >= ? AND is_download=1 AND download_item != ''
    GROUP BY download_item ORDER BY count DESC
  `).bind(startTime).all();
  
  return results.map(r => ({ download_item: r.download_item, count: r.count }));
}

async function getLocationStats(env, days) {
  const startTime = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
  const { results } = await env.DB.prepare(`
    SELECT ip_location, COUNT(*) as views, COUNT(DISTINCT ip_address) as visitors
    FROM visits WHERE visit_time >= ? AND ip_location != ''
    GROUP BY ip_location ORDER BY visitors DESC
  `).bind(startTime).all();
  
  return results.map(r => ({ location: r.ip_location, views: r.views, visitors: r.visitors }));
}

async function getIpList(env, limit, offset, locationFilter, downloadFilter) {
  let query = `
    SELECT ip_address, ip_location, COUNT(*) as visit_count, MAX(visit_time) as last_visit,
           GROUP_CONCAT(DISTINCT CASE WHEN is_download=1 AND download_item!='' THEN download_item END) as downloads
    FROM visits WHERE 1=1
  `;
  const params = [];
  
  if (locationFilter) {
    query += ' AND ip_location LIKE ?';
    params.push(`%${locationFilter}%`);
  }
  if (downloadFilter) {
    query += ' AND download_item LIKE ?';
    params.push(`%${downloadFilter}%`);
  }
  
  query += ' GROUP BY ip_address, ip_location ORDER BY visit_count DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  
  const { results } = await env.DB.prepare(query).bind(...params).all();
  
  return results.map(r => ({
    ip_address: r.ip_address,
    location: r.ip_location,
    visit_count: r.visit_count,
    last_visit: r.last_visit,
    downloads: r.downloads ? r.downloads.split(',').filter(Boolean) : []
  }));
}

async function getRecentVisits(env, limit) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM visits ORDER BY visit_time DESC LIMIT ?'
  ).bind(limit).all();
  
  return results.map(r => ({
    id: r.id,
    ip_address: r.ip_address,
    ip_location: r.ip_location,
    page_url: r.page_url,
    visit_time: r.visit_time,
    duration: r.duration,
    is_download: r.is_download,
    download_item: r.download_item
  }));
}

// ==================== 工具函数 ====================
function generateSessionId(ip, ua) {
  const date = new Date().toISOString().split('T')[0];
  const raw = `${ip}|${ua}|${date}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(16, '0');
}

function isPrivateIp(ip) {
  if (!ip || ip === 'unknown') return true;
  const parts = ip.split('.');
  if (parts.length !== 4) return true;
  
  // 10.0.0.0/8
  if (parts[0] === '10') return true;
  // 172.16.0.0/12
  if (parts[0] === '172' && parseInt(parts[1]) >= 16 && parseInt(parts[1]) <= 31) return true;
  // 192.168.0.0/16
  if (parts[0] === '192' && parts[1] === '168') return true;
  // 127.0.0.0/8
  if (parts[0] === '127') return true;
  
  return false;
}

// ==================== 模板渲染 ====================
function renderDashboard() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>站长统计 - AVL Code</title>
  <link rel="stylesheet" href="/static/css/style.css">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
</head>
<body>
  <nav class="navbar">
    <a href="/admin" class="navbar-brand">
      <img src="/static/img/avl-code-logo.png" alt="AVL Code" style="height:28px;">
      <span>站长统计</span>
    </a>
    <ul class="navbar-nav">
      <li><a href="/admin" class="active">概览</a></li>
      <li><a href="/admin/stats">详细统计</a></li>
      <li><a href="/admin/ips">IP 列表</a></li>
    </ul>
  </nav>
  <div class="container">
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-icon blue">👥</div><div class="stat-content"><h3 id="total-unique">-</h3><p>历史总访问人数</p></div></div>
      <div class="stat-card"><div class="stat-icon green">📊</div><div class="stat-content"><h3 id="total-views">-</h3><p>历史总访问次数</p></div></div>
      <div class="stat-card"><div class="stat-icon orange">📅</div><div class="stat-content"><h3 id="daily-unique">-</h3><p>24小时访问人数</p></div></div>
      <div class="stat-card"><div class="stat-icon red">⚡</div><div class="stat-content"><h3 id="daily-views">-</h3><p>24小时访问次数</p></div></div>
      <div class="stat-card"><div class="stat-icon blue">⬇️</div><div class="stat-content"><h3 id="total-downloads">-</h3><p>历史总下载次数</p></div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
      <div class="card">
        <div class="card-header"><span id="hourlyRangeLabel">近24小时</span>访问趋势
          <select class="form-control range-select" onchange="updateHourlyRange(this.value)">
            <option value="24">近24小时</option><option value="48">近48小时</option><option value="72">近72小时</option>
          </select>
        </div>
        <div class="chart-container"><canvas id="hourlyChart"></canvas></div>
      </div>
      <div class="card">
        <div class="card-header"><span id="dailyRangeLabel">近7天</span>访问趋势
          <select class="form-control range-select" onchange="updateDailyRange(this.value)">
            <option value="7">近7天</option><option value="14">近14天</option><option value="30">近30天</option>
          </select>
        </div>
        <div class="chart-container"><canvas id="dailyChart"></canvas></div>
      </div>
    </div>
    <div class="card">
      <div class="card-header">最近访问记录 <a href="/admin/ips" class="btn btn-outline btn-sm">查看全部 IP</a></div>
      <div class="table-container">
        <table><thead><tr><th>IP</th><th>属地</th><th>页面</th><th>时间</th><th>时长</th><th>类型</th></tr></thead>
        <tbody id="recentVisitsBody"><tr><td colspan="6" class="text-center">加载中...</td></tr></tbody></table>
      </div>
    </div>
  </div>
  <footer class="footer">AVL Code 站长统计系统 · Powered by Cloudflare Workers + D1</footer>
  <script src="/static/js/main.js"></script>
  <script>
    function updateHourlyRange(hours) {
      const label = hours <= 24 ? '近24小时' : '近' + hours + '小时';
      document.getElementById('hourlyRangeLabel').textContent = label;
      fetch('/admin/api/hourly?hours=' + hours).then(r => r.json()).then(data => updateHourlyChart(data, hours));
    }
    function updateDailyRange(days) {
      const label = days <= 1 ? '近1天' : '近' + days + '天';
      document.getElementById('dailyRangeLabel').textContent = label;
      fetch('/admin/api/daily?days=' + days).then(r => r.json()).then(data => updateDailyChart(data, days));
    }
  </script>
</body>
</html>`;
}

function renderStats() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>详细统计 - AVL Code 站长统计</title>
  <link rel="stylesheet" href="/static/css/style.css">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
</head>
<body>
  <nav class="navbar">
    <a href="/admin" class="navbar-brand">
      <img src="/static/img/avl-code-logo.png" alt="AVL Code" style="height:28px;">
      <span>站长统计</span>
    </a>
    <ul class="navbar-nav">
      <li><a href="/admin">概览</a></li>
      <li><a href="/admin/stats" class="active">详细统计</a></li>
      <li><a href="/admin/ips">IP 列表</a></li>
    </ul>
  </nav>
  <div class="container">
    <div class="card">
      <div class="card-header">各页面访问统计 <span id="pageRangeLabel" class="range-label">近30天</span>
        <select class="form-control range-select" onchange="updatePageRange(this.value)">
          <option value="7">近7天</option><option value="14">近14天</option><option value="30" selected>近30天</option><option value="90">近90天</option>
        </select>
      </div>
      <div class="table-container">
        <table><thead><tr><th>页面 URL</th><th>访问次数</th><th>访问人数</th><th>平均停留时长</th></tr></thead>
        <tbody id="pageStatsBody"><tr><td colspan="4" class="text-center">加载中...</td></tr></tbody></table>
      </div>
    </div>
    <div class="card">
      <div class="card-header">各软件下载次数统计 <span id="downloadRangeLabel" class="range-label">近30天</span></div>
      <div class="table-container">
        <table><thead><tr><th>软件/文件名称</th><th>下载次数</th></tr></thead>
        <tbody id="downloadStatsBody"><tr><td colspan="2" class="text-center">加载中...</td></tr></tbody></table>
      </div>
    </div>
    <div class="card">
      <div class="card-header">IP 属地访问统计 <span id="locationRangeLabel" class="range-label">近30天</span></div>
      <div class="table-container">
        <table><thead><tr><th>属地</th><th>访问人数</th><th>访问次数</th></tr></thead>
        <tbody id="locationStatsBody"><tr><td colspan="3" class="text-center">加载中...</td></tr></tbody></table>
      </div>
    </div>
  </div>
  <footer class="footer">AVL Code 站长统计系统 · Powered by Cloudflare Workers + D1</footer>
  <script src="/static/js/main.js"></script>
  <script>
    let currentRange = 30;
    function updatePageRange(days) {
      currentRange = days;
      const label = days <= 1 ? '近1天' : '近' + days + '天';
      document.getElementById('pageRangeLabel').textContent = label;
      document.getElementById('downloadRangeLabel').textContent = label;
      document.getElementById('locationRangeLabel').textContent = label;
      Promise.all([
        fetch('/admin/api/pages?days=' + days).then(r => r.json()),
        fetch('/admin/api/downloads?days=' + days).then(r => r.json()),
        fetch('/admin/api/locations?days=' + days).then(r => r.json())
      ]).then(([pages, downloads, locations]) => {
        updatePageTable(pages); updateDownloadTable(downloads); updateLocationTable(locations);
      }).catch(err => console.error('加载失败:', err));
    }
    document.addEventListener('DOMContentLoaded', function() { updatePageRange(30); });
  </script>
</body>
</html>`;
}

function renderIpList() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>IP 列表 - AVL Code 站长统计</title>
  <link rel="stylesheet" href="/static/css/style.css">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
</head>
<body>
  <nav class="navbar">
    <a href="/admin" class="navbar-brand">
      <img src="/static/img/avl-code-logo.png" alt="AVL Code" style="height:28px;">
      <span>站长统计</span>
    </a>
    <ul class="navbar-nav">
      <li><a href="/admin">概览</a></li>
      <li><a href="/admin/stats">详细统计</a></li>
      <li><a href="/admin/ips" class="active">IP 列表</a></li>
    </ul>
  </nav>
  <div class="container">
    <div class="card">
      <div class="card-header">IP 地址访问明细
        <div style="display:flex;gap:12px;">
          <input type="text" id="filterLocation" class="form-control" placeholder="筛选属地..." style="width:150px;">
          <input type="text" id="filterDownload" class="form-control" placeholder="筛选下载软件..." style="width:150px;">
          <button class="btn btn-primary btn-sm" onclick="loadIPList()">查询</button>
        </div>
      </div>
      <div class="table-container">
        <table><thead><tr>
          <th style="cursor:pointer" onclick="sortIPList('ip_address')">IP 地址 <span class="sort-icon" data-sort="ip_address">⇅</span></th>
          <th style="cursor:pointer" onclick="sortIPList('location')">所属地 <span class="sort-icon" data-sort="location">⇅</span></th>
          <th style="cursor:pointer" onclick="sortIPList('visit_count')">访问次数 <span class="sort-icon active" data-sort="visit_count">↓</span></th>
          <th style="cursor:pointer" onclick="sortIPList('last_visit')">上次访问时间 <span class="sort-icon" data-sort="last_visit">⇅</span></th>
          <th style="cursor:pointer" onclick="sortIPList('downloads')">下载软件列表 <span class="sort-icon" data-sort="downloads">⇅</span></th>
        </tr></thead>
        <tbody id="ipListBody"><tr><td colspan="5" class="text-center">加载中...</td></tr></tbody></table>
      </div>
      <div class="mt-2 text-center" style="color:var(--avl-text-secondary);font-size:13px;">
        共 <span id="ipTotalCount">0</span> 条记录 | 点击表头可排序 | 支持按属地和下载软件筛选
      </div>
    </div>
  </div>
  <footer class="footer">AVL Code 站长统计系统 · Powered by Cloudflare Workers + D1</footer>
  <script src="/static/js/main.js"></script>
</body>
</html>`;
}

// ==================== 静态资源 ====================
const CSS = `/* AVL Code 风格统一样式 */
:root{--avl-primary:#2563eb;--avl-primary-dark:#1d4ed8;--avl-primary-light:#dbeafe;--avl-bg:#f8fafc;--avl-surface:#ffffff;--avl-text:#1e293b;--avl-text-secondary:#64748b;--avl-border:#e2e8f0;--avl-success:#10b981;--avl-warning:#f59e0b;--avl-danger:#ef4444;--avl-radius:8px;--avl-shadow:0 1px 3px rgba(0,0,0,0.1);}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--avl-bg);color:var(--avl-text);line-height:1.6}
.navbar{background:var(--avl-surface);border-bottom:1px solid var(--avl-border);padding:0 24px;height:64px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100;box-shadow:var(--avl-shadow)}
.navbar-brand{font-size:20px;font-weight:700;color:var(--avl-primary);text-decoration:none;display:flex;align-items:center;gap:10px}
.navbar-brand span{color:var(--avl-text);font-weight:400;font-size:14px}
.navbar-nav{display:flex;gap:8px;list-style:none}
.navbar-nav a{color:var(--avl-text-secondary);text-decoration:none;padding:8px 16px;border-radius:var(--avl-radius);font-size:14px;font-weight:500;transition:all .2s}
.navbar-nav a:hover,.navbar-nav a.active{color:var(--avl-primary);background:var(--avl-primary-light)}
.container{max-width:1400px;margin:0 auto;padding:24px}
.card{background:var(--avl-surface);border-radius:var(--avl-radius);box-shadow:var(--avl-shadow);padding:24px;margin-bottom:24px}
.card-header{font-size:18px;font-weight:600;margin-bottom:20px;padding-bottom:12px;border-bottom:1px solid var(--avl-border);display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.range-label{font-size:14px;font-weight:400;color:var(--avl-text-secondary);margin:0 8px}
.range-select{font-size:14px;padding:4px 8px;border:1px solid var(--avl-border);border-radius:4px;background:var(--avl-surface);color:var(--avl-text);cursor:pointer}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px;margin-bottom:24px}
.stat-card{background:var(--avl-surface);border-radius:var(--avl-radius);padding:20px;box-shadow:var(--avl-shadow);border:1px solid var(--avl-border);display:flex;align-items:center;gap:16px}
.stat-icon{width:48px;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0}
.stat-icon.blue{background:var(--avl-primary-light);color:var(--avl-primary)}
.stat-icon.green{background:#d1fae5;color:var(--avl-success)}
.stat-icon.orange{background:#fef3c7;color:var(--avl-warning)}
.stat-icon.red{background:#fee2e2;color:var(--avl-danger)}
.stat-content h3{font-size:28px;font-weight:700;color:var(--avl-text);line-height:1.2}
.stat-content p{font-size:13px;color:var(--avl-text-secondary);margin-top:4px}
.table-container{overflow-x:auto;border-radius:var(--avl-radius);border:1px solid var(--avl-border)}
table{width:100%;border-collapse:collapse;background:var(--avl-surface);font-size:14px}
th,td{padding:12px 16px;text-align:left;border-bottom:1px solid var(--avl-border)}
th{background:#f1f5f9;font-weight:600;color:var(--avl-text-secondary);font-size:13px;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}
tr:hover td{background:#f8fafc}
td{color:var(--avl-text)}
.btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:var(--avl-radius);font-size:14px;font-weight:500;text-decoration:none;border:1px solid transparent;cursor:pointer;transition:all .2s}
.btn-primary{background:var(--avl-primary);color:white;border-color:var(--avl-primary)}
.btn-outline{background:white;color:var(--avl-primary);border-color:var(--avl-border)}
.btn-outline:hover{background:var(--avl-primary-light);border-color:var(--avl-primary)}
.btn-sm{padding:4px 12px;font-size:13px}
.form-control{padding:8px 12px;border:1px solid var(--avl-border);border-radius:var(--avl-radius);font-size:14px;background:white;color:var(--avl-text);outline:none;transition:border-color .2s}
.form-control:focus{border-color:var(--avl-primary);box-shadow:0 0 0 3px rgba(37,99,235,.1)}
select.form-control{cursor:pointer}
.chart-container{position:relative;height:300px;margin-top:16px}
.chart-container canvas{width:100%!important;height:100%!important}
.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:500;background:var(--avl-primary-light);color:var(--avl-primary)}
.badge-success{background:#d1fae5;color:#065f46}
.footer{text-align:center;padding:24px;color:var(--avl-text-secondary);font-size:13px;border-top:1px solid var(--avl-border);margin-top:40px;background:var(--avl-surface)}
.text-center{text-align:center}.mb-0{margin-bottom:0}.mb-1{margin-bottom:8px}.mb-2{margin-bottom:16px}.mt-2{margin-top:16px}
.sort-icon{display:inline-block;margin-left:4px;opacity:.5;font-size:12px}
.sort-icon.active{opacity:1;color:var(--avl-primary)}
@media(max-width:768px){.container{padding:16px}.stats-grid{grid-template-columns:1fr}.navbar{padding:0 16px}.navbar-brand span{display:none}}`;

const JS = `function formatNumber(num){if(num>=10000)return(num/10000).toFixed(1)+'万';return num.toLocaleString()}
function formatDate(dateStr){if(!dateStr)return '-';const d=new Date(dateStr);return d.toLocaleString('zh-CN')}
async function loadStats(){try{const[summary,hourly,daily,pages,downloads,locations,recent]=await Promise.all([fetch('/admin/api/summary').then(r=>r.json()).catch(()=>null),fetch('/admin/api/hourly?hours=24').then(r=>r.json()).catch(()=>[]),fetch('/admin/api/daily?days=7').then(r=>r.json()).catch(()=>[]),fetch('/admin/api/pages?days=30').then(r=>r.json()).catch(()=>[]),fetch('/admin/api/downloads?days=30').then(r=>r.json()).catch(()=>[]),fetch('/admin/api/locations?days=30').then(r=>r.json()).catch(()=>[]),fetch('/admin/api/recent?limit=10').then(r=>r.json()).catch(()=>[])]);if(summary)updateSummaryCards(summary);updateHourlyChart(hourly||[]);updateDailyChart(daily||[]);updatePageTable(pages||[]);updateDownloadTable(downloads||[]);updateLocationTable(locations||[]);updateRecentTable(recent||[])}catch(e){console.error('加载统计数据失败:',e)}}
function updateSummaryCards(data){const set=(id,val)=>{const el=document.getElementById(id);if(el)el.textContent=formatNumber(val)};set('total-unique',data.total_unique);set('total-views',data.total_views);set('daily-unique',data.daily_unique);set('daily-views',data.daily_views);set('total-downloads',data.total_downloads)}
function updateHourlyChart(data,hours){const ctx=document.getElementById('hourlyChart');if(!ctx)return;const showDate=hours&&hours>24;const labels=data.map(d=>{if(!d.hour)return '';if(showDate)return d.hour.slice(5,16);return d.hour.slice(11,16)});const views=data.map(d=>d.views||0);const visitors=data.map(d=>d.visitors||0);if(window.hourlyChartInstance)window.hourlyChartInstance.destroy();try{window.hourlyChartInstance=new Chart(ctx,{type:'bar',data:{labels:labels,datasets:[{label:'访问次数',data:views,backgroundColor:'rgba(37,99,235,0.8)',borderColor:'rgba(37,99,235,1)',borderWidth:1,borderRadius:4},{label:'访问人数',data:visitors,backgroundColor:'rgba(16,185,129,0.8)',borderColor:'rgba(16,185,129,1)',borderWidth:1,borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top'}},scales:{y:{beginAtZero:true,ticks:{stepSize:1}}}}})}catch(e){console.error('渲染小时图表失败:',e)}}
function updateDailyChart(data,days){const ctx=document.getElementById('dailyChart');if(!ctx)return;const labels=data.map(d=>d.date?d.date.slice(5):'');const views=data.map(d=>d.views||0);const visitors=data.map(d=>d.visitors||0);const downloads=data.map(d=>d.downloads||0);if(window.dailyChartInstance)window.dailyChartInstance.destroy();try{window.dailyChartInstance=new Chart(ctx,{type:'line',data:{labels:labels,datasets:[{label:'访问次数',data:views,borderColor:'rgba(37,99,235,1)',backgroundColor:'rgba(37,99,235,0.1)',fill:true,tension:.3},{label:'访问人数',data:visitors,borderColor:'rgba(16,185,129,1)',backgroundColor:'rgba(16,185,129,0.1)',fill:true,tension:.3},{label:'下载次数',data:downloads,borderColor:'rgba(245,158,11,1)',backgroundColor:'rgba(245,158,11,0.1)',fill:true,tension:.3}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top'}},scales:{y:{beginAtZero:true}}}})}catch(e){console.error('渲染日图表失败:',e)}}
function updatePageTable(data){const tbody=document.getElementById('pageStatsBody');if(!tbody)return;if(data.length===0){tbody.innerHTML='<tr><td colspan="4" class="text-center">暂无数据</td></tr>';return}tbody.innerHTML=data.map(item=>\`<tr><td title="\${item.page_url}">\${item.page_url.length>40?item.page_url.slice(0,40)+'...':item.page_url}</td><td>\${item.views}</td><td>\${item.visitors}</td><td>\${item.avg_duration}s</td></tr>\`).join('')}
function updateDownloadTable(data){const tbody=document.getElementById('downloadStatsBody');if(!tbody)return;if(data.length===0){tbody.innerHTML='<tr><td colspan="2" class="text-center">暂无下载数据</td></tr>';return}tbody.innerHTML=data.map(item=>\`<tr><td>\${item.download_item}</td><td><strong>\${item.count}</strong> 次</td></tr>\`).join('')}
function updateLocationTable(data){const tbody=document.getElementById('locationStatsBody');if(!tbody)return;if(data.length===0){tbody.innerHTML='<tr><td colspan="3" class="text-center">暂无数据</td></tr>';return}tbody.innerHTML=data.map(item=>\`<tr><td>\${item.location}</td><td>\${item.visitors}</td><td>\${item.views}</td></tr>\`).join('')}
function updateRecentTable(data){const tbody=document.getElementById('recentVisitsBody');if(!tbody)return;if(data.length===0){tbody.innerHTML='<tr><td colspan="6" class="text-center">暂无数据</td></tr>';return}tbody.innerHTML=data.map(item=>\`<tr><td>\${item.ip_address}</td><td>\${item.ip_location||'未知'}</td><td title="\${item.page_url}">\${item.page_url.length>30?item.page_url.slice(0,30)+'...':item.page_url}</td><td>\${formatDate(item.visit_time)}</td><td>\${item.duration}s</td><td>\${item.is_download?'<span class="badge badge-success">下载</span>':'<span class="badge">浏览</span>'}</td></tr>\`).join('')}
let currentSort={field:'visit_count',order:'desc'};
async function loadIPList(){const tbody=document.getElementById('ipListBody');if(!tbody)return;tbody.innerHTML='<tr><td colspan="5" class="text-center">加载中...</td></tr>';const location=document.getElementById('filterLocation')?document.getElementById('filterLocation').value:'';const download=document.getElementById('filterDownload')?document.getElementById('filterDownload').value:'';const url='/admin/api/ips?limit=200&location='+encodeURIComponent(location)+'&download='+encodeURIComponent(download);try{const res=await fetch(url);if(!res.ok)throw new Error('HTTP '+res.status);const data=await res.json();renderIPTable(data);const totalEl=document.getElementById('ipTotalCount');if(totalEl)totalEl.textContent=data.length}catch(e){console.error('加载 IP 列表失败:',e);tbody.innerHTML='<tr><td colspan="5" class="text-center" style="color:red;">加载失败，请刷新重试</td></tr>'}}
function renderIPTable(data){const tbody=document.getElementById('ipListBody');if(!tbody)return;data.sort((a,b)=>{let valA=a[currentSort.field];let valB=b[currentSort.field];if(typeof valA==='string')valA=valA.toLowerCase();if(typeof valB==='string')valB=valB.toLowerCase();if(valA<valB)return currentSort.order==='asc'?-1:1;if(valA>valB)return currentSort.order==='asc'?1:-1;return 0});tbody.innerHTML=data.map(item=>\`<tr><td><code>\${item.ip_address}</code></td><td>\${item.location||'未知'}</td><td><strong>\${item.visit_count}</strong></td><td>\${formatDate(item.last_visit)}</td><td>\${item.downloads.length>0?item.downloads.join(', '):'-'}</td></tr>\`).join('')}
function sortIPList(field){if(currentSort.field===field){currentSort.order=currentSort.order==='asc'?'desc':'asc'}else{currentSort.field=field;currentSort.order='desc'}document.querySelectorAll('.sort-icon').forEach(el=>{el.classList.remove('active');el.textContent='⇅'});const activeIcon=document.querySelector('[data-sort="'+field+'"]');if(activeIcon){activeIcon.classList.add('active');activeIcon.textContent=currentSort.order==='asc'?'↑':'↓'}loadIPList()}
document.addEventListener('DOMContentLoaded',function(){if(document.getElementById('total-unique')){loadStats();setInterval(loadStats,30000)}if(document.getElementById('pageStatsBody')){loadStats();setInterval(loadStats,30000)}if(document.getElementById('ipListBody')){loadIPList();const locEl=document.getElementById('filterLocation');const downEl=document.getElementById('filterDownload');if(locEl)locEl.addEventListener('input',loadIPList);if(downEl)downEl.addEventListener('input',loadIPList)}});`;