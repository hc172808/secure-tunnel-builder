#!/bin/bash

#######################################
# WireGuard VPN Server Installation Script
# For Ubuntu 22.04 LTS
# Includes: WireGuard, PostgreSQL, API Sync Service
#######################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
WG_INTERFACE="wg0"
WG_PORT="51820"
WG_NETWORK="10.0.0.0/24"
WG_SERVER_IP="10.0.0.1"
DB_NAME="wireguard_manager"
DB_USER="wgadmin"
SERVICE_NAME="wg-api-sync"
INSTALL_DIR="/opt/wireguard-manager"
BACKUP_DIR="/var/backups/wireguard"
CONFIG_FILE="${INSTALL_DIR}/config.env"

print_header() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

check_root() {
    if [[ $EUID -ne 0 ]]; then
        print_error "This script must be run as root"
        exit 1
    fi
}

check_ubuntu() {
    if ! grep -q "Ubuntu 22" /etc/os-release; then
        print_warning "This script is designed for Ubuntu 22.04. Proceed with caution."
    fi
}

get_public_ip() {
    PUBLIC_IP=$(curl -s https://api.ipify.org || curl -s https://ifconfig.me || hostname -I | awk '{print $1}')
    echo "$PUBLIC_IP"
}

install_dependencies() {
    print_header "Installing Dependencies"
    
    apt-get update
    apt-get install -y \
        wireguard \
        wireguard-tools \
        qrencode \
        postgresql \
        postgresql-contrib \
        curl \
        jq \
        cron \
        ufw \
        net-tools \
        iptables-persistent
    
    print_success "Dependencies installed"
}

setup_postgresql() {
    print_header "Setting Up PostgreSQL"
    
    # Generate random password
    DB_PASSWORD=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 24)
    
    # Start PostgreSQL
    systemctl start postgresql
    systemctl enable postgresql
    
    # Create database and user
    sudo -u postgres psql <<EOF
DROP DATABASE IF EXISTS ${DB_NAME};
DROP USER IF EXISTS ${DB_USER};
CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';
CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
EOF
    
    # Create tables
    sudo -u postgres psql -d ${DB_NAME} <<EOF
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- App role enum
CREATE TYPE app_role AS ENUM ('admin', 'user');

-- Profiles table
CREATE TABLE profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE,
    username TEXT,
    display_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User roles table
CREATE TABLE user_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    role app_role DEFAULT 'user',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, role)
);

-- WireGuard peers table
CREATE TABLE wireguard_peers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    public_key TEXT NOT NULL UNIQUE,
    private_key TEXT,
    allowed_ips TEXT DEFAULT '10.0.0.0/24',
    endpoint TEXT,
    dns TEXT DEFAULT '1.1.1.1',
    persistent_keepalive INTEGER DEFAULT 25,
    status TEXT DEFAULT 'disconnected',
    last_handshake TIMESTAMPTZ,
    transfer_rx BIGINT DEFAULT 0,
    transfer_tx BIGINT DEFAULT 0,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Server settings table
CREATE TABLE server_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    setting_key TEXT NOT NULL UNIQUE,
    setting_value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID
);

-- Peer assignments table
CREATE TABLE peer_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    peer_id UUID NOT NULL REFERENCES wireguard_peers(id) ON DELETE CASCADE,
    assigned_by UUID,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, peer_id)
);

-- Traffic stats table
CREATE TABLE traffic_stats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    peer_id UUID NOT NULL REFERENCES wireguard_peers(id) ON DELETE CASCADE,
    rx_bytes BIGINT DEFAULT 0,
    tx_bytes BIGINT DEFAULT 0,
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit logs table
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id UUID,
    details JSONB,
    ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Grant permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${DB_USER};
EOF
    
    print_success "PostgreSQL configured with database: ${DB_NAME}"
}

