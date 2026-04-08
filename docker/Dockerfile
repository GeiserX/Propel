FROM node:22-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Generate Prisma client
FROM base AS prisma
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY prisma ./prisma
COPY prisma.config.ts ./
ENV DATABASE_URL="postgresql://mock:mock@localhost:5432/mock"
RUN npx prisma generate

# Build the application
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=prisma /app/src/generated ./src/generated
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL="postgresql://mock:mock@localhost:5432/mock"
RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

LABEL org.opencontainers.image.title="Pumperly" \
      org.opencontainers.image.description="Open-source energy route planner for fuel and electric vehicles. Self-hostable." \
      org.opencontainers.image.url="https://pumperly.com" \
      org.opencontainers.image.source="https://github.com/GeiserX/Pumperly" \
      org.opencontainers.image.documentation="https://github.com/GeiserX/Pumperly#readme" \
      org.opencontainers.image.vendor="GeiserX" \
      org.opencontainers.image.licenses="GPL-3.0-only" \
      io.artifacthub.package.readme-url="https://raw.githubusercontent.com/GeiserX/Pumperly/main/README.md" \
      io.artifacthub.package.license="GPL-3.0-only" \
      io.artifacthub.package.keywords="fuel,gas,electric,ev,route,planner,price,comparison,self-hosted" \
      io.artifacthub.package.maintainers="[{\"name\":\"GeiserX\",\"email\":\"9169332+GeiserX@users.noreply.github.com\"}]" \
      io.artifacthub.package.category="integration-delivery"

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
