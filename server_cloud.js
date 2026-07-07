// ============================================================
// WeChat API Relay · 微信云托管版
// 部署到微信云托管后，自动免鉴权调用微信API，无需IP白名单
// Local → 云托管(内网调用微信API) → 微信API
// ============================================================
const http = require('http');
const https = require('https');
const crypto = require('crypto');

// ---- Config ----
const PORT = parseInt(process.env.PORT || '80');
const API_KEY = process.env.RELAY_API_KEY || crypto.randomBytes(32).toString('hex');
const WECHAT_API_HOST = 'api.weixin.qq.com';

if (!process.env.RELAY_API_KEY) {
    console.warn('⚠️  RELAY_API_KEY not set, using random key:', API_KEY);
}

// ---- Helpers ----
function parseBody(req) {
    return new Promise((resolve) => {
        let chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks)));
    });
}

function parseMultipart(boundary, buffer) {
    const parts = [];
    const str = buffer.toString('binary');
    const boundaryMarker = '--' + boundary;
    const sections = str.split(boundaryMarker).slice(1, -1);
    for (const section of sections) {
        const headerEnd = section.indexOf('\r\n\r\n');
        if (headerEnd < 0) continue;
        const headerStr = section.substring(0, headerEnd);
        const body = Buffer.from(section.substring(headerEnd + 4), 'binary');
        const nameMatch = headerStr.match(/name="([^"]+)"/);
        const filenameMatch = headerStr.match(/filename="([^"]+)"/);
        parts.push({
            name: nameMatch ? nameMatch[1] : '',
            filename: filenameMatch ? filenameMatch[1] : null,
            data: body,
            contentType: (headerStr.match(/Content-Type:\s*(.+)/i) || [,'image/png'])[1]
        });
    }
    return parts;
}

function buildMultipart(parts, boundary) {
    const buffers = [];
    for (const part of parts) {
        buffers.push(Buffer.from(`--${boundary}\r\n`, 'utf8'));
        if (part.filename) {
            buffers.push(Buffer.from(
                `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n` +
                `Content-Type: ${part.contentType}\r\n\r\n`, 'utf8'));
            buffers.push(part.data);
            buffers.push(Buffer.from('\r\n', 'utf8'));
        } else {
            buffers.push(Buffer.from(
                `Content-Disposition: form-data; name="${part.name}"\r\n\r\n`, 'utf8'));
            buffers.push(Buffer.from(part.data + '\r\n', 'utf8'));
        }
    }
    buffers.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
    return Buffer.concat(buffers);
}

function wechatRequest(pathWithQuery, method, headers, body) {
    return new Promise((resolve, reject) => {
        const [path, query] = pathWithQuery.split('?');
        const fullPath = path + (query ? '?' + query : '');
        const req = https.request({
            hostname: WECHAT_API_HOST, port: 443,
            path: fullPath, method: method || 'POST',
            headers: { ...headers, 'Host': WECHAT_API_HOST },
            timeout: 30000,
            rejectUnauthorized: false,
        }, (res) => {
            let data = [];
            res.on('data', c => data.push(c));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(data) }));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        if (body) req.write(body);
        req.end();
    });
}

function checkAuth(req) {
    const auth = req.headers['authorization'] || '';
    return auth.replace(/^Bearer\s+/i, '') === API_KEY;
}

// ---- Router ----
const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    const url = new URL(req.url, `http://localhost:${PORT}`);

    try {
        // Health check (no auth required)
        if (url.pathname === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ ok: true, time: new Date().toISOString(), mode: 'cloudrun' }));
        }

        // Auth required for relay endpoints
        if (!checkAuth(req)) {
            res.writeHead(401);
            return res.end(JSON.stringify({ error: 'Unauthorized' }));
        }

        const wechatPath = req.headers['x-wechat-path'];
        if (!wechatPath) {
            res.writeHead(400);
            return res.end(JSON.stringify({ error: 'Missing X-WeChat-Path header' }));
        }

        if (url.pathname === '/relay/json') {
            // JSON relay
            const body = await parseBody(req);
            const result = await wechatRequest(wechatPath, 'POST',
                { 'Content-Type': 'application/json', 'Content-Length': body.length || 0 },
                body.length > 0 ? body : undefined);
            res.writeHead(result.status, { 'Content-Type': 'application/json' });
            return res.end(result.body);
        }

        if (url.pathname === '/relay/upload') {
            // File upload relay
            const contentType = req.headers['content-type'] || '';
            const bm = contentType.match(/boundary=(.+)/);
            if (!bm) { res.writeHead(400); return res.end(JSON.stringify({ error: 'Expected multipart/form-data' })); }
            const body = await parseBody(req);
            const parts = parseMultipart(bm[1], body);
            const newBoundary = '----WxCloud' + Date.now();
            const fwdBody = buildMultipart(parts, newBoundary);
            const result = await wechatRequest(wechatPath, 'POST',
                { 'Content-Type': `multipart/form-data; boundary=${newBoundary}`, 'Content-Length': fwdBody.length },
                fwdBody);
            res.writeHead(result.status, { 'Content-Type': 'application/json' });
            return res.end(result.body);
        }

        res.writeHead(404);
        return res.end(JSON.stringify({ error: 'Not found', path: url.pathname }));
    } catch (e) {
        console.error('Error:', e);
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Internal error', detail: e.message }));
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log('WeChat API Relay [cloudrun mode]');
    console.log('Port:', PORT);
    console.log('API Key:', API_KEY.substring(0, 8) + '...');
    console.log('Endpoints: /health, /relay/json, /relay/upload');
});