setup_wireguard() {
    print_header "Setting Up WireGuard"
    
    PUBLIC_IP=$(get_public_ip)
    
    # Generate server keys
    WG_PRIVATE_KEY=$(wg genkey)
    WG_PUBLIC_KEY=$(echo "$WG_PRIVATE_KEY" | wg pubkey)
    
    # Create WireGuard configuration
    mkdir -p /etc/wireguard
    
    cat > /etc/wireguard/${WG_INTERFACE}.conf <<EOF
[Interface]
Address = ${WG_SERVER_IP}/24
ListenPort = ${WG_PORT}
PrivateKey = ${WG_PRIVATE_KEY}

# Enable IP forwarding
PostUp = sysctl -w net.ipv4.ip_forward=1
PostUp = iptables -A FORWARD -i %i -j ACCEPT
PostUp = iptables -A FORWARD -o %i -j ACCEPT
PostUp = iptables -t nat -A POSTROUTING -o $(ip route | grep default | awk '{print $5}') -j MASQUERADE

PostDown = iptables -D FORWARD -i %i -j ACCEPT
PostDown = iptables -D FORWARD -o %i -j ACCEPT
PostDown = iptables -t nat -D POSTROUTING -o $(ip route | grep default | awk '{print $5}') -j MASQUERADE

# Peers will be added dynamically
EOF
    
    chmod 600 /etc/wireguard/${WG_INTERFACE}.conf
    
    # Enable IP forwarding permanently
    echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf
    sysctl -p
    
    # Enable and start WireGuard
    systemctl enable wg-quick@${WG_INTERFACE}
    systemctl start wg-quick@${WG_INTERFACE}
    
    # Configure firewall
    ufw allow ${WG_PORT}/udp
    ufw allow 22/tcp
    ufw --force enable
    
    print_success "WireGuard configured on ${PUBLIC_IP}:${WG_PORT}"
    echo "Public Key: ${WG_PUBLIC_KEY}"
}

