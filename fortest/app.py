"""
AVL Code 站长统计 - 纯静态测试站点 (fottest)

本文件提供纯静态文件服务 + 下载事件 API 代理。
追踪逻辑完全由前端 JS (static/js/tracker.js) 负责，
直接向 Cloudflare Worker 上报数据。

集成要点：
1. 统计服务器地址硬编码在 static/js/tracker.js 中
2. 页面浏览/停留时长由 tracker.js 自动上报
3. 下载事件通过 /download/ 代理转发到 Worker
4. 通过 /goto-stats 跳转到统计管理后台
"""

import http.server
import json
import os
import socketserver
import urllib.request
from urllib.parse import urlparse

PORT = 8901
HOST = '0.0.0.0'
DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(DIR, 'static')
TEMPLATE_DIR = os.path.join(DIR, 'templates')

# 统计服务器地址（与 tracker.js 保持一致）
STATS_SERVER = os.environ.get('STATS_SERVER', 'https://site.avlcodesite.xyz')

# 静态文件缓存
static_cache = {}

# MIME 类型映射
MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml',
    '.json': 'application/json; charset=utf-8',
}


def get_static_file(path):
    """获取静态文件内容（带缓存）"""
    if path in static_cache:
        return static_cache[path]
    file_path = os.path.join(STATIC_DIR, path.lstrip('/'))
    if not os.path.exists(file_path):
        return None, None
    with open(file_path, 'rb') as f:
        data = f.read()
    ext = os.path.splitext(file_path)[1].lower()
    content_type = MIME_TYPES.get(ext, 'application/octet-stream')
    static_cache[path] = (data, content_type)
    return data, content_type


def get_template(path):
    """获取 HTML 模板文件"""
    file_path = os.path.join(TEMPLATE_DIR, path.lstrip('/'))
    if not os.path.exists(file_path):
        return None
    with open(file_path, 'r', encoding='utf-8') as f:
        return f.read()


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

        # 静态资源
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

        # 页面路由 - 纯静态 HTML
        if path == '/' or path == '/index.html':
            html = get_template('index.html')
            if html:
                self.send_html(html)
                return
        elif path == '/page1':
            html = get_template('page1.html')
            if html:
                self.send_html(html)
                return
        elif path == '/page2':
            html = get_template('page2.html')
            if html:
                self.send_html(html)
                return
        elif path == '/goto-stats':
            # 跳转到统计后台
            self.send_response(302)
            self.send_header('Location', f'{STATS_SERVER}/admin')
            self.end_headers()
            return

        self.send_error(404)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # 下载事件代理 - 转发到 Worker
        if path.startswith('/download/'):
            item = path[len('/download/'):]
            # 通过 Worker 的 track API 上报下载事件
            payload = json.dumps({
                'page_url': '/',
                'page_title': '测试站点',
                'is_download': 1,
                'download_item': item,
                'site_id': 'avlcode'
            }).encode('utf-8')
            try:
                req = urllib.request.Request(
                    f'{STATS_SERVER}/track',
                    data=payload,
                    headers={'Content-Type': 'application/json'},
                    method='POST'
                )
                with urllib.request.urlopen(req, timeout=10) as resp:
                    self.send_json({'status': 'ok', 'message': f'{item} 下载事件已上报'})
            except Exception as e:
                self.send_json({'status': 'error', 'message': str(e)}, 500)
            return

        self.send_error(404)


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


if __name__ == '__main__':
    server = ThreadedHTTPServer((HOST, PORT), TestHandler)
    print(f'AVL Code 测试站点运行在 http://{HOST}:{PORT}')
    print(f'统计后台: {STATS_SERVER}/admin')
    print(f'追踪脚本: /static/js/tracker.js (纯静态)')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n服务已停止')
        server.shutdown()