# ============================================================
# Music Box - Multi-stage Docker Build
# ============================================================

# ------ Stage 1: API Builder ------
FROM node:18-alpine AS api-builder

WORKDIR /app/server

# .npmrc（legacy-peer-deps）必须先于 npm ci 复制，保证与本地安装行为一致
COPY server/.npmrc ./
COPY server/package.json server/package-lock.json ./
RUN npm ci

COPY server/prisma ./prisma
RUN npx prisma generate

COPY server/ .
RUN npm run build

# 生产镜像瘦身：剔除 jest/eslint/typescript 等全量 devDependencies；
# prune 会连同 node_modules/.prisma 一起清掉，因此随后用同版本 CLI 重新生成客户端
RUN npm prune --omit=dev \
    && npx -y prisma@5.22.0 generate

# ------ Stage 2: API Runtime ------
FROM node:18-alpine AS api-runtime

WORKDIR /app/server

COPY --from=api-builder /app/server/dist ./dist
COPY --from=api-builder /app/server/node_modules ./node_modules
COPY --from=api-builder /app/server/prisma ./prisma
COPY --from=api-builder /app/server/package.json ./

EXPOSE 3000

CMD ["node", "dist/index.js"]

# ------ Stage 3: Frontend Builder ------
FROM node:18-alpine AS frontend-builder

WORKDIR /app

# web 子项目通过相对路径（../../../shared/*）引用共享类型与工具，
# 必须先拷贝 shared/，否则容器内 tsc 报 TS2307（Cannot find module '../../../shared/types'）
COPY shared/ ./shared/

# Build web
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci
COPY web/ ./web/
RUN cd web && npm run build

# Build admin
COPY web/admin/package.json web/admin/package-lock.json* ./web/admin/
RUN cd web/admin && npm ci
COPY web/admin/ ./web/admin/
RUN cd web/admin && npm run build

# Build browse
COPY web/browse/package.json web/browse/package-lock.json ./web/browse/
RUN cd web/browse && npm ci
COPY web/browse/ ./web/browse/
RUN cd web/browse && npm run build

# ------ Stage 4: Web Runtime (Nginx) ------
FROM nginx:alpine AS web-runtime

COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-builder /app/web/dist /usr/share/nginx/html/web
COPY --from=frontend-builder /app/web/admin/dist /usr/share/nginx/html/admin
COPY --from=frontend-builder /app/web/browse/dist /usr/share/nginx/html/browse

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
