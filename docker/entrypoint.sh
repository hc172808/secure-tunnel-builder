#!/bin/bash
# ──────────────────────────────────────────────────────────────
# WireGuard Manager — Docker Entrypoint
# Initializes all services on container start
# ──────────────────────────────────────────────────────────────

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo -e "${GREEN}[entrypoint]${NC} $1"; }
warn() { echo -e "${YELLOW}[entrypoint]${NC} $1"; }

# ── Step 1: Initialize PostgreSQL ────────────────────────────
log "Starting PostgreSQL..."
if [ ! -f /var/lib/postgresql/14/main/PG_VERSION ]; then
    log "Initializing fresh database..."
    su - postgres -c "/usr/lib/postgresql/14/bin/initdb -D /var/lib/postgresql/14/main"
fi

su - postgres -c "/usr/lib/postgresql/14/bin/pg_ctl start -D /var/lib/postgresql/14/main -l /var/log/postgresql.log -w"

# Wait for PostgreSQL
for i in $(seq 1 30); do
    if su - postgres -c "pg_isready" > /dev/null 2>&1; then break; fi
    sleep 1
done

# Create database and user if needed
su - postgres -c "psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'\" | grep -q 1" || \
    su - postgres -c "psql -c \"CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';\""

su - postgres -c "psql -tc \"SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'\" | grep -q 1" || \
    su - postgres -c "psql -c \"CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};\""

su - postgres -c "psql -c \"GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};\""

# ── Step 2: Run database migrations ─────────────────────────
log "Running database migrations..."
export PGPASSWORD="${DB_PASSWORD}"
psql -h localhost -U "${DB_USER}" -d "${DB_NAME}" <<'MIGRATIONS'
-- Core tables (idempotent)
CREATE TABLE IF NOT EXISTS server_settings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    setting_key TEXT NOT NULL UNIQUE,
    setting_value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID
);

