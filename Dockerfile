# 构建阶段：仅在构建时拉取 npm 依赖；产物是纯静态文件，运行时不访问任何在线服务。
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src

# 一次性验收目标：Vitest（含类型检查、小规模穷举核对与 5 万项性能用例），退出码即验收结论
FROM build AS verify
CMD ["npm", "test"]

# 运行阶段：静态文件服务器
FROM nginx:1.27-alpine AS serve
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx-default.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
