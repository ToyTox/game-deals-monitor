FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
COPY prisma ./prisma

RUN npm ci --only=production

COPY src ./src
COPY tsconfig.json .

RUN npm run build

RUN npx prisma generate

EXPOSE 3000

CMD ["npm", "start"]