CREATE TABLE IF NOT EXISTS wireguard_peers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    public_key TEXT NOT NULL,
    private_key TEXT,
    allowed_ips TEXT DEFAULT '10.0.0.0/24',
    endpoint TEXT,
    dns TEXT DEFAULT '1.1.1.1',
    status TEXT DEFAULT 'disconnected',
    persistent_keepalive INT DEFAULT 25,
    last_handshake TIMESTAMPTZ,
    transfer_rx BIGINT DEFAULT 0,
    transfer_tx BIGINT DEFAULT 0,
    subdomain TEXT,
    hostname TEXT,
    group_id UUID,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id UUID,
    details JSONB,
    ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS traffic_stats (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    peer_id UUID NOT NULL REFERENCES wireguard_peers(id) ON DELETE CASCADE,
    rx_bytes BIGINT DEFAULT 0,
    tx_bytes BIGINT DEFAULT 0,
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS firewall_rules (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    source_ip TEXT,
    destination_ip TEXT,
    protocol TEXT DEFAULT 'any',
    port TEXT,
    action TEXT DEFAULT 'allow',
    priority INT DEFAULT 100,
    enabled BOOLEAN DEFAULT true,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS peer_groups (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#3b82f6',
    description TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_notification_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    peer_id UUID REFERENCES wireguard_peers(id) ON DELETE SET NULL,
    peer_name TEXT NOT NULL,
    event_type TEXT NOT NULL,
    recipient_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    error_message TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
MIGRATIONS

# ── Step 3: Generate WireGuard server keys ───────────────────
log "Configuring WireGuard..."
if [ ! -f /etc/wireguard/server_private.key ]; then
    wg genkey | tee /etc/wireguard/server_private.key | wg pubkey > /etc/wireguard/server_public.key
    chmod 600 /etc/wireguard/server_private.key
    log "Generated new WireGuard server keys"
fi

SERVER_PRIVATE_KEY=$(cat /etc/wireguard/server_private.key)
SERVER_PUBLIC_KEY=$(cat /etc/wireguard/server_public.key)

# Detect public IP
if [ "${WG_ENDPOINT}" = "auto" ]; then
    WG_ENDPOINT=$(curl -s https://api.ipify.org 2>/dev/null || curl -s https://ifconfig.me 2>/dev/null || echo "0.0.0.0")
    log "Detected public IP: ${WG_ENDPOINT}"
fi

# Create wg0 config if not exists
if [ ! -f /etc/wireguard/wg0.conf ]; then
    cat > /etc/wireguard/wg0.conf <<EOF
[Interface]
Address = ${WG_SERVER_IP}/24
ListenPort = ${WG_PORT}
PrivateKey = ${SERVER_PRIVATE_KEY}
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -A FORWARD -o wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -D FORWARD -o wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE
EOF
    log "Created WireGuard config"
fi

# Save server settings to database
psql -h localhost -U "${DB_USER}" -d "${DB_NAME}" -c "
    INSERT INTO server_settings (setting_key, setting_value, description) VALUES
        ('server_public_key', '${SERVER_PUBLIC_KEY}', 'WireGuard server public key'),
        ('server_endpoint', '${WG_ENDPOINT}:${WG_PORT}', 'Server endpoint'),
        ('wg_network', '${WG_NETWORK}', 'VPN network CIDR')
    ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW();
" 2>/dev/null || true

# Start WireGuard
wg-quick up wg0 2>/dev/null || warn "WireGuard interface may already be up"

# ── Step 4: Configure DDNS if set ────────────────────────────
if [ -n "${DDNS_PROVIDER}" ] && [ -n "${DDNS_HOSTNAME}" ]; then
    log "Configuring DDNS (${DDNS_PROVIDER})..."
    psql -h localhost -U "${DB_USER}" -d "${DB_NAME}" -c "
        INSERT INTO server_settings (setting_key, setting_value) VALUES
            ('ddns_provider', '${DDNS_PROVIDER}'),
            ('noip_hostname', '${DDNS_HOSTNAME}'),
            ('noip_enabled', 'true'),
            ('ddns_cron_interval', '${DDNS_INTERVAL}')
        ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW();
    " 2>/dev/null || true

    # Provider-specific credentials
    case "${DDNS_PROVIDER}" in
        noip|dynu)
            psql -h localhost -U "${DB_USER}" -d "${DB_NAME}" -c "
                INSERT INTO server_settings (setting_key, setting_value) VALUES
                    ('noip_username', '${DDNS_USERNAME}'),
                    ('noip_password', '${DDNS_PASSWORD}')
                ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value;
            " 2>/dev/null || true
            ;;
        duckdns)
            psql -h localhost -U "${DB_USER}" -d "${DB_NAME}" -c "
                INSERT INTO server_settings (setting_key, setting_value) VALUES
                    ('ddns_duckdns_token', '${DDNS_TOKEN}')
                ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value;
            " 2>/dev/null || true
            ;;
    esac

    # Set up cron for DDNS
    echo "*/${DDNS_INTERVAL} * * * * /opt/wireguard-manager/ddns-update.sh update >> /var/log/ddns-update.log 2>&1" > /etc/cron.d/ddns-update
    log "DDNS cron set to every ${DDNS_INTERVAL} minutes"
fi

# ── Step 5: SSL/TLS Setup ────────────────────────────────────
if [ "${ENABLE_SSL}" = "true" ] && [ -n "${DOMAIN}" ]; then
    log "Setting up SSL/TLS for ${DOMAIN}..."
    # Start nginx temporarily for ACME challenge
    nginx 2>/dev/null || true
    sleep 2
    bash /opt/wireguard-manager/ssl-setup.sh || warn "SSL setup failed, continuing with HTTP"
    nginx -s stop 2>/dev/null || true
fi

# ── Step 6: Start services via supervisor ────────────────────
log "Starting services..."
exec /usr/bin/supervisord -n -c /etc/supervisor/supervisord.conf
