# 小闻房客宝 - 部署说明

## 本地运行
```bash
node server.js
# 访问 http://localhost:3000
```

## 云端部署 (Koyeb)

### 前置条件
- 注册 GitHub 账号
- 注册 Koyeb 账号 (https://app.koyeb.com) - 用 GitHub 登录

### 部署步骤
1. 将代码推送到 GitHub 仓库
2. 在 Koyeb 控制台创建新服务
3. 选择 "GitHub" 部署方式
4. 选择仓库和分支
5. 配置:
   - Builder: Dockerfile
   - Port: 3000
   - Volume: 挂载 /app/data 目录 (2GB)
6. 部署完成后获得固定URL: https://xxx.koyeb.app

### 环境变量
- PORT: 服务端口 (默认3000, Koyeb会自动设置)
