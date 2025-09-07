FROM node:22.19.0-alpine@sha256:d2166de198f26e17e5a442f537754dd616ab069c47cc57b889310a717e0abbf9

LABEL \
  org.opencontainers.image.source="https://github.com/aidanleuck/renovate-approvebot-bitbucket-server" \
  org.opencontainers.image.url="https://github.com/aidanleuck/renovate-approvebot-bitbucket-server" \
  org.opencontainers.image.licenses="ISC"

WORKDIR /opt/app

# Copy package files
COPY package.json package-lock.json tsconfig.json ./

# Install dependencies, build, and clean up in a single layer to reduce image size
COPY src/ ./src/
COPY index.ts ./
RUN npm install && \
    npm run build && \
    rm -rf node_modules && \
    npm ci --omit=dev

USER 1000:1000

CMD ["node", "dist/index.js"]