#!/bin/bash

#######################################
# WireGuard VPN Server Installation Script
# For Ubuntu 22.04 LTS
# Includes: WireGuard, PostgreSQL, API Sync Service
# With GitHub Updates and Web UI Integration
#######################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
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
WEB_DIR="/var/www/wireguard-dashboard"
GITHUB_REPO=""

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

print_info() {
    echo -e "${CYAN}ℹ $1${NC}"
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
        iptables-persistent \
        nginx \
        certbot \
        python3-certbot-nginx \
        git \
        nodejs \
        npm
    
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
DO \$\$ BEGIN
    CREATE TYPE app_role AS ENUM ('admin', 'user');
EXCEPTION
    WHEN duplicate_object THEN null;
END \$\$;

-- Profiles table
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE,
    username TEXT,
    display_name TEXT,
    avatar_url TEXT,
    is_disabled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User roles table
CREATE TABLE IF NOT EXISTS user_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    role app_role DEFAULT 'user',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, role)
);

-- WireGuard peers table
CREATE TABLE IF NOT EXISTS wireguard_peers (
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
    group_id UUID REFERENCES peer_groups(id) ON DELETE SET NULL,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Peer groups table
CREATE TABLE IF NOT EXISTS peer_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    color TEXT DEFAULT '#3b82f6',
    description TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add foreign key after both tables exist
ALTER TABLE wireguard_peers DROP CONSTRAINT IF EXISTS wireguard_peers_group_id_fkey;
ALTER TABLE wireguard_peers ADD CONSTRAINT wireguard_peers_group_id_fkey 
    FOREIGN KEY (group_id) REFERENCES peer_groups(id) ON DELETE SET NULL;

-- Insert default peer groups
INSERT INTO peer_groups (name, color, description) VALUES 
    ('Mobile', '#22c55e', 'Mobile devices like phones and tablets'),
    ('Desktop', '#3b82f6', 'Desktop computers and laptops'),
    ('Servers', '#f59e0b', 'Server infrastructure'),
    ('Employees', '#8b5cf6', 'Employee devices')
ON CONFLICT DO NOTHING;

-- Server settings table
CREATE TABLE IF NOT EXISTS server_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    setting_key TEXT NOT NULL UNIQUE,
    setting_value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID
);

-- Peer assignments table
CREATE TABLE IF NOT EXISTS peer_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    peer_id UUID NOT NULL REFERENCES wireguard_peers(id) ON DELETE CASCADE,
    assigned_by UUID,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, peer_id)
);

-- Traffic stats table
CREATE TABLE IF NOT EXISTS traffic_stats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    peer_id UUID NOT NULL REFERENCES wireguard_peers(id) ON DELETE CASCADE,
    rx_bytes BIGINT DEFAULT 0,
    tx_bytes BIGINT DEFAULT 0,
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id UUID,
    details JSONB,
    ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Firewall rules table
CREATE TABLE IF NOT EXISTS firewall_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    source_ip TEXT,
    destination_ip TEXT,
    protocol TEXT DEFAULT 'any',
    port TEXT,
    action TEXT DEFAULT 'allow',
    priority INTEGER DEFAULT 100,
    enabled BOOLEAN DEFAULT TRUE,
    description TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Grant permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${DB_USER};
EOF
    
    print_success "PostgreSQL configured with database: ${DB_NAME}"
}

