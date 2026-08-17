# Next.js production image. NEXT_PUBLIC_* are inlined at build time from
# .env.local (copied in below), so the browser bundle is baked here, not at run.
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
