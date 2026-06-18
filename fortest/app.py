"""
AVL Code 站长统计 - 集成示例测试站点 (fottest)

本文件演示了如何将站长统计功能集成到现有网站中。
可作为集成到 www.avlcode.cn 的参考模板。

集成要点：
1. 配置统计服务器地址 STATS_SERVER
2. 在页面加载时调用 track_to_stats() 发送浏览数据
3. 在下载事件中调用 track_to_stats() 发送下载数据
4. 通过 /goto-stats 链接到统计管理后台
"""

import http.server
import socketserver
import json
import os
import re
from datetime import datetime
from urllib.parse import urlparse, parse_qs, unquote

PORT = 8901
HOST = '0.0.0.0'  # 监听所有网卡
DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(DIR, 'static')  # 共享主 static 目录
TEMPLATE_DIR = os.path.join(DIR, 'templates')

# 【集成必改】统计服务器地址，指向 Cloudflare Worker
STATS_SERVER = os.environ.get('STATS_SERVER', 'https://stats-tracker.sansure-huang.workers.dev')

# 模板渲染
def render_template(template_name, context=None):
    if context is None:
        context = {}
    path = os.path.join(TEMPLATE_DIR, template_name)
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    def replace_var(m):
        key = m.group(1)
        return str(context.get(key, ''))
    content = re.sub(r'\{\{\s*(\w+)\s*\}\}', replace_var, content)
    return content

# 静态文件缓存
static_cache = {}

def get_static_file(path):
    if path in static_cache:
        return static_cache[path]
    file_path = os.path.join(STATIC_DIR, path.lstrip('/'))
    if not os.path.exists(file_path):
        return None, None
    with open(file_path, 'rb') as f:
        data = f.read()
    ext = os.path.splitext(file_path)[1].lower()
    content_type = 'text/html'
    if ext == '.css':
        content_type = 'text/css'
    elif ext == '.js':
        content_type = 'application/javascript'
    elif ext in ('.png', '.jpg', '.jpeg', '.gif', '.ico'):
        content_type = 'image/' + ext.lstrip('.')
    elif ext == '.svg':
        content_type = 'image/svg+xml'
    static_cache[path] = (data, content_type)
    return data, content_type

def track_to_stats(page_url, page_title='', duration=0, is_download=0, download_item=''):
    """
    【集成核心】发送访问数据到统计服务器
    
    在现有网站集成时，可在以下时机调用：
    - 页面加载时：track_to_stats(page_url, page_title)
    - 页面卸载时：track_to_stats(page_url, page_title, duration=duration)
    - 下载事件：track_to_stats(page_url, page_title, is_download=1, download_item='软件名')
    """
    try:
        import urllib.request
        data = json.dumps({
            'page_url': page_url,
            'page_title': page_title,
            'duration': duration,
            'is_download': is_download,
            'download_item': download_item
        }).encode('utf-8')
        req = urllib.request.Request(
            f'{STATS_SERVER}/track',
            data=data,
            headers={'Content-Type': 'application/json'},
            method='POST'
        urllib.request.urlopen(req, timeout=10)
        print(f'追踪发送成功: {STATS_SERVER}/track')
    except Exception as e:
        print(f'追踪发送失败: {e}')

def get_total_views():
    """获取统计后台的总访问人数，用于在页脚展示"""
    try:
        import urllib.request
        req = urllib.request.Request(f'{STATS_SERVER}/admin/api/summary', method='GET')
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
            return data.get('total_unique', 0)
    except Exception:
        return 0

class TestHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass
    
    def send_html(self, html, code=200):
        self.send_response(code)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(html.encode('utf-8'))
    
    def send_json(self, data, code=200):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))
    
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        # 【集成示例】动态生成追踪 JS
        if path == '/static/js/tracker.js':
            js = f'''
            (function() {
                var AVL_STATS_URL = '{STATS_SERVER}/track';
                var AVL_STATS_IMG_URL = '{STATS_SERVER}/track/view';
                
                window.AVLStats = {
                    track: function(data) {
                        if (navigator.sendBeacon) {
                            navigator.sendBeacon(AVL_STATS_URL, JSON.stringify(data));
                        } else {
                            fetch(AVL_STATS_URL, {
                                method: 'POST',
                                headers: {'Content-Type': 'application/json'},
                                body: JSON.stringify(data)
                            });
                        }
                    },
                    trackView: function(page_url, page_title) {
                        var img = new Image();
                        img.src = AVL_STATS_IMG_URL + '?page_url=' + encodeURIComponent(page_url) + '&page_title=' + encodeURIComponent(page_title || document.title);
                    },
                    trackDownload: function(item_name) {
                        this.track({
                            page_url: window.location.pathname,
                            page_title: document.title,
                            is_download: 1,
                            download_item: item_name
                        });
                    }
                };
                
                // 自动追踪页面浏览
                window.addEventListener('load', function() {
                    AVLStats.trackView(window.location.pathname, document.title);
                    window.__pageLoadTime = Date.now();
                });
                
                // 追踪页面停留时长
                window.addEventListener('beforeunload', function() {
                    var duration = Math.round((Date.now() - (window.__pageLoadTime || Date.now())) / 1000);
                    AVLStats.track({
                        page_url: window.location.pathname,
                        page_title: document.title,
                        duration: duration
                    });
                });
            }})();
            '''
            self.send_response(200)
            self.send_header('Content-Type', 'application/javascript; charset=utf-8')
            self.end_headers()
            self.wfile.write(js.encode('utf-8'))
            return
        
        if path.startswith('/static/'):
            static_path = path[len('/static/'):]
            result = get_static_file('/' + static_path)
            if result[0]:
                self.send_response(200)
                self.send_header('Content-Type', result[1])
                self.end_headers()
                self.wfile.write(result[0])
                return
            self.send_error(404)
            return
        
        total = get_total_views()
        
        # 【集成示例】页面路由 - 每个页面都发送追踪数据
        if path == '/' or path == '/index.html':
            track_to_stats('/', '测试主页')  # 记录页面浏览
            html = render_template('index.html', {'total_views': total})
            self.send_html(html)
            return
        elif path == '/page1':
            track_to_stats('/page1', '子功能页 1')
            html = render_template('page1.html', {'total_views': total})
            self.send_html(html)
            return
        elif path == '/page2':
            track_to_stats('/page2', '子功能页 2')
            html = render_template('page2.html', {'total_views': total})
            self.send_html(html)
            return
        elif path == '/goto-stats':
            # 【集成示例】跳转到统计后台
            self.send_response(302)
            self.send_header('Location', f'{STATS_SERVER}/admin')
            self.end_headers()
            return
        
        self.send_error(404)
    
    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        
        # 【集成示例】下载追踪路由
        if path.startswith('/download/'):
            item = path[len('/download/'):]
            if item == 'software1':
                track_to_stats('/', '下载软件A', is_download=1, download_item='软件A')
                self.send_json({'status': 'ok', 'message': '软件A 下载请求已记录'})
            elif item == 'software2':
                track_to_stats('/', '下载软件B', is_download=1, download_item='软件B')
                self.send_json({'status': 'ok', 'message': '软件B 下载请求已记录'})
            else:
                self.send_error(404)
            return
        
        self.send_error(404)

class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True

if __name__ == '__main__':
    server = ThreadedHTTPServer((HOST, PORT), TestHandler)
    print(f'AVL Code 测试站点运行在 http://{HOST}:{PORT}')
    print(f'统计后台: {STATS_SERVER}/admin')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n服务已停止')
        server.shutdown()