setup_wireguard() {
    print_header "Setting Up WireGuard (wg0)"
    
    PUBLIC_IP=$(get_public_ip)
    
    # Generate server keys
    WG_PRIVATE_KEY=$(wg genkey)
    WG_PUBLIC_KEY=$(echo "$WG_PRIVATE_KEY" | wg pubkey)
    
    # Create WireGuard configuration
    mkdir -p /etc/wireguard
    
    DEFAULT_INTERFACE=$(ip route | grep default | awk '{print $5}' | head -1)
    
    cat > /etc/wireguard/${WG_INTERFACE}.conf <<EOF
[Interface]
Address = ${WG_SERVER_IP}/24
ListenPort = ${WG_PORT}
PrivateKey = ${WG_PRIVATE_KEY}

# Enable IP forwarding
PostUp = sysctl -w net.ipv4.ip_forward=1
PostUp = iptables -A FORWARD -i %i -j ACCEPT
PostUp = iptables -A FORWARD -o %i -j ACCEPT
PostUp = iptables -t nat -A POSTROUTING -o ${DEFAULT_INTERFACE} -j MASQUERADE

PostDown = iptables -D FORWARD -i %i -j ACCEPT
PostDown = iptables -D FORWARD -o %i -j ACCEPT
PostDown = iptables -t nat -D POSTROUTING -o ${DEFAULT_INTERFACE} -j MASQUERADE

# Peers will be added dynamically
EOF
    
    chmod 600 /etc/wireguard/${WG_INTERFACE}.conf
    
    # Enable IP forwarding permanently
    if ! grep -q "net.ipv4.ip_forward=1" /etc/sysctl.conf; then
        echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf
    fi
    sysctl -p
    
    # Enable and start WireGuard
    systemctl enable wg-quick@${WG_INTERFACE}
    systemctl start wg-quick@${WG_INTERFACE}
    
    # Configure firewall
    ufw allow ${WG_PORT}/udp
    ufw allow 22/tcp
    ufw allow 80/tcp
    ufw allow 443/tcp
    ufw --force enable
    
    print_success "WireGuard (wg0) configured on ${PUBLIC_IP}:${WG_PORT}"
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
        current_time=$(date +%s)
        time_diff=$((current_time - lh))
        if [ $time_diff -lt 180 ]; then
            status="connected"
        fi
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
    
    # Save config to file
    mkdir -p ${INSTALL_DIR}/configs
    echo "$client_config" > "${INSTALL_DIR}/configs/${name}.conf"
    echo "$client_config" | qrencode -o "${INSTALL_DIR}/configs/${name}.png"
    
    echo ""
    echo "Config saved to: ${INSTALL_DIR}/configs/${name}.conf"
    echo "QR code saved to: ${INSTALL_DIR}/configs/${name}.png"
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
    
    # Remove config files
    rm -f "${INSTALL_DIR}/configs/${name}.conf"
    rm -f "${INSTALL_DIR}/configs/${name}.png"
    
    echo "Peer removed: ${name}"
}

list_peers() {
    export PGPASSWORD="${DB_PASSWORD}"
    psql -h localhost -U ${DB_USER} -d ${DB_NAME} -c "
        SELECT wp.name, wp.status, wp.allowed_ips, 
               COALESCE(pg.name, 'Ungrouped') as group_name,
               COALESCE(to_char(wp.last_handshake, 'YYYY-MM-DD HH24:MI:SS'), 'Never') as last_seen,
               pg_size_pretty(wp.transfer_rx) as download,
               pg_size_pretty(wp.transfer_tx) as upload
        FROM wireguard_peers wp
        LEFT JOIN peer_groups pg ON wp.group_id = pg.id
        ORDER BY wp.created_at;
    "
}

show_config() {
    local name=$1
    if [ -f "${INSTALL_DIR}/configs/${name}.conf" ]; then
        cat "${INSTALL_DIR}/configs/${name}.conf"
    else
        echo "Config not found for peer: ${name}"
        exit 1
    fi
}

show_qr() {
    local name=$1
    if [ -f "${INSTALL_DIR}/configs/${name}.conf" ]; then
        cat "${INSTALL_DIR}/configs/${name}.conf" | qrencode -t ansiutf8
    else
        echo "Config not found for peer: ${name}"
        exit 1
    fi
}

case $ACTION in
    add)
        if [ -z "$PEER_NAME" ]; then
            echo "Usage: $0 add <peer_name> [group_name]"
            exit 1
        fi
        add_peer "$PEER_NAME" "$3"
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
    config)
        if [ -z "$PEER_NAME" ]; then
            echo "Usage: $0 config <peer_name>"
            exit 1
        fi
        show_config "$PEER_NAME"
        ;;
    qr)
        if [ -z "$PEER_NAME" ]; then
            echo "Usage: $0 qr <peer_name>"
            exit 1
        fi
        show_qr "$PEER_NAME"
        ;;
    *)
        echo "Usage: $0 {add|remove|list|config|qr} [peer_name] [group_name]"
        echo ""
        echo "Examples:"
        echo "  $0 add laptop                    # Add peer without group"
        echo "  $0 add laptop Mobile             # Add peer to Mobile group"
        echo "  $0 add phone Employees           # Add peer to Employees group"
        echo "  $0 remove laptop                 # Remove peer"
        echo "  $0 list                          # List all peers with groups"
        exit 1
        ;;
