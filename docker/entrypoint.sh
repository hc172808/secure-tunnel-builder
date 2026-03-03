#!/bin/bash
# ──────────────────────────────────────────────────────────────
# WireGuard Manager — Docker Entrypoint
# All configuration is read from environment variables (.env.docker)
# Database schema is in /opt/wireguard-manager/db/init.sql
# ──────────────────────────────────────────────────────────────

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[entrypoint]${NC} $1"; }
warn() { echo -e "${YELLOW}[entrypoint]${NC} $1"; }
err()  { echo -e "${RED}[entrypoint]${NC} $1"; }

# ── Defaults from .env ───────────────────────────────────────
DB_NAME="${DB_NAME:-wireguard_manager}"
DB_USER="${DB_USER:-wgadmin}"
DB_PASSWORD="${DB_PASSWORD:?ERROR: DB_PASSWORD must be set in .env.docker}"
DB_VERSION="${DB_VERSION:-14}"
API_PORT="${API_PORT:-3001}"
WG_SERVER_IP="${WG_SERVER_IP:-10.0.0.1}"
WG_NETWORK="${WG_NETWORK:-10.0.0.0/24}"
WG_PORT="${WG_PORT:-51820}"
WG_DNS="${WG_DNS:-1.1.1.1}"
WG_INTERFACE="${WG_INTERFACE:-wg0}"
WG_ENDPOINT="${WG_ENDPOINT:-auto}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@wireguard.local}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-changeme123}"
DDNS_INTERVAL="${DDNS_INTERVAL:-30}"
BACKUP_INTERVAL="${BACKUP_INTERVAL:-24}"
BACKUP_RETENTION="${BACKUP_RETENTION:-7}"

export PGPASSWORD="${DB_PASSWORD}"

# ══════════════════════════════════════════════════════════════
# Step 1: Initialize PostgreSQL
# ══════════════════════════════════════════════════════════════
log "Step 1/7 — Starting PostgreSQL..."
PG_DATA="/var/lib/postgresql/${DB_VERSION}/main"

if [ ! -f "${PG_DATA}/PG_VERSION" ]; then
    log "Initializing fresh database cluster..."
    su - postgres -c "/usr/lib/postgresql/${DB_VERSION}/bin/initdb -D ${PG_DATA}"
fi

su - postgres -c "/usr/lib/postgresql/${DB_VERSION}/bin/pg_ctl start -D ${PG_DATA} -l /var/log/postgresql.log -w"

# Wait for PostgreSQL to be ready
for i in $(seq 1 30); do
    if su - postgres -c "pg_isready" > /dev/null 2>&1; then break; fi
    sleep 1
done

# Create database user and database if needed
su - postgres -c "psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'\" | grep -q 1" || \
    su - postgres -c "psql -c \"CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';\""

su - postgres -c "psql -tc \"SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'\" | grep -q 1" || \
    su - postgres -c "psql -c \"CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};\""

su - postgres -c "psql -c \"GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};\""

log "PostgreSQL ready ✓"

# ══════════════════════════════════════════════════════════════
# Step 2: Run database schema from init.sql
# ══════════════════════════════════════════════════════════════
log "Step 2/7 — Running database migrations..."
SQL_FILE="/opt/wireguard-manager/db/init.sql"

if [ -f "${SQL_FILE}" ]; then
    psql -h localhost -U "${DB_USER}" -d "${DB_NAME}" -f "${SQL_FILE}" 2>&1 | \
        grep -v "already exists" | grep -v "NOTICE" || true
    log "Database schema applied ✓"
else
    err "init.sql not found at ${SQL_FILE}!"
    exit 1
fi

# ══════════════════════════════════════════════════════════════
# Step 3: Generate WireGuard server keys & config
# ══════════════════════════════════════════════════════════════
log "Step 3/7 — Configuring WireGuard..."

if [ ! -f /etc/wireguard/server_private.key ]; then
    wg genkey | tee /etc/wireguard/server_private.key | wg pubkey > /etc/wireguard/server_public.key
    chmod 600 /etc/wireguard/server_private.key
    log "Generated new WireGuard server keys"
fi

SERVER_PRIVATE_KEY=$(cat /etc/wireguard/server_private.key)
SERVER_PUBLIC_KEY=$(cat /etc/wireguard/server_public.key)