create_api_sync_service() {
    print_header "Creating API Sync Service"
    
    mkdir -p ${INSTALL_DIR}
    mkdir -p ${BACKUP_DIR}
    
    # Create sync script
    cat > ${INSTALL_DIR}/sync.sh <<'SYNCEOF'
#!/bin/bash

source /opt/wireguard-manager/config.env

WG_INTERFACE="wg0"

get_uptime() {
    local uptime_seconds=$(cat /proc/uptime | awk '{print int($1)}')
    local days=$((uptime_seconds / 86400))
    local hours=$(( (uptime_seconds % 86400) / 3600 ))
    local minutes=$(( (uptime_seconds % 3600) / 60 ))
    echo "${days}d ${hours}h ${minutes}m"
}

get_wg_status() {
    local status=$(wg show ${WG_INTERFACE} 2>/dev/null)
    if [ -z "$status" ]; then
        echo "false"
    else
        echo "true"
    fi
}

get_peer_data() {
    wg show ${WG_INTERFACE} dump 2>/dev/null | tail -n +2 | while read line; do
        public_key=$(echo "$line" | awk '{print $1}')
        endpoint=$(echo "$line" | awk '{print $3}')
        allowed_ips=$(echo "$line" | awk '{print $4}')
        latest_handshake=$(echo "$line" | awk '{print $5}')
        transfer_rx=$(echo "$line" | awk '{print $6}')
        transfer_tx=$(echo "$line" | awk '{print $7}')
        
        echo "{\"public_key\":\"$public_key\",\"endpoint\":\"$endpoint\",\"allowed_ips\":\"$allowed_ips\",\"latest_handshake\":$latest_handshake,\"transfer_rx\":$transfer_rx,\"transfer_tx\":$transfer_tx}"
    done | jq -s '.'
}

# Build status payload
is_running=$(get_wg_status)
public_key=$(wg show ${WG_INTERFACE} public-key 2>/dev/null || echo "")
listen_port=$(wg show ${WG_INTERFACE} listen-port 2>/dev/null || echo "${WG_PORT}")
uptime=$(get_uptime)
peers=$(get_peer_data)

if [ -z "$peers" ]; then
    peers="[]"
fi

# Create JSON payload
payload=$(cat <<EOF
{
    "is_running": ${is_running},
    "public_key": "${public_key}",
    "endpoint": "${SERVER_ENDPOINT}",
    "listen_port": ${listen_port:-51820},
    "uptime": "${uptime}",
    "peers": ${peers}
}
EOF
)

# Sync with cloud API if enabled
if [ "${CLOUD_SYNC_ENABLED}" = "true" ] && [ -n "${CLOUD_API_URL}" ]; then
    curl -s -X POST "${CLOUD_API_URL}/wireguard-api/sync-status" \
        -H "Content-Type: application/json" \
        -H "x-server-token: ${SERVER_TOKEN}" \
        -d "$payload" || echo "Cloud sync failed"
fi

# Always update local database
export PGPASSWORD="${DB_PASSWORD}"
psql -h localhost -U ${DB_USER} -d ${DB_NAME} -c "
    INSERT INTO server_settings (setting_key, setting_value, updated_at)
    VALUES 
        ('is_running', '${is_running}', NOW()),
        ('public_key', '${public_key}', NOW()),
        ('endpoint', '${SERVER_ENDPOINT}', NOW()),
        ('listen_port', '${listen_port:-51820}', NOW()),
        ('uptime', '${uptime}', NOW())
    ON CONFLICT (setting_key) DO UPDATE SET
        setting_value = EXCLUDED.setting_value,
        updated_at = NOW();
"

# Update peer statuses in local database
echo "$peers" | jq -c '.[]' | while read peer; do
    pk=$(echo "$peer" | jq -r '.public_key')
    ep=$(echo "$peer" | jq -r '.endpoint')
    lh=$(echo "$peer" | jq -r '.latest_handshake')
    rx=$(echo "$peer" | jq -r '.transfer_rx')
    tx=$(echo "$peer" | jq -r '.transfer_tx')
    
    status="disconnected"
    if [ "$lh" != "0" ] && [ "$lh" != "null" ]; then
        status="connected"
        lh_ts=$(date -d "@$lh" '+%Y-%m-%d %H:%M:%S%z' 2>/dev/null || echo "")
    else
        lh_ts=""
    fi
    
    psql -h localhost -U ${DB_USER} -d ${DB_NAME} -c "
        UPDATE wireguard_peers SET
            status = '${status}',
            endpoint = NULLIF('${ep}', '(none)'),
            last_handshake = $([ -n "$lh_ts" ] && echo "'${lh_ts}'" || echo "NULL"),
            transfer_rx = ${rx:-0},
            transfer_tx = ${tx:-0},
            updated_at = NOW()
        WHERE public_key = '${pk}';
        
        INSERT INTO traffic_stats (peer_id, rx_bytes, tx_bytes)
        SELECT id, ${rx:-0}, ${tx:-0}
        FROM wireguard_peers
        WHERE public_key = '${pk}';
    " 2>/dev/null
done

echo "$(date): Sync completed" >> /var/log/wg-sync.log
SYNCEOF
    
    chmod +x ${INSTALL_DIR}/sync.sh
    
    # Create peer management script
    cat > ${INSTALL_DIR}/manage-peer.sh <<'PEEREOF'
#!/bin/bash

source /opt/wireguard-manager/config.env

ACTION=$1
PEER_NAME=$2
WG_INTERFACE="wg0"

get_next_ip() {
    export PGPASSWORD="${DB_PASSWORD}"
    last_ip=$(psql -h localhost -U ${DB_USER} -d ${DB_NAME} -t -c "
        SELECT allowed_ips FROM wireguard_peers 
        WHERE allowed_ips LIKE '10.0.0.%' 
        ORDER BY created_at DESC LIMIT 1;
    " | tr -d ' ' | cut -d'/' -f1)
    
    if [ -z "$last_ip" ]; then
        echo "10.0.0.2"
    else
        last_octet=$(echo "$last_ip" | cut -d'.' -f4)
        next_octet=$((last_octet + 1))
        echo "10.0.0.${next_octet}"
    fi
}

add_peer() {
    local name=$1
    local private_key=$(wg genkey)
    local public_key=$(echo "$private_key" | wg pubkey)
    local peer_ip=$(get_next_ip)
    local server_public_key=$(wg show ${WG_INTERFACE} public-key)
    
    # Add to WireGuard
    wg set ${WG_INTERFACE} peer ${public_key} allowed-ips ${peer_ip}/32
    wg-quick save ${WG_INTERFACE}
    
    # Add to database
    export PGPASSWORD="${DB_PASSWORD}"
    peer_id=$(psql -h localhost -U ${DB_USER} -d ${DB_NAME} -t -c "
        INSERT INTO wireguard_peers (name, public_key, private_key, allowed_ips, dns)
        VALUES ('${name}', '${public_key}', '${private_key}', '${peer_ip}/32', '1.1.1.1')
        RETURNING id;
    " | tr -d ' ')
    
    # Generate client config
    client_config="[Interface]
PrivateKey = ${private_key}
Address = ${peer_ip}/32
DNS = 1.1.1.1

[Peer]
PublicKey = ${server_public_key}
AllowedIPs = 0.0.0.0/0
Endpoint = ${SERVER_ENDPOINT}:${WG_PORT}
PersistentKeepalive = 25"
    
    echo "Peer added successfully!"
    echo "Peer ID: ${peer_id}"
    echo ""
    echo "Client Configuration:"
    echo "--------------------"
    echo "$client_config"
    echo ""
    echo "QR Code:"
    echo "$client_config" | qrencode -t ansiutf8
}

remove_peer() {
    local name=$1
    
    export PGPASSWORD="${DB_PASSWORD}"
    public_key=$(psql -h localhost -U ${DB_USER} -d ${DB_NAME} -t -c "
        SELECT public_key FROM wireguard_peers WHERE name = '${name}';
    " | tr -d ' ')
    
    if [ -z "$public_key" ]; then
        echo "Peer not found: ${name}"
        exit 1
    fi
    
    # Remove from WireGuard
    wg set ${WG_INTERFACE} peer ${public_key} remove
    wg-quick save ${WG_INTERFACE}
    
    # Remove from database
    psql -h localhost -U ${DB_USER} -d ${DB_NAME} -c "
        DELETE FROM wireguard_peers WHERE name = '${name}';
    "
    
    echo "Peer removed: ${name}"
}

list_peers() {
    export PGPASSWORD="${DB_PASSWORD}"
    psql -h localhost -U ${DB_USER} -d ${DB_NAME} -c "
        SELECT name, status, allowed_ips, 
               COALESCE(to_char(last_handshake, 'YYYY-MM-DD HH24:MI:SS'), 'Never') as last_seen,
               pg_size_pretty(transfer_rx) as download,
               pg_size_pretty(transfer_tx) as upload
        FROM wireguard_peers
        ORDER BY created_at;
    "
}

case $ACTION in
    add)
        if [ -z "$PEER_NAME" ]; then
            echo "Usage: $0 add <peer_name>"
            exit 1
        fi
        add_peer "$PEER_NAME"
        ;;
    remove)
        if [ -z "$PEER_NAME" ]; then
            echo "Usage: $0 remove <peer_name>"
            exit 1
        fi
        remove_peer "$PEER_NAME"
        ;;
    list)
        list_peers
        ;;
    *)
        echo "Usage: $0 {add|remove|list} [peer_name]"
        exit 1
        ;;