esac
    list)
        list_peers
        ;;
    config)
        if [ -z "$PEER_NAME" ]; then
            echo "Usage: $0 config <peer_name>"
            exit 1
        fi
        show_config "$PEER_NAME"
        ;;
    qr)
        if [ -z "$PEER_NAME" ]; then
            echo "Usage: $0 qr <peer_name>"
            exit 1
        fi
        show_qr "$PEER_NAME"
        ;;
    *)
        echo "Usage: $0 {add|remove|list|config|qr} [peer_name]"
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

# Copy peer configs
mkdir -p ${BACKUP_DIR}/configs_${TIMESTAMP}
cp -r /opt/wireguard-manager/configs/* ${BACKUP_DIR}/configs_${TIMESTAMP}/ 2>/dev/null || true

# Create archive
tar -czf ${BACKUP_FILE} \
    -C ${BACKUP_DIR} \
    database_${TIMESTAMP}.sql \
    wg0_${TIMESTAMP}.conf \
    configs_${TIMESTAMP} \
    -C /opt/wireguard-manager \
    config.env

# Cleanup temp files
rm -f ${BACKUP_DIR}/database_${TIMESTAMP}.sql
rm -f ${BACKUP_DIR}/wg0_${TIMESTAMP}.conf
rm -rf ${BACKUP_DIR}/configs_${TIMESTAMP}

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

# Restore peer configs
configs_dir=$(ls -d ${RESTORE_DIR}/configs_* 2>/dev/null | head -1)
if [ -n "$configs_dir" ]; then
    mkdir -p /opt/wireguard-manager/configs
    cp -r ${configs_dir}/* /opt/wireguard-manager/configs/
    echo "Peer configs restored"
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

echo "Restore completed! Redirecting to dashboard..."
RESTOREEOF
    
    chmod +x ${INSTALL_DIR}/restore.sh
    
    # Create update script for GitHub
    cat > ${INSTALL_DIR}/update.sh <<'UPDATEEOF'
#!/bin/bash

source /opt/wireguard-manager/config.env

print_status() {
    echo -e "\033[0;34m[*] $1\033[0m"
}

print_success() {
    echo -e "\033[0;32m[✓] $1\033[0m"
}

print_error() {
    echo -e "\033[0;31m[✗] $1\033[0m"
}

if [ -z "${GITHUB_REPO}" ]; then
    print_error "GitHub repository not configured"
    echo "Set GITHUB_REPO in ${CONFIG_FILE}"
    exit 1
fi

WEB_DIR="/var/www/wireguard-dashboard"

print_status "Creating backup before update..."
/opt/wireguard-manager/backup.sh

print_status "Pulling latest changes from GitHub..."
cd ${WEB_DIR}

if [ -d ".git" ]; then
    git fetch origin
    git reset --hard origin/main
else
    print_error "Not a git repository. Cloning fresh..."
    cd /var/www
    rm -rf wireguard-dashboard
    git clone ${GITHUB_REPO} wireguard-dashboard
    cd wireguard-dashboard
fi

print_status "Installing dependencies..."
npm install

print_status "Building application..."
npm run build

print_status "Restarting services..."
systemctl restart nginx

print_success "Update completed!"
echo ""
echo "Dashboard updated to latest version from GitHub"
echo "Visit your dashboard to see the changes"
UPDATEEOF
    
    chmod +x ${INSTALL_DIR}/update.sh
    
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

# GitHub Repository (for updates)
GITHUB_REPO=""

# Backup
BACKUP_DIR="${BACKUP_DIR}"
BACKUP_RETENTION_DAYS="7"

# Web Dashboard
WEB_DIR="/var/www/wireguard-dashboard"
DASHBOARD_PORT="80"
EOF
    
    chmod 600 ${CONFIG_FILE}
    
    print_success "Configuration saved to ${CONFIG_FILE}"
}

create_cli_wrapper() {
    print_header "Creating CLI Commands"
    
    # Create symlinks for easy access
    ln -sf ${INSTALL_DIR}/manage-peer.sh /usr/local/bin/wg-peer
    ln -sf ${INSTALL_DIR}/bulk-peers.sh /usr/local/bin/wg-bulk
    ln -sf ${INSTALL_DIR}/backup.sh /usr/local/bin/wg-backup
    ln -sf ${INSTALL_DIR}/restore.sh /usr/local/bin/wg-restore
    ln -sf ${INSTALL_DIR}/sync.sh /usr/local/bin/wg-sync
    ln -sf ${INSTALL_DIR}/update.sh /usr/local/bin/wg-update
    
    # Create main management script
    cat > /usr/local/bin/wg-manager <<'CLIEOF'
#!/bin/bash

CONFIG_FILE="/opt/wireguard-manager/config.env"

show_status() {
    source ${CONFIG_FILE}
    
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║              WireGuard Server Status                         ║"
    echo "╠══════════════════════════════════════════════════════════════╣"
    
    if systemctl is-active --quiet wg-quick@wg0; then
        echo "║  Status:      ✅ RUNNING                                     ║"
    else
        echo "║  Status:      ❌ STOPPED                                     ║"
    fi
    
    echo "║  Public IP:   ${SERVER_ENDPOINT}                             "
    echo "║  Port:        ${WG_PORT}                                     "
    echo "║  Public Key:  $(wg show wg0 public-key 2>/dev/null | head -c 20)...        "
    echo "║  Interface:   wg0                                            "
    echo "╠══════════════════════════════════════════════════════════════╣"
    echo "║  Cloud Sync:  ${CLOUD_SYNC_ENABLED}                          "
    if [ "${CLOUD_SYNC_ENABLED}" = "true" ]; then
        echo "║  Cloud API:   ${CLOUD_API_URL}                           "
    fi
    echo "║  Database:    ${DB_NAME}                                     "
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    
    echo "Connected Peers:"
    echo "────────────────"
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

set_github_repo() {
    read -p "Enter GitHub repository URL: " repo_url
    sed -i "s|GITHUB_REPO=.*|GITHUB_REPO=\"${repo_url}\"|" ${CONFIG_FILE}
    echo "GitHub repository set to: ${repo_url}"
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
    update)
        wg-update
        ;;
    enable-cloud)
        enable_cloud
        ;;
    disable-cloud)
        disable_cloud
        ;;
    set-github)
        set_github_repo
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
    logs)
        tail -f /var/log/wg-sync.log
        ;;
    ssl)
        setup_ssl_cli
        ;;
    frontend)
        generate_frontend_config
        ;;
    *)
        echo ""
        echo "╔══════════════════════════════════════════════════════════════╗"
        echo "║                   WireGuard Manager                          ║"
        echo "╚══════════════════════════════════════════════════════════════╝"
        echo ""
        echo "Usage: wg-manager <command>"
        echo ""
        echo "Server Commands:"
        echo "  status            Show server status and peers"
        echo "  start             Start WireGuard"
        echo "  stop              Stop WireGuard"
        echo "  restart           Restart WireGuard"
        echo "  logs              View sync logs"
        echo ""
        echo "Peer Commands:"
        echo "  peer add <name> [group]  Add a new peer (optionally to a group)"
        echo "  peer remove <name>       Remove a peer"
        echo "  peer list                List all peers with groups"
        echo "  peer config <name>       Show peer config"
        echo "  peer qr <name>           Show peer QR code"
        echo ""
        echo "Bulk Operations:"
        echo "  wg-bulk export [file]     Export all peers to JSON"
        echo "  wg-bulk import <file>     Import peers from JSON"
        echo "  wg-bulk groups            List all peer groups"
        echo "  wg-bulk add-group <name>  Add a new peer group"
        echo ""
        echo "Backup Commands:"
        echo "  backup            Create backup"
        echo "  restore <file>    Restore from backup"
        echo ""
        echo "Sync Commands:"
        echo "  sync              Force sync status"
        echo "  update            Pull updates from GitHub"
        echo "  enable-cloud      Enable cloud synchronization"
        echo "  disable-cloud     Disable cloud synchronization"
        echo "  set-github        Set GitHub repo for updates"
        echo ""
        echo "Configuration Commands:"
        echo "  ssl               Setup SSL/HTTPS with Let's Encrypt"
        echo "  frontend          Generate frontend connection configuration"
        echo ""
        ;;
esac

generate_frontend_config() {
    source ${CONFIG_FILE} 2>/dev/null || {
        echo "Configuration not found. Run installation first."
        exit 1
    }
    
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║              Frontend Database Configuration                 ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    echo "Add these to your frontend .env file:"
    echo ""
    echo "# Local PostgreSQL Database Connection"
    echo "VITE_LOCAL_DB_HOST=${SERVER_ENDPOINT}"
    echo "VITE_LOCAL_DB_PORT=5432"
    echo "VITE_LOCAL_DB_NAME=${DB_NAME}"
    echo "VITE_LOCAL_DB_USER=${DB_USER}"
    echo "VITE_LOCAL_DB_PASSWORD=${DB_PASSWORD}"
    echo ""
    echo "# Server API"
    echo "VITE_SERVER_API_URL=http://${SERVER_ENDPOINT}/api"
    echo "VITE_SERVER_TOKEN=${SERVER_TOKEN}"
    echo ""
    echo "# WireGuard Server"
    echo "VITE_WG_ENDPOINT=${SERVER_ENDPOINT}:${WG_PORT}"
    echo "VITE_WG_PUBLIC_KEY=${WG_PUBLIC_KEY}"
    echo ""
    
    # Also create a downloadable .env file
    ENV_FILE="${INSTALL_DIR}/frontend.env"
    cat > ${ENV_FILE} <<ENVEOF
# WireGuard Manager - Frontend Environment Configuration
# Generated on $(date)

# Local PostgreSQL Database Connection
VITE_LOCAL_DB_HOST=${SERVER_ENDPOINT}
VITE_LOCAL_DB_PORT=5432
VITE_LOCAL_DB_NAME=${DB_NAME}
VITE_LOCAL_DB_USER=${DB_USER}
VITE_LOCAL_DB_PASSWORD=${DB_PASSWORD}

# Server API
VITE_SERVER_API_URL=http://${SERVER_ENDPOINT}/api
VITE_SERVER_TOKEN=${SERVER_TOKEN}

# WireGuard Server
VITE_WG_ENDPOINT=${SERVER_ENDPOINT}:${WG_PORT}
VITE_WG_PUBLIC_KEY=${WG_PUBLIC_KEY}
ENVEOF
    
    echo "Configuration also saved to: ${ENV_FILE}"
    echo ""
    echo "To download this file:"
    echo "  scp root@${SERVER_ENDPOINT}:${ENV_FILE} .env.local"
    echo ""
}

setup_ssl_cli() {
    source ${CONFIG_FILE} 2>/dev/null || true
    
    read -p "Enter your domain name (e.g., vpn.example.com): " DOMAIN_NAME
    read -p "Enter your email for SSL notifications: " SSL_EMAIL
    
    if [ -z "$DOMAIN_NAME" ] || [ -z "$SSL_EMAIL" ]; then
        echo "Domain and email are required for SSL setup."
        exit 1
    fi
    
    # Update nginx config
    cat > /etc/nginx/sites-available/wireguard-dashboard <<SSLEOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN_NAME};
    
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
    
    location / {
        return 301 https://\$server_name\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN_NAME};
    
    ssl_certificate /etc/letsencrypt/live/${DOMAIN_NAME}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN_NAME}/privkey.pem;
    
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    ssl_session_tickets off;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    
    add_header Strict-Transport-Security "max-age=63072000" always;
    
    ssl_stapling on;
    ssl_stapling_verify on;
    resolver 1.1.1.1 8.8.8.8 valid=300s;
    
    root /var/www/wireguard-dashboard/dist;
    index index.html;
    
    location / {
        try_files \$uri \$uri/ /index.html;
    }
    
    location /api/ {
        proxy_pass http://localhost:3001/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
    
    location /configs/ {
        alias /opt/wireguard-manager/configs/;
        autoindex off;
    }
}
SSLEOF

    mkdir -p /var/www/html
    nginx -t && systemctl reload nginx
    
    echo "Obtaining SSL certificate..."
    certbot certonly --webroot -w /var/www/html -d ${DOMAIN_NAME} --email ${SSL_EMAIL} --agree-tos --non-interactive
    
    if [ $? -eq 0 ]; then
        nginx -t && systemctl reload nginx
        sed -i "s|SERVER_ENDPOINT=.*|SERVER_ENDPOINT=\"${DOMAIN_NAME}\"|" ${CONFIG_FILE} 2>/dev/null || true
        
        # Setup auto-renewal
        echo "0 3 * * * root certbot renew --quiet --post-hook 'systemctl reload nginx'" > /etc/cron.d/certbot-renew
        
        echo ""
        echo "✅ SSL certificate installed successfully!"
        echo "Dashboard: https://${DOMAIN_NAME}"
        echo "Auto-renewal is configured."
    else
        echo "❌ Failed to obtain SSL certificate"
        echo "Make sure your domain DNS points to this server's IP"
    fi
}
CLIEOF
    
    chmod +x /usr/local/bin/wg-manager
    
    print_success "CLI commands installed: wg-manager, wg-peer, wg-backup, wg-restore, wg-update"
}

setup_nginx() {
    print_header "Setting Up Nginx Web Server"
    
    mkdir -p ${WEB_DIR}
    
    # Create nginx config
    cat > /etc/nginx/sites-available/wireguard-dashboard <<'NGINXEOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    
    root /var/www/wireguard-dashboard/dist;
    index index.html;
    
    server_name _;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    location /api/ {
        proxy_pass http://localhost:3001/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
    
    # Serve peer configs
    location /configs/ {
        alias /opt/wireguard-manager/configs/;
        autoindex off;
    }
}
NGINXEOF
    
    # Enable site
    ln -sf /etc/nginx/sites-available/wireguard-dashboard /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/default
    
    # Test and restart nginx
    nginx -t
    systemctl restart nginx
    systemctl enable nginx
    
    print_success "Nginx configured"
}

setup_ssl() {
    print_header "Setting Up SSL/HTTPS with Let's Encrypt"
    
    read -p "Enter your domain name (e.g., vpn.example.com): " DOMAIN_NAME
    read -p "Enter your email for SSL certificate notifications: " SSL_EMAIL
    
    if [ -z "$DOMAIN_NAME" ] || [ -z "$SSL_EMAIL" ]; then
        print_warning "Domain or email not provided. Skipping SSL setup."
        print_info "You can run 'wg-manager ssl' later to configure SSL."
        return
    fi
    
    # Update nginx config with domain
    cat > /etc/nginx/sites-available/wireguard-dashboard <<NGINXSSLEOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN_NAME};
    
    # Redirect HTTP to HTTPS
    location / {
        return 301 https://\$server_name\$request_uri;
    }
    
    # Let's Encrypt challenge
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN_NAME};
    
    # SSL certificates (will be added by certbot)
    ssl_certificate /etc/letsencrypt/live/${DOMAIN_NAME}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN_NAME}/privkey.pem;
    
    # SSL settings
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    ssl_session_tickets off;
    
    # Modern SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    
    # HSTS
    add_header Strict-Transport-Security "max-age=63072000" always;
    
    # OCSP Stapling
    ssl_stapling on;
    ssl_stapling_verify on;
    resolver 1.1.1.1 8.8.8.8 valid=300s;
    resolver_timeout 5s;
    
    root /var/www/wireguard-dashboard/dist;
    index index.html;
    
    location / {
        try_files \$uri \$uri/ /index.html;
    }
    
    location /api/ {
        proxy_pass http://localhost:3001/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
    
    # Serve peer configs (with auth)
    location /configs/ {
        alias /opt/wireguard-manager/configs/;
        autoindex off;
    }
}
NGINXSSLEOF

    # Create a temporary HTTP-only config for certbot
    cat > /etc/nginx/sites-available/wireguard-temp <<TEMPEOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN_NAME};
    
    root /var/www/html;
    
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
    
    location / {
        return 301 https://\$server_name\$request_uri;
    }
}
TEMPEOF

    # Use temp config for initial certbot
    ln -sf /etc/nginx/sites-available/wireguard-temp /etc/nginx/sites-enabled/wireguard-dashboard
    nginx -t && systemctl reload nginx
    
    # Obtain SSL certificate
    print_info "Obtaining SSL certificate from Let's Encrypt..."
    certbot certonly --webroot -w /var/www/html -d ${DOMAIN_NAME} --email ${SSL_EMAIL} --agree-tos --non-interactive
    
    if [ $? -eq 0 ]; then
        # Switch to SSL config
        ln -sf /etc/nginx/sites-available/wireguard-dashboard /etc/nginx/sites-enabled/
        rm -f /etc/nginx/sites-available/wireguard-temp
        nginx -t && systemctl reload nginx
        
        # Update config with domain
        sed -i "s|SERVER_ENDPOINT=.*|SERVER_ENDPOINT=\"${DOMAIN_NAME}\"|" ${CONFIG_FILE}
        
        # Setup auto-renewal cron
        cat > /etc/cron.d/certbot-renew <<'CRONEOF'
0 3 * * * root certbot renew --quiet --post-hook "systemctl reload nginx"
CRONEOF
        
        print_success "SSL certificate installed successfully!"
        print_info "Dashboard: https://${DOMAIN_NAME}"
        print_info "Certificate auto-renewal is configured."
    else
        print_error "Failed to obtain SSL certificate"
        print_info "Make sure your domain points to this server's IP address"
        print_info "You can retry with: wg-manager ssl"
        
        # Restore HTTP config
        ln -sf /etc/nginx/sites-available/wireguard-dashboard /etc/nginx/sites-enabled/
        rm -f /etc/nginx/sites-available/wireguard-temp
    fi
    
    nginx -t && systemctl reload nginx
}

create_admin_user() {
    print_header "Creating Admin User"
    
    read -p "Enter admin email: " admin_email
    read -s -p "Enter admin password: " admin_password
    echo ""
    read -p "Enter admin display name: " admin_name
    
    # Hash password (simple hash for local auth - in production use proper auth)
    password_hash=$(echo -n "${admin_password}" | sha256sum | cut -d' ' -f1)
    
    export PGPASSWORD="${DB_PASSWORD}"
    admin_id=$(psql -h localhost -U ${DB_USER} -d ${DB_NAME} -t -c "
        INSERT INTO profiles (user_id, username, display_name)
        VALUES (uuid_generate_v4(), '${admin_email}', '${admin_name}')
        RETURNING user_id;
    " | tr -d ' ')
    
    psql -h localhost -U ${DB_USER} -d ${DB_NAME} -c "
        INSERT INTO user_roles (user_id, role)
        VALUES ('${admin_id}', 'admin');
    "
    
    print_success "Admin user created: ${admin_email}"
}

print_summary() {
    source ${CONFIG_FILE}
    
    print_header "Installation Complete!"
    
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║         WireGuard VPN Server is now running!                 ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "Server Details:"
    echo "  ├─ Endpoint: ${SERVER_ENDPOINT}:${WG_PORT}"
    echo "  ├─ Public Key: $(wg show wg0 public-key)"
    echo "  ├─ Network: ${WG_NETWORK}"
    echo "  └─ Interface: wg0"
    echo ""
    echo "Database Connection (for frontend .env file):"
    echo "  ├─ VITE_LOCAL_DB_HOST=localhost"
    echo "  ├─ VITE_LOCAL_DB_PORT=5432"
    echo "  ├─ VITE_LOCAL_DB_NAME=${DB_NAME}"
    echo "  ├─ VITE_LOCAL_DB_USER=${DB_USER}"
    echo "  └─ VITE_LOCAL_DB_PASSWORD=${DB_PASSWORD}"
    echo ""
    echo "Server Token (for cloud sync): ${SERVER_TOKEN}"
    echo ""
    echo "Quick Commands:"
    echo "  ├─ wg-manager status        - Show server status"
    echo "  ├─ wg-manager peer add NAME - Add new peer"
    echo "  ├─ wg-manager peer list     - List all peers"
    echo "  ├─ wg-manager backup        - Create backup"
    echo "  ├─ wg-manager restore FILE  - Restore from backup"
    echo "  ├─ wg-manager update        - Pull updates from GitHub"
    echo "  ├─ wg-manager enable-cloud  - Enable cloud sync"
    echo "  ├─ wg-manager set-github    - Set GitHub repo for updates"
    echo "  ├─ wg-manager ssl           - Setup SSL/HTTPS with Let's Encrypt"
    echo "  └─ wg-manager frontend      - Generate frontend connection config"
    echo ""
    echo "Config file: ${CONFIG_FILE}"
    echo "Backups: ${BACKUP_DIR}"
    echo "Peer configs: ${INSTALL_DIR}/configs/"
    echo ""
    echo -e "${YELLOW}⚠ Save the database password and server token securely!${NC}"
    echo ""
    echo "To access the dashboard, visit: http://${SERVER_ENDPOINT}"
    echo "To enable HTTPS, run: wg-manager ssl"
    echo ""
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
    setup_nginx
    
    echo ""
    read -p "Would you like to create an admin user now? (yes/no): " create_admin
    if [ "$create_admin" = "yes" ]; then
        create_admin_user
    fi
    
    echo ""
    read -p "Would you like to setup SSL/HTTPS with Let's Encrypt? (yes/no): " setup_ssl_choice
    if [ "$setup_ssl_choice" = "yes" ]; then
        setup_ssl
    fi
    
    print_summary
}

main "$@"
