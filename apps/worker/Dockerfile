# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
FROM node:22.19.0-alpine3.22@sha256:d2166de198f26e17e5a442f537754dd616ab069c47cc57b889310a717e0abbf9 AS build
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @pdfmason/worker... build
RUN pnpm --filter @pdfmason/worker deploy --prod --legacy /worker

FROM node:22.19.0-alpine3.22@sha256:d2166de198f26e17e5a442f537754dd616ab069c47cc57b889310a717e0abbf9 AS runtime
ENV NODE_ENV=production \
    WORKER_HOST=0.0.0.0 \
    WORKER_PORT=8787
WORKDIR /app
COPY --from=build --chown=node:node /worker/ ./
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8787/health || exit 1
CMD ["node", "dist/index.js"]