esac
PEEREOF
    
    chmod +x ${INSTALL_DIR}/manage-peer.sh
    
    # Create backup script
    cat > ${INSTALL_DIR}/backup.sh <<'BACKUPEOF'
#!/bin/bash

source /opt/wireguard-manager/config.env

BACKUP_DIR="/var/backups/wireguard"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/backup_${TIMESTAMP}.tar.gz"

mkdir -p ${BACKUP_DIR}

# Export database
export PGPASSWORD="${DB_PASSWORD}"
pg_dump -h localhost -U ${DB_USER} -d ${DB_NAME} > ${BACKUP_DIR}/database_${TIMESTAMP}.sql

# Copy WireGuard config
cp /etc/wireguard/wg0.conf ${BACKUP_DIR}/wg0_${TIMESTAMP}.conf

# Create archive
tar -czf ${BACKUP_FILE} \
    -C ${BACKUP_DIR} \
    database_${TIMESTAMP}.sql \
    wg0_${TIMESTAMP}.conf \
    -C /opt/wireguard-manager \
    config.env

# Cleanup temp files
rm -f ${BACKUP_DIR}/database_${TIMESTAMP}.sql
rm -f ${BACKUP_DIR}/wg0_${TIMESTAMP}.conf

# Keep only last 7 backups
ls -t ${BACKUP_DIR}/backup_*.tar.gz | tail -n +8 | xargs -r rm

