FROM node:20-alpine

WORKDIR /app

# better-sqlite3 — нативный модуль, ему нужен тулчейн на этапе установки
RUN apk add --no-cache python3 make g++

# На этапе сборки образа БД ещё недоступна: миграции применяются при старте (npm start)
ENV SKIP_DB_MIGRATE=1

COPY package*.json tsconfig.json prisma.config.ts ./
COPY prisma ./prisma
COPY scripts ./scripts

# postinstall сам делает prisma generate
RUN npm ci

COPY src ./src
COPY public ./public

RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
