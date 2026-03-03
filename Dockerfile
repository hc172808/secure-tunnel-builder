# ──────────────────────────────────────────────────────────────
# WireGuard Manager — Multi-Stage Dockerfile
# Builds frontend + backend + WireGuard in a single image
# ──────────────────────────────────────────────────────────────

# ─── Stage 1: Build the React Frontend ────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /app

# Install dependencies first (cache layer)
COPY package.json package-lock.json* bun.lockb* ./
RUN npm install --legacy-peer-deps

# Copy source & build
COPY . .
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_SUPABASE_PROJECT_ID
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
ENV VITE_SUPABASE_PUBLISHABLE_KEY=${VITE_SUPABASE_PUBLISHABLE_KEY}
ENV VITE_SUPABASE_PROJECT_ID=${VITE_SUPABASE_PROJECT_ID}
RUN npm run build


# ─── Stage 2: Runtime (WireGuard + Nginx + Node API) ─────────
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC

# ── Step 1: System packages ──────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    wireguard \
    wireguard-tools \
    iptables \
    iproute2 \
    curl \
    jq \
    nginx \
    postgresql \
    postgresql-client \
    nodejs \
    npm \
    cron \
    supervisor \
    openssl \
    ca-certificates \
    net-tools \
    procps \
    qrencode \
    certbot \
    python3-certbot-nginx \
    && rm -rf /var/lib/apt/lists/*

# Ensure Node.js 20 (if default repo is older)
RUN npm install -g n && n 20 && npm install -g pm2

# ── Step 2: Create directory structure ───────────────────────
RUN mkdir -p \
    /opt/wireguard-manager/api \
    /var/www/wireguard-dashboard \
    /var/www/certbot \
    /var/backups/wireguard \
    /etc/wireguard \
    /var/log/wireguard-manager

# ── Step 3: Copy built frontend ──────────────────────────────
COPY --from=frontend-builder /app/dist /var/www/wireguard-dashboard

# ── Step 4: Backend API setup ────────────────────────────────
COPY docker/api/ /opt/wireguard-manager/api/
WORKDIR /opt/wireguard-manager/api
RUN npm install --production 2>/dev/null || true

# ── Step 5: Copy SQL init file & scripts ─────────────────────
COPY docker/db/ /opt/wireguard-manager/db/
COPY docker/scripts/ /opt/wireguard-manager/
RUN chmod +x /opt/wireguard-manager/*.sh 2>/dev/null || true

# ── Step 6: Nginx configuration ─────────────────────────────
COPY docker/nginx/default.conf /etc/nginx/sites-available/default
COPY docker/nginx/ssl.conf /etc/nginx/sites-available/ssl.conf

# ── Step 7: Supervisor config (process manager) ──────────────
COPY docker/supervisor/ /etc/supervisor/conf.d/

# ── Step 8: Entrypoint script ───────────────────────────────
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# ── Step 9: Create symlinks for CLI tools ────────────────────
RUN ln -sf /opt/wireguard-manager/ddns-update.sh /usr/local/bin/wg-ddns 2>/dev/null || true && \
    ln -sf /opt/wireguard-manager/manager.sh /usr/local/bin/wg-manager 2>/dev/null || true

# ── Ports ────────────────────────────────────────────────────
# 80   = HTTP (Nginx → frontend + API proxy)
# 443  = HTTPS (if TLS configured)
# 51820 = WireGuard UDP
# 3001 = Backend API (internal, proxied by Nginx)
EXPOSE 80 443 51820/udp 3001

# ── Health check ─────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -sf http://localhost:3001/health || exit 1

# ── Volumes ──────────────────────────────────────────────────
VOLUME ["/etc/wireguard", "/var/lib/postgresql", "/var/backups/wireguard"]

ENTRYPOINT ["/entrypoint.sh"]
