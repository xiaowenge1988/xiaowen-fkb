#!/bin/bash
# ============================================================
# 档案卡(xiaowen-fkb) 密钥版部署脚本（免密，主用）
# 前置条件：
#   1. 本地有部署私钥 .deploy/fkb_deploy（与服务器 authorized_keys 配对）
#   2. 服务器已配 /etc/sudoers.d/fkb-deploy（ubuntu 免密 restart/start/stop xiaowen-fkb）
# 用法：在本地项目目录执行  ./deploy.sh
# ============================================================
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
KEY="$DIR/.deploy/fkb_deploy"
HOST=115.159.83.153
USER=ubuntu
REMOTE=/home/ubuntu/xiaowen-fkb

if [ ! -f "$KEY" ]; then
  echo "ERROR: 找不到部署私钥 $KEY" >&2
  echo "请先将私钥放到该路径，或重新生成并 ssh-copy-id 到服务器（见 DEPLOY.md）。" >&2
  exit 1
fi

cd "$DIR"
echo "[1/3] scp 文件 -> $USER@$HOST:$REMOTE/"
scp -i "$KEY" -o StrictHostKeyChecking=no index.html app_v21.js app.js server.js manifest.json sw.js "$USER@$HOST:$REMOTE/"
ssh -i "$KEY" -o StrictHostKeyChecking=no "$USER@$HOST" "mkdir -p $REMOTE/icons"
scp -i "$KEY" -o StrictHostKeyChecking=no -r icons/* "$USER@$HOST:$REMOTE/icons/"
echo "[3/3] 重启服务"
ssh -i "$KEY" -o StrictHostKeyChecking=no "$USER@$HOST" "sudo systemctl restart xiaowen-fkb; sleep 2; sudo systemctl is-active xiaowen-fkb"
echo "DEPLOY_DONE"
