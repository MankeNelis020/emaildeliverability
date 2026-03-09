FROM mcr.microsoft.com/playwright:v1.57.0-noble


WORKDIR /app


ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright


RUN corepack enable


COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages


RUN pnpm install --frozen-lockfile --prod=false
RUN pnpm --filter @crs/core build
RUN pnpm --filter @crs/scanners build
RUN pnpm --filter @crs/runner build



EXPOSE 8080


CMD ["node", "apps/runner/dist/server.js"]