echo "Backup created: ${BACKUP_FILE}"

# Optional: Upload to cloud
if [ "${CLOUD_SYNC_ENABLED}" = "true" ] && [ -n "${CLOUD_API_URL}" ]; then
    backup_data=$(cat ${BACKUP_FILE} | base64)
    curl -s -X POST "${CLOUD_API_URL}/wireguard-api/backup" \
        -H "Content-Type: application/json" \
        -H "x-server-token: ${SERVER_TOKEN}" \
        -d "{\"filename\": \"backup_${TIMESTAMP}.tar.gz\", \"data\": \"${backup_data}\"}" || true
fi
BACKUPEOF
    
    chmod +x ${INSTALL_DIR}/backup.sh
    
    # Create restore script
    cat > ${INSTALL_DIR}/restore.sh <<'RESTOREEOF'
#!/bin/bash

source /opt/wireguard-manager/config.env

BACKUP_FILE=$1

if [ -z "$BACKUP_FILE" ]; then
    echo "Usage: $0 <backup_file>"
    echo ""
    echo "Available backups:"
    ls -la /var/backups/wireguard/backup_*.tar.gz 2>/dev/null
    exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
    echo "Backup file not found: $BACKUP_FILE"
    exit 1
fi

echo "WARNING: This will restore from backup and overwrite current data!"
read -p "Continue? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
    echo "Restore cancelled"
    exit 0
fi

RESTORE_DIR=$(mktemp -d)
tar -xzf ${BACKUP_FILE} -C ${RESTORE_DIR}

# Stop WireGuard
systemctl stop wg-quick@wg0

# Restore database
export PGPASSWORD="${DB_PASSWORD}"
sql_file=$(ls ${RESTORE_DIR}/database_*.sql 2>/dev/null | head -1)
if [ -n "$sql_file" ]; then
    psql -h localhost -U ${DB_USER} -d ${DB_NAME} < "$sql_file"
    echo "Database restored"
fi

# Restore WireGuard config
wg_file=$(ls ${RESTORE_DIR}/wg0_*.conf 2>/dev/null | head -1)
if [ -n "$wg_file" ]; then
    cp "$wg_file" /etc/wireguard/wg0.conf
    chmod 600 /etc/wireguard/wg0.conf
    echo "WireGuard config restored"
fi

# Restore config.env if present
if [ -f "${RESTORE_DIR}/config.env" ]; then
    cp "${RESTORE_DIR}/config.env" /opt/wireguard-manager/config.env
    echo "Configuration restored"
fi

# Cleanup
rm -rf ${RESTORE_DIR}

# Start WireGuard
systemctl start wg-quick@wg0

echo "Restore completed!"
RESTOREEOF
    
    chmod +x ${INSTALL_DIR}/restore.sh
    
    # Create systemd service for sync
    cat > /etc/systemd/system/${SERVICE_NAME}.service <<EOF
