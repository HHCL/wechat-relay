# WeChat API Relay · 部署指南

## 一、架构

```
你的电脑 (动态IP) → VPS 中继服务器 (固定IP) → 微信 API
                     ↑ 白名单只需加一次
```

## 二、部署中继服务器

### 前置条件
- 一台有**固定公网 IP** 的 VPS（阿里云 ECS / 腾讯云轻量 / 任何 VPS）
- 最低配置：1核 512MB 内存即可
- 安装 Node.js 20+ 或 Docker

### 方式 A：Docker（推荐）

```bash
# 1. 上传 relay 目录到 VPS
scp -r relay/ user@your-vps:/opt/wechat-relay/

# 2. SSH 进入 VPS
ssh user@your-vps
cd /opt/wechat-relay

# 3. 生成 API Key（或自己设定）
export RELAY_API_KEY=$(openssl rand -hex 32)
echo "RELAY_API_KEY=$RELAY_API_KEY" >> .env

# 4. 构建并启动
docker build -t wechat-relay .
docker run -d --restart=always --name wechat-relay \
  -p 3456:3456 \
  -e RELAY_API_KEY="$RELAY_API_KEY" \
  wechat-relay

# 5. 验证
curl http://localhost:3456/health
```

### 方式 B：直接 Node.js

```bash
# 1. 上传并安装
scp -r relay/ user@your-vps:/opt/wechat-relay/
ssh user@your-vps
cd /opt/wechat-relay

# 2. 安装 PM2（进程守护）
npm install -g pm2

# 3. 设置 API Key 并启动
export RELAY_API_KEY=$(openssl rand -hex 32)
pm2 start server.js --name wechat-relay -e "RELAY_API_KEY=$RELAY_API_KEY"
pm2 save
pm2 startup  # 开机自启

# 4. 验证
curl http://localhost:3456/health
```

### 方式 C：systemd（生产推荐）

```bash
# 创建服务文件
sudo tee /etc/systemd/system/wechat-relay.service << 'EOF'
[Unit]
Description=WeChat API Relay Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/wechat-relay
Environment=RELAY_PORT=3456
Environment=RELAY_API_KEY=YOUR_GENERATED_KEY_HERE
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now wechat-relay
sudo systemctl status wechat-relay
```

## 三、配置防火墙

确保 VPS 防火墙放行 `3456` 端口（仅允许你本地 IP 访问更安全）：

```bash
# 仅允许特定 IP（推荐）
iptables -A INPUT -p tcp --dport 3456 -s YOUR_HOME_IP -j ACCEPT
iptables -A INPUT -p tcp --dport 3456 -j DROP

# 或全部开放（不推荐）
iptables -A INPUT -p tcp --dport 3456 -j ACCEPT
```

> ⚠️ 云服务器还需要在**安全组/防火墙**规则中放行 3456 端口

## 四、微信白名单配置

1. 登录微信公众平台 → 设置与开发 → 基本配置 → IP 白名单
2. 添加 **VPS 的公网 IP**（只需一次！）
3. 保存

## 五、本地配置

在中继部署完成后，设置环境变量：

```powershell
# 在 run_dispatch.ps1 中添加
$env:WECHAT_RELAY_URL = "http://YOUR_VPS_IP:3456"
$env:WECHAT_RELAY_KEY = "YOUR_API_KEY"
```

之后本地脚本会自动通过中继调用微信 API，不再依赖本地 IP 白名单。

## 六、测试

```bash
# 从本地测试中继是否可达
curl http://YOUR_VPS_IP:3456/health

# 测试 JSON 转发
curl -X POST http://YOUR_VPS_IP:3456/relay/json \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "X-WeChat-Path: /cgi-bin/stable_token" \
  -H "Content-Type: application/json" \
  -d '{"grant_type":"client_credential","appid":"wx6ebdd2a9fea3cd34","secret":"xxx"}'
```
