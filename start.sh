#!/bin/bash
# 小闻房客宝 - 启动脚本（后端服务器 + SSH隧道）
# 用法：bash start.sh

cd "$(dirname "$0")"
NODE="/Users/mac/.workbuddy/binaries/node/versions/24.14.0/bin/node"

# 1. 停止旧进程
lsof -ti:3000 | xargs kill -9 2>/dev/null
pkill -f "ssh.*localhost.run" 2>/dev/null
sleep 1

# 2. 启动后端服务器
echo "正在启动后端服务器..."
$NODE server.js > /tmp/fkb-server.log 2>&1 &
SERVER_PID=$!
sleep 2

# 验证服务器
if curl -s http://localhost:3000/api/health > /dev/null 2>&1; then
  echo "✅ 后端服务器已启动 (PID: $SERVER_PID)"
else
  echo "❌ 后端服务器启动失败，请检查 /tmp/fkb-server.log"
  exit 1
fi

# 3. 启动 SSH 隧道（localhost.run 免费隧道）
echo "正在建立公网隧道..."
ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -R 80:localhost:3000 nokey@localhost.run > /tmp/fkb-tunnel.log 2>&1 &
TUNNEL_PID=$!
sleep 8

# 提取隧道 URL
TUNNEL_URL=$(grep -oE 'https://[a-z0-9]+\.lhr\.life' /tmp/fkb-tunnel.log | head -1)

if [ -n "$TUNNEL_URL" ]; then
  echo ""
  echo "╔══════════════════════════════════════════════╗"
  echo "║   小闻房客宝 v5.0 已启动！                   ║"
  echo "╠══════════════════════════════════════════════╣"
  echo "║                                              ║"
  echo "║  电脑访问: http://localhost:3000            ║"
  echo "║  手机访问: $TUNNEL_URL     ║"
  echo "║  局域网:   http://192.168.1.71:3000         ║"
  echo "║                                              ║"
  echo "║  数据自动云端同步，电脑手机实时互通          ║"
  echo "║  按 Ctrl+C 停止服务                          ║"
  echo "╚══════════════════════════════════════════════╝"
  echo ""
  echo "隧道URL已保存到: /tmp/fkb-tunnel-url.txt"
  echo "$TUNNEL_URL" > /tmp/fkb-tunnel-url.txt
  
  # 保持运行
  wait $TUNNEL_PID
else
  echo "⚠️  隧道建立失败，但本地服务可用"
  echo "   电脑访问: http://localhost:3000"
  echo "   局域网:   http://192.168.1.71:3000"
  echo ""
  echo "   手机和电脑在同一WiFi时可用局域网地址访问"
  wait $SERVER_PID
fi
