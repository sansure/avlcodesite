// Hello AVL Code - Cloudflare Worker 测试程序
// 用于验证 Cloudflare Workers Git 自动部署流程

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // 根路径返回欢迎页面
    if (url.pathname === '/') {
      return new Response(`
        <!DOCTYPE html>
        <html lang="zh-CN">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Hello AVL Code - Cloudflare Workers</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
            }
            .container { text-align: center; padding: 40px; }
            h1 { font-size: 3em; margin-bottom: 16px; }
            p { font-size: 1.2em; opacity: 0.9; }
            .info {
              margin-top: 32px;
              padding: 16px;
              background: rgba(255,255,255,0.1);
              border-radius: 8px;
              font-family: monospace;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>👋 Hello AVL Code!</h1>
            <p>Cloudflare Workers 部署成功</p>
            <div class="info">
              <div>Worker: hello-avlcode</div>
              <div>Region: ${request.cf?.colo || 'Unknown'}</div>
              <div>Time: ${new Date().toISOString()}</div>
            </div>
          </div>
        </body>
      </html>
      `, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    
    // API 测试端点
    if (url.pathname === '/api/hello') {
      return new Response(JSON.stringify({
        message: 'Hello from Cloudflare Workers!',
        timestamp: new Date().toISOString(),
        cf: {
          colo: request.cf?.colo,
          country: request.cf?.country,
          city: request.cf?.city
        }
      }, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response('Hello AVL Code! Visit / for the welcome page.', {
      headers: { 'Content-Type': 'text/plain' }
    });
  }
};