# Detect public IP if set to auto
if [ "${WG_ENDPOINT}" = "auto" ]; then
    WG_ENDPOINT=$(curl -s https://api.ipify.org 2>/dev/null || curl -s https://ifconfig.me 2>/dev/null || echo "0.0.0.0")
    log "Detected public IP: ${WG_ENDPOINT}"
fi

# Create WireGuard interface config
if [ ! -f "/etc/wireguard/${WG_INTERFACE}.conf" ]; then
    cat > "/etc/wireguard/${WG_INTERFACE}.conf" <<EOF
[Interface]
Address = ${WG_SERVER_IP}/24
ListenPort = ${WG_PORT}
PrivateKey = ${SERVER_PRIVATE_KEY}
PostUp = iptables -A FORWARD -i ${WG_INTERFACE} -j ACCEPT; iptables -A FORWARD -o ${WG_INTERFACE} -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PostDown = iptables -D FORWARD -i ${WG_INTERFACE} -j ACCEPT; iptables -D FORWARD -o ${WG_INTERFACE} -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE
EOF
    log "Created WireGuard config for ${WG_INTERFACE}"
fi

# Seed server settings into database from env
psql -h localhost -U "${DB_USER}" -d "${DB_NAME}" -c "
    INSERT INTO server_settings (setting_key, setting_value, description) VALUES
        ('server_public_key', '${SERVER_PUBLIC_KEY}', 'WireGuard server public key'),
        ('server_endpoint', '${WG_ENDPOINT}:${WG_PORT}', 'Server endpoint address'),
        ('wg_network', '${WG_NETWORK}', 'VPN network CIDR'),
        ('wg_dns', '${WG_DNS}', 'DNS for peers'),
        ('wg_interface', '${WG_INTERFACE}', 'WireGuard interface name'),
        ('api_port', '${API_PORT}', 'Backend API port')
    ON CONFLICT (setting_key) DO UPDATE SET
        setting_value = EXCLUDED.setting_value,
        updated_at = NOW();
" 2>/dev/null || true

# Start WireGuard
wg-quick up "${WG_INTERFACE}" 2>/dev/null || warn "WireGuard interface may already be up"
log "WireGuard ready ✓"

# ══════════════════════════════════════════════════════════════
# Step 4: Create admin account (first run only)
# ══════════════════════════════════════════════════════════════
log "Step 4/7 — Checking admin account..."

ADMIN_EXISTS=$(psql -h localhost -U "${DB_USER}" -d "${DB_NAME}" -tAc \
    "SELECT COUNT(*) FROM profiles WHERE username = 'admin';" 2>/dev/null || echo "0")

if [ "${ADMIN_EXISTS}" = "0" ]; then
    ADMIN_UUID=$(psql -h localhost -U "${DB_USER}" -d "${DB_NAME}" -tAc \
        "INSERT INTO profiles (user_id, username, display_name)
         VALUES (gen_random_uuid(), 'admin', 'Administrator')
         RETURNING user_id;")
    
    psql -h localhost -U "${DB_USER}" -d "${DB_NAME}" -c "
        INSERT INTO user_roles (user_id, role) VALUES ('${ADMIN_UUID}', 'admin');
    " 2>/dev/null || true
    
    # Store admin credentials for the API to verify
    psql -h localhost -U "${DB_USER}" -d "${DB_NAME}" -c "
        INSERT INTO server_settings (setting_key, setting_value, description) VALUES
            ('admin_email', '${ADMIN_EMAIL}', 'Admin login email'),
            ('admin_password_hash', encode(digest('${ADMIN_PASSWORD}', 'sha256'), 'hex'), 'Admin password hash')
        ON CONFLICT (setting_key) DO UPDATE SET
            setting_value = EXCLUDED.setting_value,
            updated_at = NOW();
    " 2>/dev/null || true

    log "Admin account created: ${ADMIN_EMAIL}"
else
    log "Admin account already exists ✓"
fi

# ══════════════════════════════════════════════════════════════
# Step 5: Configure DDNS from env vars
# ══════════════════════════════════════════════════════════════
log "Step 5/7 — Configuring DDNS..."

if [ -n "${DDNS_PROVIDER}" ] && [ -n "${DDNS_HOSTNAME}" ]; then
    psql -h localhost -U "${DB_USER}" -d "${DB_NAME}" -c "
        INSERT INTO server_settings (setting_key, setting_value) VALUES
            ('ddns_provider', '${DDNS_PROVIDER}'),
            ('noip_hostname', '${DDNS_HOSTNAME}'),
            ('noip_enabled', 'true'),
            ('ddns_cron_interval', '${DDNS_INTERVAL}')
        ON CONFLICT (setting_key) DO UPDATE SET
            setting_value = EXCLUDED.setting_value,
            updated_at = NOW();
    " 2>/dev/null || true

    # Provider-specific credentials from env
    case "${DDNS_PROVIDER}" in
        noip|dynu)
            [ -n "${DDNS_USERNAME}" ] && psql -h localhost -U "${DB_USER}" -d "${DB_NAME}" -c "
                INSERT INTO server_settings (setting_key, setting_value) VALUES
                    ('noip_username', '${DDNS_USERNAME}'),
                    ('noip_password', '${DDNS_PASSWORD}')
                ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value;
            " 2>/dev/null || true
            ;;
        duckdns)
            [ -n "${DDNS_TOKEN}" ] && psql -h localhost -U "${DB_USER}" -d "${DB_NAME}" -c "
                INSERT INTO server_settings (setting_key, setting_value) VALUES
                    ('ddns_duckdns_token', '${DDNS_TOKEN}')
                ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value;
            " 2>/dev/null || true
            ;;
        cloudflare)
            psql -h localhost -U "${DB_USER}" -d "${DB_NAME}" -c "
                INSERT INTO server_settings (setting_key, setting_value) VALUES
                    ('ddns_cloudflare_token', '${DDNS_TOKEN}'),
                    ('ddns_cloudflare_zone_id', '${DDNS_ZONE_ID}'),
                    ('ddns_cloudflare_record_id', '${DDNS_RECORD_ID}')
                ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value;
            " 2>/dev/null || true
            ;;
        freedns)
            [ -n "${DDNS_TOKEN}" ] && psql -h localhost -U "${DB_USER}" -d "${DB_NAME}" -c "
                INSERT INTO server_settings (setting_key, setting_value) VALUES
                    ('ddns_freedns_token', '${DDNS_TOKEN}')
                ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value;
            " 2>/dev/null || true
            ;;
    esac

    # Set up DDNS cron job
    echo "*/${DDNS_INTERVAL} * * * * /opt/wireguard-manager/ddns-update.sh update >> /var/log/ddns-update.log 2>&1" > /etc/cron.d/ddns-update
    chmod 644 /etc/cron.d/ddns-update
    log "DDNS configured: ${DDNS_PROVIDER} → ${DDNS_HOSTNAME} (every ${DDNS_INTERVAL}min) ✓"