[Unit]
Description=WireGuard API Sync Service
After=network.target postgresql.service

[Service]
Type=oneshot
ExecStart=${INSTALL_DIR}/sync.sh
User=root

[Install]
WantedBy=multi-user.target
EOF
    
    # Create timer for periodic sync
    cat > /etc/systemd/system/${SERVICE_NAME}.timer <<EOF
[Unit]
Description=Run WireGuard sync every minute

[Timer]
OnBootSec=30
OnUnitActiveSec=60
Unit=${SERVICE_NAME}.service

[Install]
WantedBy=timers.target
EOF
    
    systemctl daemon-reload
    systemctl enable ${SERVICE_NAME}.timer
    systemctl start ${SERVICE_NAME}.timer
    
    # Setup daily backup cron
    echo "0 3 * * * root ${INSTALL_DIR}/backup.sh" > /etc/cron.d/wireguard-backup
    
    print_success "API sync service created and enabled"
}

create_config() {
    print_header "Creating Configuration"
    
    PUBLIC_IP=$(get_public_ip)
    WG_PUBLIC_KEY=$(wg show ${WG_INTERFACE} public-key 2>/dev/null || echo "")
    SERVER_TOKEN=$(openssl rand -hex 32)
    
    cat > ${CONFIG_FILE} <<EOF
# WireGuard Manager Configuration
# Generated on $(date)

# Server Info
SERVER_ENDPOINT="${PUBLIC_IP}"
WG_PORT="${WG_PORT}"
WG_INTERFACE="${WG_INTERFACE}"
WG_PUBLIC_KEY="${WG_PUBLIC_KEY}"

# Database Configuration
DB_NAME="${DB_NAME}"
DB_USER="${DB_USER}"
DB_PASSWORD="${DB_PASSWORD}"
DB_HOST="localhost"

# Cloud Sync (set to true to enable)
CLOUD_SYNC_ENABLED="false"
CLOUD_API_URL=""
SERVER_TOKEN="${SERVER_TOKEN}"

# Backup
BACKUP_DIR="${BACKUP_DIR}"
BACKUP_RETENTION_DAYS="7"
EOF
    
    chmod 600 ${CONFIG_FILE}
    
    print_success "Configuration saved to ${CONFIG_FILE}"
}

