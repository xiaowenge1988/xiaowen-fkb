FROM node:18-alpine

WORKDIR /app

# 复制项目文件
COPY package.json ./
COPY server.js ./
COPY app.js ./
COPY index.html ./
COPY assets/ ./assets/
COPY start.sh ./

# 创建数据目录
RUN mkdir -p data/media

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-3000}/api/health || exit 1

# 启动服务
CMD ["node", "server.js"]
