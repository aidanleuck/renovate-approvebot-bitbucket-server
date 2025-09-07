FROM node:22.19.0-alpine@sha256:d2166de198f26e17e5a442f537754dd616ab069c47cc57b889310a717e0abbf9

LABEL \
  org.opencontainers.image.source="https://github.com/aidanleuck/renovate-approvebot-bitbucket-server" \
  org.opencontainers.image.url="https://github.com/aidanleuck/renovate-approvebot-bitbucket-server" \
  org.opencontainers.image.licenses="ISC"

WORKDIR /opt/app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev

# Copy application code
COPY index.js ./
COPY src/ ./src/

USER 1000:1000

CMD ["index.js"]