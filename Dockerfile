FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
COPY prisma ./prisma

RUN npm ci

COPY src ./src
COPY public ./public
COPY tsconfig.json .

RUN npx prisma generate

RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
