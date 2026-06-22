// AVL Code 站长统计 - Cloudflare Workers + D1 版本

// ==================== 密码验证与 Session 管理 ====================
// PBKDF2-SHA256 密码哈希
async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// 生成随机 Token
function generateToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  for (let i = 0; i < 64; i++) {
    token += chars[array[i] % chars.length];
  }
  return 'sess_' + token;
}

// 从 Cookie 中获取 Token
function getTokenFromCookie(request) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/(?:^|;\s*)admin_token=([^;]+)/);
  return match ? match[1] : null;
}

// 验证 Session Token（返回 user_id 或 null）
async function verifySession(env, token) {
  if (!token) return null;
  try {
    const row = await env.DB.prepare(
      'SELECT user_id, expires_at FROM sessions WHERE token = ?'
    ).bind(token).first();
    if (!row) return null;
    if (new Date(row.expires_at) < new Date()) {
      // Token 过期，清理
      await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
      return null;
    }
    return row.user_id;
  } catch (e) {
    return null;
  }
}

// 设置 Cookie 响应头
function setCookieHeader(token, maxAge = 86400) {
  return `admin_token=${token}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

// 清除 Cookie 响应头
function clearCookieHeader() {
  return 'admin_token=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax';
}

// 检查请求是否已登录，未登录返回登录页面
async function requireAdmin(request, env, corsHeaders) {
  const token = getTokenFromCookie(request);
  const userId = await verifySession(env, token);
  if (!userId) {
    return new Response(renderLoginPage(), {
      status: 401,
      headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders }
    });
  }
  return null; // 已登录
}

// 登录页面 HTML
function renderLoginPage(errorMsg) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>管理员登录 - AVL Code 站长统计</title>
  <link rel="stylesheet" href="/static/css/style.css">
  <style>
    .login-wrapper{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--avl-bg);padding:24px}
    .login-card{background:var(--avl-surface);border-radius:var(--avl-radius);box-shadow:0 4px 24px rgba(0,0,0,0.12);padding:40px;width:100%;max-width:400px}
    .login-logo{text-align:center;margin-bottom:32px}
    .login-logo img{height:40px;margin-bottom:12px}
    .login-logo h1{font-size:22px;font-weight:700;color:var(--avl-text)}
    .login-logo p{font-size:14px;color:var(--avl-text-secondary);margin-top:4px}
    .form-group{margin-bottom:20px}
    .form-group label{display:block;font-size:14px;font-weight:500;color:var(--avl-text);margin-bottom:6px}
    .form-group input{width:100%;padding:10px 14px;border:1px solid var(--avl-border);border-radius:var(--avl-radius);font-size:15px;outline:none;transition:border-color .2s}
    .form-group input:focus{border-color:var(--avl-primary);box-shadow:0 0 0 3px rgba(37,99,235,.1)}
    .login-btn{width:100%;padding:12px;background:var(--avl-primary);color:white;border:none;border-radius:var(--avl-radius);font-size:16px;font-weight:600;cursor:pointer;transition:background .2s}
    .login-btn:hover{background:var(--avl-primary-dark)}
    .login-btn:disabled{opacity:.6;cursor:not-allowed}
    .error-msg{background:#fee2e2;color:#b91c1c;padding:10px 14px;border-radius:var(--avl-radius);font-size:14px;margin-bottom:20px;display:${errorMsg ? 'block' : 'none'}}
    .login-footer{text-align:center;margin-top:24px;font-size:13px;color:var(--avl-text-secondary)}
  </style>
</head>
<body>
  <div class="login-wrapper">
    <div class="login-card">
      <div class="login-logo">
        <img src="/static/img/avl-code-logo.png" alt="AVL Code">
        <h1>管理员登录</h1>
        <p>AVL Code 站长统计系统</p>
      </div>
      <div class="error-msg" id="errorMsg">${errorMsg || ''}</div>
      <form id="loginForm" onsubmit="return handleLogin(event)">
        <div class="form-group">
          <label for="username">用户名</label>
          <input type="text" id="username" name="username" placeholder="请输入用户名" required autocomplete="username">
        </div>
        <div class="form-group">
          <label for="password">密码</label>
          <input type="password" id="password" name="password" placeholder="请输入密码" required autocomplete="current-password">
        </div>
        <button type="submit" class="login-btn" id="loginBtn">登 录</button>
      </form>
      <div class="login-footer">
        &copy; 2024 AVL Code · Powered by Cloudflare Workers
      </div>
    </div>
  </div>
  <script>
    async function handleLogin(e) {
      e.preventDefault();
      const btn = document.getElementById('loginBtn');
      const errEl = document.getElementById('errorMsg');
      btn.disabled = true;
      btn.textContent = '登录中...';
      errEl.style.display = 'none';
      try {
        const resp = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: document.getElementById('username').value,
            password: document.getElementById('password').value
          })
        });
        const data = await resp.json();
        if (resp.ok && data.success) {
          window.location.href = '/admin';
        } else {
          errEl.textContent = data.error || '用户名或密码错误';
          errEl.style.display = 'block';
          btn.disabled = false;
          btn.textContent = '登 录';
        }
      } catch(e) {
        errEl.textContent = '网络错误，请重试';
        errEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = '登 录';
      }
      return false;
    }
  </script>
</body>
</html>`;
}

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

    // ===== 认证 API（不需要登录） =====
    if (path === '/api/auth/login' && request.method === 'POST') {
      return handleLoginApi(request, env, corsHeaders);
    }
    if (path === '/api/auth/logout' && request.method === 'POST') {
      return handleLogoutApi(request, env, corsHeaders);
    }

    // ===== 管理后台页面（需要登录验证） =====
    if (path === '/admin' || path === '/admin/' || path === '/admin/stats' || path === '/admin/ips') {
      // 检查登录状态
      const token = getTokenFromCookie(request);
      const userId = await verifySession(env, token);
      if (!userId) {
        return new Response(renderLoginPage(), {
          status: 401,
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
      // 默认 /admin
      return new Response(renderDashboard(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders }
      });
    }

    // API 路由（需要登录验证）
    if (path.startsWith('/admin/api/')) {
      const token = getTokenFromCookie(request);
      const userId = await verifySession(env, token);
      if (!userId) {
        return new Response(JSON.stringify({ error: '未登录' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
      return handleAdminApi(request, env, corsHeaders);
    }

    // 追踪接口
    if (path === '/track' && request.method === 'POST') {
      return handleTrack(request, env, corsHeaders);
    }
    if (path === '/track/view') {
      return handleTrackView(corsHeaders);
    }

    // 根路径返回管理后台（需要登录）
    if (path === '/' || path === '') {
      const token = getTokenFromCookie(request);
      const userId = await verifySession(env, token);
      if (!userId) {
        return new Response(renderLoginPage(), {
          status: 401,
          headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders }
        });
      }
      return new Response(renderDashboard(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders }
      });
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
  
  // Logo PNG - embedded as base64
  if (file === 'img/avl-code-logo.png') {
    const b64 = "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";
    const binaryStr = atob(b64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return new Response(bytes, {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', ...corsHeaders }
    });
  }
  
  const files = {
    'css/style.css': CSS,
    'js/main.js': JS,
  };
  
  const content = files[file];
  if (content === undefined) {
    return new Response('Not Found', { status: 404, headers: corsHeaders });
  }
  
  let contentType = 'text/plain';
  if (file.endsWith('.css')) contentType = 'text/css';
  else if (file.endsWith('.js')) contentType = 'application/javascript';
  
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
    // 1. 查 D1 缓存（兼容新旧表结构）
    let cached = null;
    try {
      cached = await env.DB.prepare(
        'SELECT country, region, city FROM geo_cache WHERE ip = ?'
      ).bind(ip).first();
    } catch (e) {
      // 缓存查询失败不影响主流程
    }
    
    if (cached) {
      return [cached.country, cached.region, cached.city].filter(Boolean).join(' ') || '未知';
    }
    
    // 2. 调用在线 API（ip-api.com，免费版 45 次/分钟，够用）
    let location = '未知';
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(`http://ip-api.com/json/${ip}?lang=zh-CN`, {
        headers: { 'User-Agent': 'AVLCode-Stats/1.0' },
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      if (resp.ok) {
        const data = await resp.json();
        if (data.status === 'success') {
          const country = data.country || '';
          const region = data.regionName || '';
          const city = data.city || '';
          location = [country, region, city].filter(Boolean).join(' ') || country || '未知';
        }
      }
    } catch (e) {
      // 网络错误，静默处理
    }
    
    // 3. 写入 D1 缓存（忽略失败）
    try {
      await env.DB.prepare(
        'INSERT OR REPLACE INTO geo_cache (ip, country, region, city, cached_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(ip, location === '未知' ? '' : location.split(' ')[0], location === '未知' ? '' : location.split(' ')[1] || '', location === '未知' ? '' : location.split(' ').slice(2).join(' ') || '', new Date().toISOString()).run();
    } catch (e) {
      // 忽略缓存写入失败
    }
    
    return location;
  } catch (err) {
    return '未知';
  }
}

// ==================== 认证 API ====================
async function handleLoginApi(request, env, corsHeaders) {
  try {
    const { username, password } = await request.json();
    
    if (!username || !password) {
      return new Response(JSON.stringify({ success: false, error: '请输入用户名和密码' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // 查询用户
    const user = await env.DB.prepare(
      'SELECT id, username, password_hash, salt FROM users WHERE username = ?'
    ).bind(username).first();

    if (!user) {
      return new Response(JSON.stringify({ success: false, error: '用户名或密码错误' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // 验证密码
    const hash = await hashPassword(password, user.salt);
    if (hash !== user.password_hash) {
      return new Response(JSON.stringify({ success: false, error: '用户名或密码错误' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // 生成 Session Token（有效期 24 小时）
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 86400000).toISOString();
    
    await env.DB.prepare(
      'INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)'
    ).bind(user.id, token, expiresAt).run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': setCookieHeader(token),
        ...corsHeaders
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: '服务器错误: ' + err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}

async function handleLogoutApi(request, env, corsHeaders) {
  try {
    const token = getTokenFromCookie(request);
    if (token) {
      await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    }
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': clearCookieHeader(),
        ...corsHeaders
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}


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
      <li style="margin-left:auto;"><a href="#" onclick="handleLogout();return false;" style="color:var(--avl-text-secondary);">退出登录</a></li>
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
    }
  </script>
  <script>
    async function handleLogout() {
      if (!confirm('确定要退出登录吗？')) return;
      try {
        const resp = await fetch('/api/auth/logout', { method: 'POST' });
        const data = await resp.json();
        if (data.success) window.location.href = '/admin';
      } catch(e) { console.error('退出失败:', e); }
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
      <li style="margin-left:auto;"><a href="#" onclick="handleLogout();return false;" style="color:var(--avl-text-secondary);">退出登录</a></li>
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
    document.addEventListener('DOMContentLoaded', function() { updatePageRange(30); });
  </script>
  <script>
    async function handleLogout() {
      if (!confirm('确定要退出登录吗？')) return;
      try {
        const resp = await fetch('/api/auth/logout', { method: 'POST' });
        const data = await resp.json();
        if (data.success) window.location.href = '/admin';
      } catch(e) { console.error('退出失败:', e); }
    }
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
      <li style="margin-left:auto;"><a href="#" onclick="handleLogout();return false;" style="color:var(--avl-text-secondary);">退出登录</a></li>
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
  <script>
    async function handleLogout() {
      if (!confirm('确定要退出登录吗？')) return;
      try {
        const resp = await fetch('/api/auth/logout', { method: 'POST' });
        const data = await resp.json();
        if (data.success) window.location.href = '/admin';
      } catch(e) { console.error('退出失败:', e); }
    }
  </script>
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