else
    log "DDNS not configured (skipped)"
fi

# ══════════════════════════════════════════════════════════════
# Step 6: SSL/TLS Setup
# ══════════════════════════════════════════════════════════════
log "Step 6/7 — SSL/TLS setup..."

if [ "${ENABLE_SSL}" = "true" ] && [ -n "${DOMAIN}" ]; then
    log "Setting up SSL for ${DOMAIN}..."
    # Start nginx temporarily for ACME challenge
    nginx 2>/dev/null || true
    sleep 2
    bash /opt/wireguard-manager/ssl-setup.sh || warn "SSL setup failed, continuing with HTTP"
    nginx -s stop 2>/dev/null || true
    log "SSL configured ✓"
else
    log "SSL not enabled (skipped)"
fi

# ══════════════════════════════════════════════════════════════
# Step 7: Configure backups & start services
# ══════════════════════════════════════════════════════════════
log "Step 7/7 — Starting services..."

# Set up automatic backups if interval > 0
if [ "${BACKUP_INTERVAL}" -gt 0 ] 2>/dev/null; then
    cat > /etc/cron.d/wg-backup <<EOF
0 */${BACKUP_INTERVAL} * * * root pg_dump -h localhost -U ${DB_USER} ${DB_NAME} | gzip > /var/backups/wireguard/db-\$(date +\%Y\%m\%d-\%H\%M).sql.gz && find /var/backups/wireguard -name "db-*.sql.gz" -mtime +${BACKUP_RETENTION} -delete 2>/dev/null
EOF
    chmod 644 /etc/cron.d/wg-backup
    log "Auto-backup every ${BACKUP_INTERVAL}h, keep ${BACKUP_RETENTION} days ✓"
fi

# Generate server token if not set
if [ -z "${SERVER_TOKEN}" ]; then
    SERVER_TOKEN=$(openssl rand -hex 32)
    log "Generated SERVER_TOKEN (save this): ${SERVER_TOKEN}"
fi
export SERVER_TOKEN

# Export all env vars the API needs
export DB_NAME DB_USER DB_PASSWORD API_PORT
export WG_SERVER_IP WG_NETWORK WG_PORT WG_DNS WG_INTERFACE WG_ENDPOINT

log "════════════════════════════════════════════════════════"
log "  WireGuard Manager is starting!"
log "  Web UI:    http://localhost (or https://${DOMAIN:-localhost})"
log "  API:       http://localhost:${API_PORT}"
log "  WireGuard: ${WG_ENDPOINT}:${WG_PORT}"
log "  Admin:     ${ADMIN_EMAIL}"
log "════════════════════════════════════════════════════════"

exec /usr/bin/supervisord -n -c /etc/supervisor/supervisord.conf
