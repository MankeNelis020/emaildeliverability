FROM mcr.microsoft.com/playwright:v1.57.0-noble


WORKDIR /app


ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright


RUN corepack enable


COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages


RUN pnpm install --frozen-lockfile
RUN pnpm -r build


EXPOSE 8080


CMD ["node", "apps/runner/dist/server.js"]
