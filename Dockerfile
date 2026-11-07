FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV VA_HOST=0.0.0.0
ENV VA_DATA_DIR=/data
ENV NODE_ENV=production
EXPOSE 8787
CMD ["npm", "start"]
