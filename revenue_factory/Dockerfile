FROM node:22-bookworm-slim
RUN apt-get update -qq && apt-get install -y --no-install-recommends ffmpeg fonts-nanum ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY revenue_factory /app/revenue_factory
RUN mkdir -p /data/private /data/output && chown -R node:node /data /app
USER node
ENV REVENUE_DB=/data/private/app.json \
    REVENUE_OUT=/data/output \
    REVENUE_BIND=0.0.0.0 \
    REVENUE_APP_PORT=8040 \
    REVENUE_TRUST_PROXY=1 \
    REVENUE_SECURE_COOKIE=1
EXPOSE 8040
CMD ["node", "revenue_factory/app.mjs"]