create_cli_wrapper() {
    print_header "Creating CLI Commands"
    
    # Create symlinks for easy access
    ln -sf ${INSTALL_DIR}/manage-peer.sh /usr/local/bin/wg-peer
    ln -sf ${INSTALL_DIR}/backup.sh /usr/local/bin/wg-backup
    ln -sf ${INSTALL_DIR}/restore.sh /usr/local/bin/wg-restore
    ln -sf ${INSTALL_DIR}/sync.sh /usr/local/bin/wg-sync
    
    # Create main management script
    cat > /usr/local/bin/wg-manager <<'CLIEOF'
#!/bin/bash

CONFIG_FILE="/opt/wireguard-manager/config.env"

show_status() {
    source ${CONFIG_FILE}
    
    echo "WireGuard Server Status"
    echo "======================="
    
    if systemctl is-active --quiet wg-quick@wg0; then
        echo "Status: RUNNING"
    else
        echo "Status: STOPPED"
    fi
    
    echo "Public IP: ${SERVER_ENDPOINT}"
    echo "Port: ${WG_PORT}"
    echo "Public Key: $(wg show wg0 public-key 2>/dev/null || echo 'N/A')"
    echo ""
    echo "Cloud Sync: ${CLOUD_SYNC_ENABLED}"
    if [ "${CLOUD_SYNC_ENABLED}" = "true" ]; then
        echo "Cloud API: ${CLOUD_API_URL}"
    fi
    echo ""
    echo "Database: ${DB_NAME}"
    echo ""
    
    wg-peer list
}

enable_cloud() {
    source ${CONFIG_FILE}
    
    read -p "Enter Cloud API URL: " api_url
    
    sed -i "s|CLOUD_SYNC_ENABLED=.*|CLOUD_SYNC_ENABLED=\"true\"|" ${CONFIG_FILE}
    sed -i "s|CLOUD_API_URL=.*|CLOUD_API_URL=\"${api_url}\"|" ${CONFIG_FILE}
    
    echo "Cloud sync enabled!"
    echo "Server Token: ${SERVER_TOKEN}"
    echo "Add this token to your cloud dashboard."
    
    wg-sync
}

disable_cloud() {
    sed -i "s|CLOUD_SYNC_ENABLED=.*|CLOUD_SYNC_ENABLED=\"false\"|" ${CONFIG_FILE}
    echo "Cloud sync disabled. Using local database only."
}

case $1 in
    status)
        show_status
        ;;
    peer)
        shift
        wg-peer "$@"
        ;;
    backup)
        wg-backup
        ;;
    restore)
        shift
        wg-restore "$@"
        ;;
    sync)
        wg-sync
        ;;
    enable-cloud)
        enable_cloud
        ;;
    disable-cloud)
        disable_cloud
        ;;
    start)
        systemctl start wg-quick@wg0
        echo "WireGuard started"
        ;;
    stop)
        systemctl stop wg-quick@wg0
        echo "WireGuard stopped"
        ;;
    restart)
        systemctl restart wg-quick@wg0
        echo "WireGuard restarted"
        ;;
    *)
        echo "WireGuard Manager"
        echo ""
        echo "Usage: wg-manager <command>"
        echo ""
        echo "Commands:"
        echo "  status          Show server status and peers"
        echo "  peer add <name> Add a new peer"
        echo "  peer remove <n> Remove a peer"
        echo "  peer list       List all peers"
        echo "  backup          Create backup"
        echo "  restore <file>  Restore from backup"
        echo "  sync            Force sync status"
        echo "  enable-cloud    Enable cloud synchronization"
        echo "  disable-cloud   Disable cloud synchronization"
        echo "  start           Start WireGuard"
        echo "  stop            Stop WireGuard"
        echo "  restart         Restart WireGuard"
        ;;
esac
CLIEOF
    
    chmod +x /usr/local/bin/wg-manager
    
    print_success "CLI commands installed: wg-manager, wg-peer, wg-backup, wg-restore"
}

print_summary() {
    source ${CONFIG_FILE}
    
    print_header "Installation Complete!"
    
    echo -e "${GREEN}WireGuard VPN Server is now running!${NC}"
    echo ""
    echo "Server Details:"
    echo "  Endpoint: ${SERVER_ENDPOINT}:${WG_PORT}"
    echo "  Public Key: $(wg show wg0 public-key)"
    echo "  Network: ${WG_NETWORK}"
    echo ""
    echo "Database:"
    echo "  Name: ${DB_NAME}"
    echo "  User: ${DB_USER}"
    echo "  Password: ${DB_PASSWORD}"
    echo ""
    echo "Server Token (for cloud sync): ${SERVER_TOKEN}"
    echo ""
    echo "Quick Commands:"
    echo "  wg-manager status        - Show server status"
    echo "  wg-manager peer add NAME - Add new peer"
    echo "  wg-manager peer list     - List all peers"
    echo "  wg-manager backup        - Create backup"
    echo "  wg-manager enable-cloud  - Enable cloud sync"
    echo ""
    echo "Config file: ${CONFIG_FILE}"
    echo "Backups: ${BACKUP_DIR}"
    echo ""
    print_warning "Save the database password and server token securely!"
}

# Main installation
main() {
    print_header "WireGuard VPN Server Installation"
    
    check_root
    check_ubuntu
    install_dependencies
    setup_postgresql
    setup_wireguard
    create_config
    create_api_sync_service
    create_cli_wrapper
    
    print_summary
}

main "$@"
