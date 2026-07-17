# 小闻房客宝 - 部署说明

## 本地运行
```bash
node server.js
# 访问 http://localhost:3000
```

## 云端部署（推荐 Koyeb）

### 前置条件
- GitHub 仓库已创建：https://github.com/xiaowenge1988/xiaowen-fkb
- 注册 Koyeb 账号 (https://app.koyeb.com) - 用 GitHub 登录

### 部署步骤
1. 打开 https://app.koyeb.com
2. 点击 **Create Web Service**
3. 选择 **GitHub** 部署方式
4. 选择仓库 `xiaowenge1988/xiaowen-fkb`，分支 `master`
5. 配置:
   - Builder: **Dockerfile**
   - Port: **3000**
   - Health Check Path: `/api/health`
6. 点击 **Deploy**
7. 等2-3分钟构建完成
8. 获得固定URL: `https://xxx.koyeb.app`

### 备选方案：Render
1. 打开 https://render.com
2. 点击 **New** → **Web Service**
3. 连接 GitHub，选择 `xiaowenge1988/xiaowen-fkb` 仓库
4. Render 会自动识别 `render.yaml` 配置
5. 点击 **Create Web Service**
6. 获得固定URL: `https://xiaowen-fkb.onrender.com`

### 环境变量
- PORT: 服务端口 (默认3000，云平台会自动设置)

### 关于数据持久性
- 文本数据（客户/房源/成交）会自动从浏览器本地缓存恢复到云端
- 图片/视频存储在浏览器 IndexedDB 中，跨设备访问时需重新上传
- 代码更新后推送到 GitHub，云平台会自动重新部署
