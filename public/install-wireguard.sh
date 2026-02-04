#!/bin/bash

#######################################
# WireGuard VPN Server Installation Script
# For Ubuntu 22.04 LTS
# Includes: WireGuard, PostgreSQL, Node.js API, React Frontend
# Full Front-end and Back-end Setup with GitHub Integration
#
# USAGE:
#   Direct install on Ubuntu 22.04:
#     curl -fsSL https://raw.githubusercontent.com/your-repo/wireguard-manager/main/public/install-wireguard.sh | bash
#
#   Proxmox LXC Container:
#     Use setup-proxmox.sh for automated container creation
#     Or manually create Ubuntu 22.04 container and run this script
#
# PROXMOX LXC REQUIREMENTS:
#   - Unprivileged container: NO (use privileged for WireGuard)
#   - Features: nesting=1, keyctl=1
#   - Add to container config (/etc/pve/lxc/<ID>.conf):
#       lxc.cgroup2.devices.allow: c 10:200 rwm
#       lxc.mount.entry: /dev/net dev/net none bind,create=dir
#       lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file
#
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
API_DIR="${INSTALL_DIR}/api"
GITHUB_REPO=""
NODE_VERSION="20"

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
        build-essential
    
    # Install Node.js LTS
    print_info "Installing Node.js ${NODE_VERSION}.x..."
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
    apt-get install -y nodejs
    
    # Install PM2 for process management
    npm install -g pm2
    
    print_success "Dependencies installed"
    print_info "Node.js version: $(node -v)"
    print_info "npm version: $(npm -v)"
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
    group_id UUID,
    subdomain TEXT,
    hostname TEXT,
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

-- Peer notifications table for real-time connection events
CREATE TABLE IF NOT EXISTS peer_notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    peer_id UUID,
    peer_name TEXT NOT NULL,
    event_type TEXT NOT NULL,
    read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add foreign key after both tables exist
ALTER TABLE wireguard_peers DROP CONSTRAINT IF EXISTS wireguard_peers_group_id_fkey;
ALTER TABLE wireguard_peers ADD CONSTRAINT wireguard_peers_group_id_fkey 
    FOREIGN KEY (group_id) REFERENCES peer_groups(id) ON DELETE SET NULL;

-- Add foreign key for peer_notifications
ALTER TABLE peer_notifications DROP CONSTRAINT IF EXISTS peer_notifications_peer_id_fkey;
ALTER TABLE peer_notifications ADD CONSTRAINT peer_notifications_peer_id_fkey
    FOREIGN KEY (peer_id) REFERENCES wireguard_peers(id) ON DELETE SET NULL;

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

# Update peer statuses in local database and track connection changes
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
    
    # Get current status to detect changes
    old_status=$(psql -h localhost -U ${DB_USER} -d ${DB_NAME} -t -c "
        SELECT status FROM wireguard_peers WHERE public_key = '${pk}';
    " 2>/dev/null | tr -d ' ')
    
    # Check if status changed and create notification
    if [ -n "$old_status" ] && [ "$old_status" != "$status" ]; then
        peer_info=$(psql -h localhost -U ${DB_USER} -d ${DB_NAME} -t -c "
            SELECT id, name, allowed_ips FROM wireguard_peers WHERE public_key = '${pk}';
        " 2>/dev/null)
        peer_id=$(echo "$peer_info" | cut -d'|' -f1 | tr -d ' ')
        peer_name=$(echo "$peer_info" | cut -d'|' -f2 | tr -d ' ')
        peer_ip=$(echo "$peer_info" | cut -d'|' -f3 | tr -d ' ')
        
        if [ -n "$peer_id" ] && [ -n "$peer_name" ]; then
            psql -h localhost -U ${DB_USER} -d ${DB_NAME} -c "
                INSERT INTO peer_notifications (peer_id, peer_name, event_type)
                VALUES ('${peer_id}', '${peer_name}', '${status}');
            " 2>/dev/null
            echo "$(date): Status change for ${peer_name}: ${old_status} -> ${status}" >> /var/log/wg-sync.log
            
            # Trigger email notification via API
            curl -s -X POST "http://localhost:3001/internal/email-notify" \
                -H "Content-Type: application/json" \
                -d "{\"peer_name\": \"${peer_name}\", \"event_type\": \"${status}\", \"peer_ip\": \"${peer_ip}\"}" \
                2>/dev/null || true
        fi
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

    # Check if auto-subdomain is enabled and assign hostname
    local subdomain=""
    local hostname=""
    
    node_domain_enabled=$(psql -h localhost -U ${DB_USER} -d ${DB_NAME} -t -c "
        SELECT setting_value FROM server_settings WHERE setting_key = 'node_domain_enabled';
    " 2>/dev/null | tr -d ' ')
    
    base_domain=$(psql -h localhost -U ${DB_USER} -d ${DB_NAME} -t -c "
        SELECT setting_value FROM server_settings WHERE setting_key = 'node_base_domain';
    " 2>/dev/null | tr -d ' ')
    
    if [ "${node_domain_enabled}" = "true" ] && [ -n "${base_domain}" ]; then
        subdomain=$(echo "${name}" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/-\+/-/g' | sed 's/^-//' | sed 's/-$//')
        hostname="${subdomain}.${base_domain}"
        echo "Auto-assigned hostname: ${hostname}"
    fi
    
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
    local group_name=$2
    local private_key=$(wg genkey)
    local public_key=$(echo "$private_key" | wg pubkey)
    local peer_ip=$(get_next_ip)
    local server_public_key=$(wg show ${WG_INTERFACE} public-key)
    
    # Get group_id if group_name provided
    local group_id=""
    if [ -n "$group_name" ]; then
        group_id=$(psql -h localhost -U ${DB_USER} -d ${DB_NAME} -t -c "
            SELECT id FROM peer_groups WHERE name = '${group_name}';
        " | tr -d ' ')
    fi
    
    # Check if auto-subdomain is enabled
    local subdomain=""
    local hostname=""
    
    node_domain_enabled=$(psql -h localhost -U ${DB_USER} -d ${DB_NAME} -t -c "
        SELECT setting_value FROM server_settings WHERE setting_key = 'node_domain_enabled';
    " 2>/dev/null | tr -d ' ')
    
    base_domain=$(psql -h localhost -U ${DB_USER} -d ${DB_NAME} -t -c "
        SELECT setting_value FROM server_settings WHERE setting_key = 'node_base_domain';
    " 2>/dev/null | tr -d ' ')
    
    if [ "${node_domain_enabled}" = "true" ] && [ -n "${base_domain}" ]; then
        subdomain=$(echo "${name}" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/-\+/-/g' | sed 's/^-//' | sed 's/-$//')
        hostname="${subdomain}.${base_domain}"
    fi
    
    # Add to WireGuard
    wg set ${WG_INTERFACE} peer ${public_key} allowed-ips ${peer_ip}/32
    wg-quick save ${WG_INTERFACE}
    
    # Add to database with group, subdomain and hostname
    export PGPASSWORD="${DB_PASSWORD}"
    peer_id=$(psql -h localhost -U ${DB_USER} -d ${DB_NAME} -t -c "
        INSERT INTO wireguard_peers (name, public_key, private_key, allowed_ips, dns, group_id, subdomain, hostname)
        VALUES ('${name}', '${public_key}', '${private_key}', '${peer_ip}/32', '1.1.1.1', 
                $([ -n "$group_id" ] && echo "'${group_id}'" || echo "NULL"),
                $([ -n "$subdomain" ] && echo "'${subdomain}'" || echo "NULL"),
                $([ -n "$hostname" ] && echo "'${hostname}'" || echo "NULL"))
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
    
    # Create No-IP update script
    cat > ${INSTALL_DIR}/noip-update.sh <<'NOIPEOF'
#!/bin/bash

source /opt/wireguard-manager/config.env

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Get current public IP
get_current_ip() {
    curl -s https://api.ipify.org 2>/dev/null || curl -s https://ifconfig.me 2>/dev/null || echo ""
}

# Get No-IP settings from database
get_noip_setting() {
    local key=$1
    export PGPASSWORD="${DB_PASSWORD}"
    psql -h localhost -U ${DB_USER} -d ${DB_NAME} -t -c "
        SELECT setting_value FROM server_settings WHERE setting_key = '${key}';
    " 2>/dev/null | tr -d ' '
}

# Save No-IP setting to database
save_noip_setting() {
    local key=$1
    local value=$2
    export PGPASSWORD="${DB_PASSWORD}"
    psql -h localhost -U ${DB_USER} -d ${DB_NAME} -c "
        INSERT INTO server_settings (setting_key, setting_value, updated_at)
        VALUES ('${key}', '${value}', NOW())
        ON CONFLICT (setting_key) DO UPDATE SET 
            setting_value = EXCLUDED.setting_value,
            updated_at = NOW();
    " 2>/dev/null
}

# Update No-IP DNS
update_noip() {
    local noip_enabled=$(get_noip_setting "noip_enabled")
    local noip_username=$(get_noip_setting "noip_username")
    local noip_password=$(get_noip_setting "noip_password")
    local noip_hostname=$(get_noip_setting "noip_hostname")
    local last_ip=$(get_noip_setting "noip_last_ip")
    
    if [ "${noip_enabled}" != "true" ]; then
        echo -e "${YELLOW}No-IP is disabled${NC}"
        return 1
    fi
    
    if [ -z "${noip_username}" ] || [ -z "${noip_password}" ] || [ -z "${noip_hostname}" ]; then
        echo -e "${RED}No-IP credentials not configured${NC}"
        return 1
    fi
    
    local current_ip=$(get_current_ip)
    
    if [ -z "${current_ip}" ]; then
        echo -e "${RED}Failed to detect current IP${NC}"
        return 1
    fi
    
    echo "Current IP: ${current_ip}"
    echo "Last IP: ${last_ip:-None}"
    
    # Check if IP has changed
    if [ "${current_ip}" = "${last_ip}" ]; then
        echo -e "${YELLOW}IP has not changed, skipping update${NC}"
        save_noip_setting "noip_last_update" "$(date -Iseconds)"
        return 0
    fi
    
    echo "Updating No-IP hostname: ${noip_hostname}..."
    
    # Call No-IP Dynamic Update API
    local response=$(curl -s -u "${noip_username}:${noip_password}" \
        -A "WireGuard-Manager/1.0 admin@wireguard-manager.local" \
        "https://dynupdate.no-ip.com/nic/update?hostname=${noip_hostname}&myip=${current_ip}")
    
    echo "Response: ${response}"
    
    # Parse response
    local response_code=$(echo "${response}" | awk '{print $1}')
    
    case "${response_code}" in
        good|nochg)
            echo -e "${GREEN}✓ No-IP updated successfully!${NC}"
            save_noip_setting "noip_last_ip" "${current_ip}"
            save_noip_setting "noip_last_update" "$(date -Iseconds)"
            save_noip_setting "noip_last_response" "${response}"
            return 0
            ;;
        nohost)
            echo -e "${RED}✗ Hostname not found${NC}"
            ;;
        badauth)
            echo -e "${RED}✗ Invalid username/password${NC}"
            ;;
        badagent)
            echo -e "${RED}✗ Client blocked by No-IP${NC}"
            ;;
        abuse)
            echo -e "${RED}✗ Hostname blocked due to abuse${NC}"
            ;;
        911)
            echo -e "${RED}✗ No-IP server error${NC}"
            ;;
        *)
            echo -e "${YELLOW}Unknown response: ${response}${NC}"
            ;;
    esac
    
    save_noip_setting "noip_last_response" "${response}"
    return 1
}

# Status check
check_status() {
    local noip_enabled=$(get_noip_setting "noip_enabled")
    local noip_hostname=$(get_noip_setting "noip_hostname")
    local last_ip=$(get_noip_setting "noip_last_ip")
    local last_update=$(get_noip_setting "noip_last_update")
    local auto_update=$(get_noip_setting "noip_auto_update_enabled")
    local interval=$(get_noip_setting "noip_update_interval")
    local current_ip=$(get_current_ip)
    
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                   No-IP DNS Status                           ║"
    echo "╠══════════════════════════════════════════════════════════════╣"
    echo "║  Enabled:       ${noip_enabled:-false}"
    echo "║  Hostname:      ${noip_hostname:-Not configured}"
    echo "║  Current IP:    ${current_ip:-Unknown}"
    echo "║  Last IP:       ${last_ip:-Never updated}"
    echo "║  Last Update:   ${last_update:-Never}"
    echo "║  Auto Update:   ${auto_update:-false}"
    echo "║  Interval:      ${interval:-30} minutes"
    if [ "${current_ip}" != "${last_ip}" ] && [ -n "${last_ip}" ]; then
        echo "║  ⚠ IP has changed! Run 'wg-noip update' to sync"
    fi
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
}

# Configure No-IP
configure() {
    echo "No-IP Configuration"
    echo "==================="
    
    read -p "No-IP Username/Email: " username
    read -s -p "No-IP Password: " password
    echo ""
    read -p "Hostname (e.g., yourname.ddns.net): " hostname
    read -p "Update interval in minutes [30]: " interval
    interval=${interval:-30}
    read -p "Enable auto-update? (yes/no) [yes]: " auto_update
    auto_update=${auto_update:-yes}
    
    save_noip_setting "noip_enabled" "true"
    save_noip_setting "noip_username" "${username}"
    save_noip_setting "noip_password" "${password}"
    save_noip_setting "noip_hostname" "${hostname}"
    save_noip_setting "noip_update_interval" "${interval}"
    save_noip_setting "noip_auto_update_enabled" "$([ "${auto_update}" = "yes" ] && echo "true" || echo "false")"
    
    echo ""
    echo -e "${GREEN}✓ No-IP configured successfully!${NC}"
    echo "Running initial update..."
    update_noip
    
    # Setup cron job if auto-update enabled
    if [ "${auto_update}" = "yes" ]; then
        setup_cron "${interval}"
    fi
}

# Setup cron job
setup_cron() {
    local interval=$1
    
    # Remove existing cron
    crontab -l 2>/dev/null | grep -v "noip-update.sh" | crontab -
    
    # Add new cron
    (crontab -l 2>/dev/null; echo "*/${interval} * * * * ${INSTALL_DIR}/noip-update.sh update >> /var/log/noip-update.log 2>&1") | crontab -
    
    echo -e "${GREEN}✓ Auto-update cron job configured (every ${interval} minutes)${NC}"
}

# Disable cron
disable_cron() {
    crontab -l 2>/dev/null | grep -v "noip-update.sh" | crontab -
    echo "Auto-update disabled"
}

case "$1" in
    update)
        update_noip
        ;;
    status)
        check_status
        ;;
    configure)
        configure
        ;;
    enable)
        save_noip_setting "noip_enabled" "true"
        echo "No-IP enabled"
        ;;
    disable)
        save_noip_setting "noip_enabled" "false"
        disable_cron
        echo "No-IP disabled"
        ;;
    cron)
        interval=${2:-30}
        setup_cron "${interval}"
        ;;
    *)
        echo "Usage: $0 {update|status|configure|enable|disable|cron [interval]}"
        echo ""
        echo "Commands:"
        echo "  update      Update No-IP DNS record with current IP"
        echo "  status      Show No-IP configuration status"
        echo "  configure   Interactive setup wizard"
        echo "  enable      Enable No-IP updates"
        echo "  disable     Disable No-IP updates"
        echo "  cron [min]  Setup auto-update cron job (default: 30 min)"
        ;;
esac
NOIPEOF
    
    chmod +x ${INSTALL_DIR}/noip-update.sh
    
    # Create subdomain management script
    cat > ${INSTALL_DIR}/subdomain.sh <<'SUBDOMAINEOF'
#!/bin/bash

source /opt/wireguard-manager/config.env

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Get setting from database
get_setting() {
    local key=$1
    export PGPASSWORD="${DB_PASSWORD}"
    psql -h localhost -U ${DB_USER} -d ${DB_NAME} -t -c "
        SELECT setting_value FROM server_settings WHERE setting_key = '${key}';
    " 2>/dev/null | tr -d ' '
}

# Save setting to database
save_setting() {
    local key=$1
    local value=$2
    export PGPASSWORD="${DB_PASSWORD}"
    psql -h localhost -U ${DB_USER} -d ${DB_NAME} -c "
        INSERT INTO server_settings (setting_key, setting_value, updated_at)
        VALUES ('${key}', '${value}', NOW())
        ON CONFLICT (setting_key) DO UPDATE SET 
            setting_value = EXCLUDED.setting_value,
            updated_at = NOW();
    " 2>/dev/null
}

# Generate subdomain from name
generate_subdomain() {
    local name=$1
    echo "${name}" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/-\+/-/g' | sed 's/^-//' | sed 's/-$//'
}

# Assign subdomain to peer
assign_subdomain() {
    local peer_name=$1
    local subdomain=${2:-$(generate_subdomain "${peer_name}")}
    local base_domain=$(get_setting "node_base_domain")
    
    if [ -z "${base_domain}" ]; then
        echo -e "${RED}Base domain not configured. Run: $0 configure${NC}"
        return 1
    fi
    
    local hostname="${subdomain}.${base_domain}"
    
    export PGPASSWORD="${DB_PASSWORD}"
    psql -h localhost -U ${DB_USER} -d ${DB_NAME} -c "
        UPDATE wireguard_peers 
        SET subdomain = '${subdomain}', hostname = '${hostname}', updated_at = NOW()
        WHERE name = '${peer_name}';
    "
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Assigned ${hostname} to peer ${peer_name}${NC}"
    else
        echo -e "${RED}✗ Failed to assign subdomain${NC}"
    fi
}

# Remove subdomain from peer
remove_subdomain() {
    local peer_name=$1
    
    export PGPASSWORD="${DB_PASSWORD}"
    psql -h localhost -U ${DB_USER} -d ${DB_NAME} -c "
        UPDATE wireguard_peers 
        SET subdomain = NULL, hostname = NULL, updated_at = NOW()
        WHERE name = '${peer_name}';
    "
    
    echo "Subdomain removed from peer ${peer_name}"
}

# List all peer subdomains
list_subdomains() {
    export PGPASSWORD="${DB_PASSWORD}"
    echo ""
    echo "Peer Subdomain Assignments:"
    echo "==========================="
    psql -h localhost -U ${DB_USER} -d ${DB_NAME} -c "
        SELECT name, 
               COALESCE(hostname, 'Not assigned') as hostname,
               allowed_ips,
               status
        FROM wireguard_peers 
        ORDER BY name;
    "
}

# Auto-assign subdomains to all peers without one
auto_assign_all() {
    local base_domain=$(get_setting "node_base_domain")
    
    if [ -z "${base_domain}" ]; then
        echo -e "${RED}Base domain not configured. Run: $0 configure${NC}"
        return 1
    fi
    
    export PGPASSWORD="${DB_PASSWORD}"
    local peers=$(psql -h localhost -U ${DB_USER} -d ${DB_NAME} -t -c "
        SELECT name FROM wireguard_peers WHERE hostname IS NULL;
    ")
    
    while read -r peer_name; do
        peer_name=$(echo "${peer_name}" | tr -d ' ')
        if [ -n "${peer_name}" ]; then
            assign_subdomain "${peer_name}"
        fi
    done <<< "${peers}"
    
    echo ""
    echo -e "${GREEN}✓ Auto-assignment complete${NC}"
}

# Configure subdomain settings
configure() {
    echo "Node Domain Configuration"
    echo "========================="
    
    read -p "Base domain (e.g., nodes.example.com): " base_domain
    read -p "Enable auto-assignment for new peers? (yes/no) [yes]: " auto_assign
    auto_assign=${auto_assign:-yes}
    read -p "IP range start [10.0.0.2]: " ip_start
    ip_start=${ip_start:-10.0.0.2}
    read -p "IP range end [10.0.0.254]: " ip_end
    ip_end=${ip_end:-10.0.0.254}
    
    save_setting "node_base_domain" "${base_domain}"
    save_setting "node_domain_enabled" "$([ "${auto_assign}" = "yes" ] && echo "true" || echo "false")"
    save_setting "node_ip_range_start" "${ip_start}"
    save_setting "node_ip_range_end" "${ip_end}"
    
    echo ""
    echo -e "${GREEN}✓ Node domain configured!${NC}"
    echo ""
    echo "DNS Setup Required:"
    echo "  Add a wildcard A record: *.${base_domain} -> Your Server IP"
    echo ""
}

# Show status
show_status() {
    local enabled=$(get_setting "node_domain_enabled")
    local base_domain=$(get_setting "node_base_domain")
    local ip_start=$(get_setting "node_ip_range_start")
    local ip_end=$(get_setting "node_ip_range_end")
    
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                Node Domain Configuration                      ║"
    echo "╠══════════════════════════════════════════════════════════════╣"
    echo "║  Auto-assign:   ${enabled:-false}"
    echo "║  Base Domain:   ${base_domain:-Not configured}"
    echo "║  IP Range:      ${ip_start:-10.0.0.2} - ${ip_end:-10.0.0.254}"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
}

case "$1" in
    assign)
        if [ -z "$2" ]; then
            echo "Usage: $0 assign <peer_name> [subdomain]"
            exit 1
        fi
        assign_subdomain "$2" "$3"
        ;;
    remove)
        if [ -z "$2" ]; then
            echo "Usage: $0 remove <peer_name>"
            exit 1
        fi
        remove_subdomain "$2"
        ;;
    list)
        list_subdomains
        ;;
    auto-assign)
        auto_assign_all
        ;;
    configure)
        configure
        ;;
    status)
        show_status
        ;;
    enable)
        save_setting "node_domain_enabled" "true"
        echo "Auto-subdomain assignment enabled"
        ;;
    disable)
        save_setting "node_domain_enabled" "false"
        echo "Auto-subdomain assignment disabled"
        ;;
    *)
        echo "Usage: $0 {assign|remove|list|auto-assign|configure|status|enable|disable}"
        echo ""
        echo "Commands:"
        echo "  assign <peer> [sub]  Assign subdomain to peer"
        echo "  remove <peer>        Remove subdomain from peer"
        echo "  list                 List all peer subdomains"
        echo "  auto-assign          Auto-assign subdomains to all peers"
        echo "  configure            Interactive setup wizard"
        echo "  status               Show current configuration"
        echo "  enable               Enable auto-assignment for new peers"
        echo "  disable              Disable auto-assignment for new peers"
        ;;
esac
SUBDOMAINEOF
    
    chmod +x ${INSTALL_DIR}/subdomain.sh
    
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
    ln -sf ${INSTALL_DIR}/noip-update.sh /usr/local/bin/wg-noip
    ln -sf ${INSTALL_DIR}/subdomain.sh /usr/local/bin/wg-subdomain
    ln -sf ${INSTALL_DIR}/dns-validate.sh /usr/local/bin/wg-dns
    ln -sf ${INSTALL_DIR}/email-notify.sh /usr/local/bin/wg-email
    
    # Create email notification management script
    cat > ${INSTALL_DIR}/email-notify.sh <<'EMAILEOF'
#!/bin/bash

source /opt/wireguard-manager/config.env

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Get setting from database
get_setting() {
    local key=$1
    export PGPASSWORD="${DB_PASSWORD}"
    psql -h localhost -U ${DB_USER} -d ${DB_NAME} -t -c "
        SELECT setting_value FROM server_settings WHERE setting_key = '${key}';
    " 2>/dev/null | tr -d ' '
}

# Save setting to database
save_setting() {
    local key=$1
    local value=$2
    export PGPASSWORD="${DB_PASSWORD}"
    psql -h localhost -U ${DB_USER} -d ${DB_NAME} -c "
        INSERT INTO server_settings (setting_key, setting_value, updated_at)
        VALUES ('${key}', '${value}', NOW())
        ON CONFLICT (setting_key) DO UPDATE SET 
            setting_value = EXCLUDED.setting_value,
            updated_at = NOW();
    " 2>/dev/null
}

# Configure email settings
configure() {
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║              Email Notification Configuration                 ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    
    read -p "Notification email address: " email
    read -p "SMTP Host (e.g., smtp.gmail.com): " smtp_host
    read -p "SMTP Port [587]: " smtp_port
    smtp_port=${smtp_port:-587}
    read -p "SMTP Username (optional): " smtp_user
    if [ -n "$smtp_user" ]; then
        read -s -p "SMTP Password: " smtp_password
        echo ""
    fi
    read -p "From address [noreply@wireguard-manager.local]: " smtp_from
    smtp_from=${smtp_from:-noreply@wireguard-manager.local}
    
    echo ""
    echo "Notification Events:"
    read -p "Notify on peer connect? (yes/no) [yes]: " notify_connect
    read -p "Notify on peer disconnect? (yes/no) [yes]: " notify_disconnect
    read -p "Notify on peer added? (yes/no) [yes]: " notify_added
    read -p "Notify on peer removed? (yes/no) [yes]: " notify_removed
    
    save_setting "email_notifications_enabled" "true"
    save_setting "notification_email" "${email}"
    save_setting "smtp_host" "${smtp_host}"
    save_setting "smtp_port" "${smtp_port}"
    save_setting "smtp_user" "${smtp_user:-}"
    save_setting "smtp_password" "${smtp_password:-}"
    save_setting "smtp_from" "${smtp_from}"
    save_setting "notify_on_connect" "$([ "${notify_connect:-yes}" = "yes" ] && echo "true" || echo "false")"
    save_setting "notify_on_disconnect" "$([ "${notify_disconnect:-yes}" = "yes" ] && echo "true" || echo "false")"
    save_setting "notify_on_peer_added" "$([ "${notify_added:-yes}" = "yes" ] && echo "true" || echo "false")"
    save_setting "notify_on_peer_removed" "$([ "${notify_removed:-yes}" = "yes" ] && echo "true" || echo "false")"
    
    echo ""
    echo -e "${GREEN}✓ Email notifications configured!${NC}"
    echo ""
    echo "Run 'wg-email test' to send a test email."
}

# Show status
show_status() {
    local enabled=$(get_setting "email_notifications_enabled")
    local email=$(get_setting "notification_email")
    local smtp_host=$(get_setting "smtp_host")
    local smtp_port=$(get_setting "smtp_port")
    local notify_connect=$(get_setting "notify_on_connect")
    local notify_disconnect=$(get_setting "notify_on_disconnect")
    local notify_added=$(get_setting "notify_on_peer_added")
    local notify_removed=$(get_setting "notify_on_peer_removed")
    
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║              Email Notification Status                        ║"
    echo "╠══════════════════════════════════════════════════════════════╣"
    echo "║  Enabled:           ${enabled:-false}"
    echo "║  Email:             ${email:-Not configured}"
    echo "║  SMTP Host:         ${smtp_host:-Not configured}"
    echo "║  SMTP Port:         ${smtp_port:-587}"
    echo "╠══════════════════════════════════════════════════════════════╣"
    echo "║  Notification Events:"
    echo "║    Connect:         ${notify_connect:-true}"
    echo "║    Disconnect:      ${notify_disconnect:-true}"
    echo "║    Peer Added:      ${notify_added:-true}"
    echo "║    Peer Removed:    ${notify_removed:-true}"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
}

# Send test email
send_test() {
    echo "Sending test email..."
    
    local response=$(curl -s -X POST "http://localhost:3001/internal/email-notify" \
        -H "Content-Type: application/json" \
        -d '{"peer_name": "Test Peer", "event_type": "connected", "peer_ip": "10.0.0.100"}')
    
    if echo "$response" | grep -q '"success":true'; then
        echo -e "${GREEN}✓ Test email sent successfully!${NC}"
    else
        echo -e "${RED}✗ Failed to send test email${NC}"
        echo "Response: ${response}"
    fi
}

# Enable/disable notifications
toggle() {
    local current=$(get_setting "email_notifications_enabled")
    
    if [ "${current}" = "true" ]; then
        save_setting "email_notifications_enabled" "false"
        echo -e "${YELLOW}Email notifications disabled${NC}"
    else
        save_setting "email_notifications_enabled" "true"
        echo -e "${GREEN}Email notifications enabled${NC}"
    fi
}

case "$1" in
    configure)
        configure
        ;;
    status)
        show_status
        ;;
    test)
        send_test
        ;;
    enable)
        save_setting "email_notifications_enabled" "true"
        echo -e "${GREEN}Email notifications enabled${NC}"
        ;;
    disable)
        save_setting "email_notifications_enabled" "false"
        echo -e "${YELLOW}Email notifications disabled${NC}"
        ;;
    toggle)
        toggle
        ;;
    *)
        echo ""
        echo "WireGuard Email Notification Tool"
        echo "=================================="
        echo ""
        echo "Usage: wg-email <command>"
        echo ""
        echo "Commands:"
        echo "  configure   Interactive setup wizard"
        echo "  status      Show current email configuration"
        echo "  test        Send a test email"
        echo "  enable      Enable email notifications"
        echo "  disable     Disable email notifications"
        echo "  toggle      Toggle email notifications on/off"
        echo ""
        ;;
esac
EMAILEOF

    chmod +x ${INSTALL_DIR}/email-notify.sh
    
    # Create DNS validation script
    cat > ${INSTALL_DIR}/dns-validate.sh <<'DNSEOF'
#!/bin/bash

source /opt/wireguard-manager/config.env

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Get setting from database
get_setting() {
    local key=$1
    export PGPASSWORD="${DB_PASSWORD}"
    psql -h localhost -U ${DB_USER} -d ${DB_NAME} -t -c "
        SELECT setting_value FROM server_settings WHERE setting_key = '${key}';
    " 2>/dev/null | tr -d ' '
}

# DNS validation using dig
validate_dns() {
    local hostname=$1
    local expected_ip=${2:-$(curl -s https://api.ipify.org 2>/dev/null)}
    
    if [ -z "$hostname" ]; then
        echo -e "${RED}Error: Hostname is required${NC}"
        return 1
    fi
    
    echo -e "${CYAN}Validating DNS for: ${hostname}${NC}"
    echo ""
    
    # Get A record
    local a_record=$(dig +short A ${hostname} 2>/dev/null | head -1)
    
    # Get AAAA record
    local aaaa_record=$(dig +short AAAA ${hostname} 2>/dev/null | head -1)
    
    # Get CNAME record
    local cname_record=$(dig +short CNAME ${hostname} 2>/dev/null | head -1)
    
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                   DNS Validation Results                     ║"
    echo "╠══════════════════════════════════════════════════════════════╣"
    echo "║  Hostname:     ${hostname}"
    echo "║  Expected IP:  ${expected_ip:-Not specified}"
    echo "║"
    echo "║  Records Found:"
    
    local status="valid"
    
    if [ -n "$a_record" ]; then
        if [ "$a_record" = "$expected_ip" ]; then
            echo -e "║    A Record:   ${GREEN}✓ ${a_record}${NC}"
        else
            echo -e "║    A Record:   ${YELLOW}⚠ ${a_record} (expected: ${expected_ip})${NC}"
            status="mismatch"
        fi
    else
        echo -e "║    A Record:   ${RED}✗ Not found${NC}"
        status="missing"
    fi
    
    if [ -n "$aaaa_record" ]; then
        echo "║    AAAA:       ${aaaa_record}"
    fi
    
    if [ -n "$cname_record" ]; then
        echo "║    CNAME:      ${cname_record}"
    fi
    
    echo "║"
    
    case $status in
        valid)
            echo -e "║  Status:       ${GREEN}✓ DNS is properly configured${NC}"
            ;;
        mismatch)
            echo -e "║  Status:       ${YELLOW}⚠ IP mismatch - DNS may be outdated${NC}"
            ;;
        missing)
            echo -e "║  Status:       ${RED}✗ DNS record not found${NC}"
            ;;
    esac
    
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    
    [ "$status" = "valid" ] && return 0 || return 1
}

# Validate all peer hostnames
validate_all() {
    local base_domain=$(get_setting "node_base_domain")
    local server_ip=$(curl -s https://api.ipify.org 2>/dev/null)
    
    export PGPASSWORD="${DB_PASSWORD}"
    local peers=$(psql -h localhost -U ${DB_USER} -d ${DB_NAME} -t -c "
        SELECT name, hostname, allowed_ips FROM wireguard_peers WHERE hostname IS NOT NULL;
    ")
    
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║              Bulk DNS Validation Results                     ║"
    echo "╠══════════════════════════════════════════════════════════════╣"
    echo "║  Base Domain:  ${base_domain:-Not configured}"
    echo "║  Server IP:    ${server_ip}"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    
    local total=0
    local valid=0
    local invalid=0
    
    while IFS='|' read -r name hostname allowed_ips; do
        name=$(echo "$name" | tr -d ' ')
        hostname=$(echo "$hostname" | tr -d ' ')
        allowed_ips=$(echo "$allowed_ips" | tr -d ' ')
        
        if [ -n "$hostname" ]; then
            ((total++))
            local a_record=$(dig +short A ${hostname} 2>/dev/null | head -1)
            
            if [ "$a_record" = "$server_ip" ]; then
                echo -e "${GREEN}✓${NC} ${name}: ${hostname} -> ${a_record}"
                ((valid++))
            elif [ -n "$a_record" ]; then
                echo -e "${YELLOW}⚠${NC} ${name}: ${hostname} -> ${a_record} (expected: ${server_ip})"
                ((invalid++))
            else
                echo -e "${RED}✗${NC} ${name}: ${hostname} -> No DNS record"
                ((invalid++))
            fi
        fi
    done <<< "$peers"
    
    echo ""
    echo "Summary: ${valid}/${total} valid, ${invalid} issues"
    echo ""
}

# Check wildcard DNS
check_wildcard() {
    local base_domain=$(get_setting "node_base_domain")
    
    if [ -z "$base_domain" ]; then
        echo -e "${RED}Base domain not configured${NC}"
        return 1
    fi
    
    local server_ip=$(curl -s https://api.ipify.org 2>/dev/null)
    local test_subdomain="test-$(date +%s)"
    local test_hostname="${test_subdomain}.${base_domain}"
    
    echo "Testing wildcard DNS for *.${base_domain}..."
    echo "Test hostname: ${test_hostname}"
    echo ""
    
    local resolved_ip=$(dig +short A ${test_hostname} 2>/dev/null | head -1)
    
    if [ "$resolved_ip" = "$server_ip" ]; then
        echo -e "${GREEN}✓ Wildcard DNS is properly configured!${NC}"
        echo "  *.${base_domain} -> ${server_ip}"
        return 0
    elif [ -n "$resolved_ip" ]; then
        echo -e "${YELLOW}⚠ Wildcard DNS resolves to unexpected IP${NC}"
        echo "  Expected: ${server_ip}"
        echo "  Got: ${resolved_ip}"
        return 1
    else
        echo -e "${RED}✗ Wildcard DNS is not configured${NC}"
        echo ""
        echo "To fix, add this DNS record to your domain:"
        echo "  Type: A"
        echo "  Name: *.${base_domain}"
        echo "  Value: ${server_ip}"
        return 1
    fi
}

# Get propagation status
check_propagation() {
    local hostname=$1
    
    if [ -z "$hostname" ]; then
        echo "Usage: $0 propagation <hostname>"
        return 1
    fi
    
    local dns_servers=("8.8.8.8" "1.1.1.1" "208.67.222.222" "9.9.9.9")
    local dns_names=("Google" "Cloudflare" "OpenDNS" "Quad9")
    
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║              DNS Propagation Check: ${hostname}"
    echo "╠══════════════════════════════════════════════════════════════╣"
    
    for i in "${!dns_servers[@]}"; do
        local server=${dns_servers[$i]}
        local name=${dns_names[$i]}
        local result=$(dig @${server} +short A ${hostname} 2>/dev/null | head -1)
        
        if [ -n "$result" ]; then
            echo -e "║  ${name} (${server}): ${GREEN}${result}${NC}"
        else
            echo -e "║  ${name} (${server}): ${RED}Not resolved${NC}"
        fi
    done
    
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
}

# Help
show_help() {
    echo ""
    echo "WireGuard DNS Validation Tool"
    echo "=============================="
    echo ""
    echo "Usage: wg-dns <command> [options]"
    echo ""
    echo "Commands:"
    echo "  validate <hostname>     Validate DNS for a specific hostname"
    echo "  validate-all            Validate DNS for all peer hostnames"
    echo "  wildcard                Check if wildcard DNS is configured"
    echo "  propagation <hostname>  Check DNS propagation across providers"
    echo "  help                    Show this help message"
    echo ""
    echo "Examples:"
    echo "  wg-dns validate laptop.vpn.example.com"
    echo "  wg-dns validate-all"
    echo "  wg-dns wildcard"
    echo "  wg-dns propagation server.vpn.example.com"
    echo ""
}

case "$1" in
    validate)
        validate_dns "$2" "$3"
        ;;
    validate-all)
        validate_all
        ;;
    wildcard)
        check_wildcard
        ;;
    propagation)
        check_propagation "$2"
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        echo "Usage: $0 {validate|validate-all|wildcard|propagation|help}"
        echo "Run '$0 help' for more information"
        ;;
esac
DNSEOF

    chmod +x ${INSTALL_DIR}/dns-validate.sh
    
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
        echo "DNS Commands:"
        echo "  wg-dns validate <host>   Validate DNS for hostname"
        echo "  wg-dns validate-all      Validate DNS for all peers"
        echo "  wg-dns wildcard          Check wildcard DNS setup"
        echo "  wg-dns propagation <h>   Check DNS propagation"
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
    echo "Backend API: http://${SERVER_ENDPOINT}:3001"
    echo "Dashboard: http://${SERVER_ENDPOINT}"
    echo ""
    echo "Server Token (for cloud sync): ${SERVER_TOKEN}"
    echo ""
    echo "Quick Commands:"
    echo "  ├─ wg-manager status          - Show server status"
    echo "  ├─ wg-manager peer add NAME   - Add new peer"
    echo "  ├─ wg-manager peer list       - List all peers"
    echo "  ├─ wg-noip configure          - Setup No-IP DNS updates"
    echo "  ├─ wg-subdomain configure     - Setup node subdomains"
    echo "  ├─ wg-dns validate-all        - Validate all DNS records"
    echo "  ├─ wg-dns wildcard            - Check wildcard DNS"
    echo "  ├─ wg-email configure         - Setup email notifications"
    echo "  ├─ wg-email test              - Send test notification email"
    echo "  ├─ wg-backup                  - Create backup"
    echo "  ├─ wg-restore FILE            - Restore from backup"
    echo "  ├─ wg-manager update          - Pull updates from GitHub"
    echo "  ├─ wg-manager ssl             - Setup SSL/HTTPS with Let's Encrypt"
    echo "  └─ wg-manager frontend        - Generate frontend connection config"
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
setup_backend_api() {
    print_header "Setting Up Backend API Server"
    
    mkdir -p ${API_DIR}
    
    # Create package.json for API
    cat > ${API_DIR}/package.json <<'PKGEOF'
{
  "name": "wireguard-api",
  "version": "1.0.0",
  "description": "WireGuard Manager Backend API",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "pg": "^8.11.3",
    "bcryptjs": "^2.4.3",
    "jsonwebtoken": "^9.0.2",
    "dotenv": "^16.3.1",
    "ws": "^8.14.2",
    "nodemailer": "^6.9.7"
  }
}
PKGEOF
    
    # Create the API server
    cat > ${API_DIR}/server.js <<'APIEOF'
require('dotenv').config({ path: '/opt/wireguard-manager/config.env' });
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { exec } = require('child_process');
const { WebSocketServer } = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const JWT_SECRET = process.env.SERVER_TOKEN || 'default-secret';

app.use(cors());
app.use(express.json());

// Auth middleware
const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token provided' });
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Admin check middleware
const adminMiddleware = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT role FROM user_roles WHERE user_id = $1',
      [req.user.id]
    );
    if (rows.some(r => r.role === 'admin')) {
      next();
    } else {
      res.status(403).json({ error: 'Admin access required' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
};

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Login
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  
  try {
    const { rows } = await pool.query(
      'SELECT * FROM profiles WHERE username = $1',
      [email]
    );
    
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const user = rows[0];
    
    if (user.is_disabled) {
      return res.status(401).json({ error: 'Account is disabled' });
    }
    
    const token = jwt.sign(
      { id: user.user_id, email: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.json({ token, user: { id: user.user_id, email: user.username, name: user.display_name } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get server status
app.get('/status', authMiddleware, async (req, res) => {
  try {
    const { rows: settings } = await pool.query('SELECT * FROM server_settings');
    const { rows: peers } = await pool.query('SELECT * FROM wireguard_peers');
    
    res.json({
      settings: settings.reduce((acc, s) => ({ ...acc, [s.setting_key]: s.setting_value }), {}),
      peers,
      uptime: process.uptime()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get peers
app.get('/peers', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT wp.*, pg.name as group_name, pg.color as group_color
      FROM wireguard_peers wp
      LEFT JOIN peer_groups pg ON wp.group_id = pg.id
      ORDER BY wp.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create peer
app.post('/peers', authMiddleware, adminMiddleware, async (req, res) => {
  const { name, group_id } = req.body;
  
  try {
    // Generate keys using wg CLI
    const { stdout: privateKey } = await new Promise((resolve, reject) => {
      exec('wg genkey', (err, stdout) => {
        if (err) reject(err);
        else resolve({ stdout: stdout.trim() });
      });
    });
    
    const { stdout: publicKey } = await new Promise((resolve, reject) => {
      exec(`echo "${privateKey}" | wg pubkey`, (err, stdout) => {
        if (err) reject(err);
        else resolve({ stdout: stdout.trim() });
      });
    });
    
    // Get next available IP
    const { rows: lastPeer } = await pool.query(`
      SELECT allowed_ips FROM wireguard_peers 
      WHERE allowed_ips LIKE '10.0.0.%'
      ORDER BY created_at DESC LIMIT 1
    `);
    
    let nextIP = '10.0.0.2';
    if (lastPeer.length > 0) {
      const lastOctet = parseInt(lastPeer[0].allowed_ips.split('.')[3].split('/')[0]);
      nextIP = `10.0.0.${lastOctet + 1}`;
    }
    
    // Check subdomain settings
    const { rows: settings } = await pool.query(`
      SELECT setting_key, setting_value FROM server_settings 
      WHERE setting_key IN ('node_domain_enabled', 'node_base_domain')
    `);
    
    const config = settings.reduce((acc, s) => ({ ...acc, [s.setting_key]: s.setting_value }), {});
    let subdomain = null;
    let hostname = null;
    
    if (config.node_domain_enabled === 'true' && config.node_base_domain) {
      subdomain = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      hostname = `${subdomain}.${config.node_base_domain}`;
    }
    
    // Insert into database
    const { rows } = await pool.query(`
      INSERT INTO wireguard_peers (name, public_key, private_key, allowed_ips, dns, group_id, subdomain, hostname, created_by)
      VALUES ($1, $2, $3, $4, '1.1.1.1', $5, $6, $7, $8)
      RETURNING *
    `, [name, publicKey, privateKey, `${nextIP}/32`, group_id, subdomain, hostname, req.user.id]);
    
    // Add to WireGuard
    exec(`wg set wg0 peer ${publicKey} allowed-ips ${nextIP}/32 && wg-quick save wg0`);
    
    // Create notification for new peer
    await pool.query(`
      INSERT INTO peer_notifications (peer_id, peer_name, event_type)
      VALUES ($1, $2, 'added')
    `, [rows[0].id, name]);
    
    // Broadcast to WebSocket clients
    broadcastUpdate('peer_created', rows[0]);
    
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Delete peer
app.delete('/peers/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM wireguard_peers WHERE id = $1', [req.params.id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Peer not found' });
    }
    
    const peer = rows[0];
    
    // Remove from WireGuard
    exec(`wg set wg0 peer ${peer.public_key} remove && wg-quick save wg0`);
    
    // Create notification for removed peer
    await pool.query(`
      INSERT INTO peer_notifications (peer_id, peer_name, event_type)
      VALUES ($1, $2, 'removed')
    `, [req.params.id, peer.name]);
    
    // Delete from database
    await pool.query('DELETE FROM wireguard_peers WHERE id = $1', [req.params.id]);
    
    broadcastUpdate('peer_deleted', { id: req.params.id, name: peer.name });
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update peer
app.put('/peers/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const { name, group_id, subdomain } = req.body;
  
  try {
    // Get base domain for hostname
    const { rows: settings } = await pool.query(`
      SELECT setting_value FROM server_settings WHERE setting_key = 'node_base_domain'
    `);
    
    const baseDomain = settings[0]?.setting_value;
    const hostname = subdomain && baseDomain ? `${subdomain}.${baseDomain}` : null;
    
    const { rows } = await pool.query(`
      UPDATE wireguard_peers 
      SET name = COALESCE($1, name),
          group_id = $2,
          subdomain = $3,
          hostname = $4,
          updated_at = NOW()
      WHERE id = $5
      RETURNING *
    `, [name, group_id, subdomain, hostname, req.params.id]);
    
    broadcastUpdate('peer_updated', rows[0]);
    
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get peer groups
app.get('/peer-groups', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM peer_groups ORDER BY name');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get server settings
app.get('/settings', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM server_settings');
    res.json(rows.reduce((acc, s) => ({ ...acc, [s.setting_key]: s.setting_value }), {}));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update server settings
app.put('/settings', authMiddleware, adminMiddleware, async (req, res) => {
  const settings = req.body;
  
  try {
    for (const [key, value] of Object.entries(settings)) {
      await pool.query(`
        INSERT INTO server_settings (setting_key, setting_value, updated_at, updated_by)
        VALUES ($1, $2, NOW(), $3)
        ON CONFLICT (setting_key) DO UPDATE SET
          setting_value = EXCLUDED.setting_value,
          updated_at = NOW(),
          updated_by = EXCLUDED.updated_by
      `, [key, value, req.user.id]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// NoIP update endpoint
app.post('/noip/update', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { rows: settings } = await pool.query(`
      SELECT setting_key, setting_value FROM server_settings 
      WHERE setting_key IN ('noip_username', 'noip_password', 'noip_hostname')
    `);
    
    const config = settings.reduce((acc, s) => ({ ...acc, [s.setting_key]: s.setting_value }), {});
    
    if (!config.noip_username || !config.noip_password || !config.noip_hostname) {
      return res.status(400).json({ error: 'NoIP not configured' });
    }
    
    // Get current public IP
    const { stdout: currentIP } = await new Promise((resolve, reject) => {
      exec('curl -s https://api.ipify.org', (err, stdout) => {
        if (err) reject(err);
        else resolve({ stdout: stdout.trim() });
      });
    });
    
    // Call No-IP API
    const auth = Buffer.from(`${config.noip_username}:${config.noip_password}`).toString('base64');
    const response = await fetch(
      `https://dynupdate.no-ip.com/nic/update?hostname=${config.noip_hostname}&myip=${currentIP}`,
      {
        headers: {
          'Authorization': `Basic ${auth}`,
          'User-Agent': 'WireGuard-Manager/1.0'
        }
      }
    );
    
    const result = await response.text();
    
    // Update settings with result
    await pool.query(`
      INSERT INTO server_settings (setting_key, setting_value, updated_at)
      VALUES ('noip_last_ip', $1, NOW()),
             ('noip_last_update', $2, NOW()),
             ('noip_last_response', $3, NOW())
      ON CONFLICT (setting_key) DO UPDATE SET
        setting_value = EXCLUDED.setting_value,
        updated_at = NOW()
    `, [currentIP, new Date().toISOString(), result]);
    
    res.json({ success: true, ip: currentIP, response: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Subdomain management
app.post('/subdomains/assign', authMiddleware, adminMiddleware, async (req, res) => {
  const { peer_id, subdomain } = req.body;
  
  try {
    const { rows: settings } = await pool.query(`
      SELECT setting_value FROM server_settings WHERE setting_key = 'node_base_domain'
    `);
    
    const baseDomain = settings[0]?.setting_value;
    
    if (!baseDomain) {
      return res.status(400).json({ error: 'Base domain not configured' });
    }
    
    const hostname = `${subdomain}.${baseDomain}`;
    
    const { rows } = await pool.query(`
      UPDATE wireguard_peers 
      SET subdomain = $1, hostname = $2, updated_at = NOW()
      WHERE id = $3
      RETURNING *
    `, [subdomain, hostname, peer_id]);
    
    broadcastUpdate('peer_updated', rows[0]);
    
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Traffic stats
app.get('/traffic-stats', authMiddleware, async (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  
  try {
    const { rows } = await pool.query(`
      SELECT * FROM traffic_stats
      WHERE recorded_at >= NOW() - INTERVAL '${hours} hours'
      ORDER BY recorded_at ASC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Audit logs
app.get('/audit-logs', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get notifications
app.get('/notifications', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT * FROM peer_notifications ORDER BY created_at DESC LIMIT 50
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark notification as read
app.put('/notifications/:id/read', authMiddleware, async (req, res) => {
  try {
    await pool.query('UPDATE peer_notifications SET read = true WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark all notifications as read
app.put('/notifications/read-all', authMiddleware, async (req, res) => {
  try {
    await pool.query('UPDATE peer_notifications SET read = true');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clear all notifications
app.delete('/notifications', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM peer_notifications');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DNS validation endpoint
app.post('/dns/validate', authMiddleware, async (req, res) => {
  const { hostname } = req.body;
  
  try {
    const { stdout: result } = await new Promise((resolve, reject) => {
      exec(`dig +short A ${hostname}`, (err, stdout) => {
        if (err) reject(err);
        else resolve({ stdout: stdout.trim() });
      });
    });
    
    // Get server IP
    const { stdout: serverIP } = await new Promise((resolve, reject) => {
      exec('curl -s https://api.ipify.org', (err, stdout) => {
        if (err) reject(err);
        else resolve({ stdout: stdout.trim() });
      });
    });
    
    const resolved_ip = result.split('\\n')[0];
    const valid = resolved_ip === serverIP;
    
    res.json({
      hostname,
      resolved_ip: resolved_ip || null,
      expected_ip: serverIP,
      valid,
      status: resolved_ip ? (valid ? 'valid' : 'mismatch') : 'not_found'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk DNS validation
app.get('/dns/validate-all', authMiddleware, async (req, res) => {
  try {
    const { rows: peers } = await pool.query(`
      SELECT id, name, hostname FROM wireguard_peers WHERE hostname IS NOT NULL
    `);
    
    const { stdout: serverIP } = await new Promise((resolve, reject) => {
      exec('curl -s https://api.ipify.org', (err, stdout) => {
        if (err) reject(err);
        else resolve({ stdout: stdout.trim() });
      });
    });
    
    const results = await Promise.all(peers.map(async (peer) => {
      try {
        const { stdout: result } = await new Promise((resolve, reject) => {
          exec(`dig +short A ${peer.hostname}`, (err, stdout) => {
            if (err) reject(err);
            else resolve({ stdout: stdout.trim() });
          });
        });
        
        const resolved_ip = result.split('\\n')[0];
        const valid = resolved_ip === serverIP;
        
        return {
          peer_id: peer.id,
          peer_name: peer.name,
          hostname: peer.hostname,
          resolved_ip: resolved_ip || null,
          expected_ip: serverIP,
          valid,
          status: resolved_ip ? (valid ? 'valid' : 'mismatch') : 'not_found'
        };
      } catch {
        return {
          peer_id: peer.id,
          peer_name: peer.name,
          hostname: peer.hostname,
          resolved_ip: null,
          expected_ip: serverIP,
          valid: false,
          status: 'error'
        };
      }
    }));
    
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Email notification helper
const nodemailer = require('nodemailer');

async function sendEmailNotification(eventType, peerName, peerIP) {
  try {
    const { rows: settings } = await pool.query(\`
      SELECT setting_key, setting_value FROM server_settings 
      WHERE setting_key IN (
        'email_notifications_enabled', 'notification_email', 'smtp_host', 
        'smtp_port', 'smtp_user', 'smtp_password', 'smtp_from',
        'notify_on_connect', 'notify_on_disconnect', 'notify_on_peer_added', 'notify_on_peer_removed'
      )
    \`);
    
    const config = settings.reduce((acc, s) => ({ ...acc, [s.setting_key]: s.setting_value }), {});
    
    if (config.email_notifications_enabled !== 'true') {
      console.log('Email notifications disabled');
      return;
    }
    
    // Check if this event type should trigger notification
    const eventConfig = {
      'connected': config.notify_on_connect,
      'disconnected': config.notify_on_disconnect,
      'added': config.notify_on_peer_added,
      'removed': config.notify_on_peer_removed,
    };
    
    if (eventConfig[eventType] !== 'true') {
      console.log(\`Notifications for \${eventType} disabled\`);
      return;
    }
    
    if (!config.notification_email || !config.smtp_host) {
      console.log('Email configuration incomplete');
      return;
    }
    
    const transporter = nodemailer.createTransport({
      host: config.smtp_host,
      port: parseInt(config.smtp_port || '587'),
      secure: config.smtp_port === '465',
      auth: config.smtp_user ? {
        user: config.smtp_user,
        pass: config.smtp_password,
      } : undefined,
    });
    
    const eventLabels = {
      connected: '🟢 Connected',
      disconnected: '🔴 Disconnected',
      added: '➕ Added',
      removed: '🗑️ Removed',
    };
    
    const eventColors = {
      connected: '#22c55e',
      disconnected: '#ef4444',
      added: '#3b82f6',
      removed: '#f59e0b',
    };
    
    const subject = \`WireGuard: \${peerName} \${eventType}\`;
    const html = \`
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #fff; padding: 20px; }
          .container { max-width: 600px; margin: 0 auto; background: #1e293b; border-radius: 12px; padding: 30px; }
          .header { text-align: center; margin-bottom: 20px; font-size: 24px; font-weight: bold; color: #3b82f6; }
          .badge { display: inline-block; padding: 8px 16px; border-radius: 8px; font-weight: 600; background: \${eventColors[eventType]}20; color: \${eventColors[eventType]}; border: 1px solid \${eventColors[eventType]}40; margin: 20px 0; }
          .details { background: #0f172a; border-radius: 8px; padding: 20px; }
          .row { padding: 10px 0; border-bottom: 1px solid #334155; display: flex; justify-content: space-between; }
          .row:last-child { border-bottom: none; }
          .label { color: #94a3b8; }
          .value { color: #fff; font-weight: 500; }
          .footer { text-align: center; margin-top: 20px; color: #64748b; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">🔐 WireGuard Manager</div>
          <div style="text-align: center;">
            <span class="badge">\${eventLabels[eventType] || eventType}</span>
          </div>
          <div class="details">
            <div class="row"><span class="label">Peer Name</span><span class="value">\${peerName}</span></div>
            \${peerIP ? '<div class="row"><span class="label">IP Address</span><span class="value">' + peerIP + '</span></div>' : ''}
            <div class="row"><span class="label">Event</span><span class="value">\${eventType}</span></div>
            <div class="row"><span class="label">Time</span><span class="value">\${new Date().toLocaleString()}</span></div>
          </div>
          <div class="footer">Automated notification from your WireGuard VPN server</div>
        </div>
      </body>
      </html>
    \`;
    
    await transporter.sendMail({
      from: config.smtp_from || 'noreply@wireguard-manager.local',
      to: config.notification_email,
      subject,
      html,
    });
    
    console.log(\`Email notification sent to \${config.notification_email} for \${eventType}: \${peerName}\`);
  } catch (err) {
    console.error('Failed to send email notification:', err.message);
  }
}

// Send test email endpoint
app.post('/email/test', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await sendEmailNotification('connected', 'Test Peer', '10.0.0.100');
    res.json({ success: true, message: 'Test email sent' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get email settings
app.get('/email/settings', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(\`
      SELECT setting_key, setting_value FROM server_settings 
      WHERE setting_key LIKE 'email%' OR setting_key LIKE 'smtp%' OR setting_key LIKE 'notify%' OR setting_key = 'notification_email'
    \`);
    res.json(rows.reduce((acc, s) => ({ ...acc, [s.setting_key]: s.setting_value }), {}));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update email settings
app.put('/email/settings', authMiddleware, adminMiddleware, async (req, res) => {
  const settings = req.body;
  
  try {
    for (const [key, value] of Object.entries(settings)) {
      await pool.query(\`
        INSERT INTO server_settings (setting_key, setting_value, updated_at, updated_by)
        VALUES (\$1, \$2, NOW(), \$3)
        ON CONFLICT (setting_key) DO UPDATE SET
          setting_value = EXCLUDED.setting_value,
          updated_at = NOW(),
          updated_by = EXCLUDED.updated_by
      \`, [key, value, req.user.id]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Internal endpoint for sync script to trigger email notifications (no auth required, localhost only)
app.post('/internal/email-notify', async (req, res) => {
  // Only allow from localhost
  const ip = req.ip || req.connection.remoteAddress;
  if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  const { peer_name, event_type, peer_ip } = req.body;
  
  if (!peer_name || !event_type) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  try {
    await sendEmailNotification(event_type, peer_name, peer_ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// WebSocket broadcast function
function broadcastUpdate(type, data) {
  const message = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(message);
    }
  });
  
  // Trigger email notification for peer events
  if (type === 'peer_created') {
    sendEmailNotification('added', data.name, data.allowed_ips);
  } else if (type === 'peer_deleted') {
    sendEmailNotification('removed', data.name, null);
  }
}

// WebSocket connection handler
wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  ws.on('close', () => console.log('WebSocket client disconnected'));
});

const PORT = process.env.API_PORT || 3001;
server.listen(PORT, () => {
  console.log(\`API server running on port \${PORT}\`);
});
APIEOF
    
    # Install dependencies
    cd ${API_DIR}
    npm install
    
    # Create PM2 ecosystem file
    cat > ${API_DIR}/ecosystem.config.js <<'PM2EOF'
module.exports = {
  apps: [{
    name: 'wireguard-api',
    script: 'server.js',
    cwd: '/opt/wireguard-manager/api',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '256M',
    env: {
      NODE_ENV: 'production'
    }
  }]
};
PM2EOF
    
    # Start API with PM2
    pm2 start ${API_DIR}/ecosystem.config.js
    pm2 save
    pm2 startup systemd -u root --hp /root
    
    print_success "Backend API server installed and running on port 3001"
}

setup_frontend() {
    print_header "Setting Up Frontend Dashboard"
    
    mkdir -p ${WEB_DIR}
    
    # Check if GitHub repo is provided
    if [ -n "${GITHUB_REPO}" ]; then
        print_info "Cloning frontend from GitHub..."
        git clone ${GITHUB_REPO} ${WEB_DIR}
        cd ${WEB_DIR}
        npm install
        npm run build
    else
        # Create a basic placeholder page
        mkdir -p ${WEB_DIR}/dist
        cat > ${WEB_DIR}/dist/index.html <<'HTMLEOF'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WireGuard Manager</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #fff;
        }
        .container {
            text-align: center;
            padding: 40px;
            background: rgba(255,255,255,0.05);
            border-radius: 20px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.1);
            max-width: 600px;
        }
        h1 { font-size: 2.5rem; margin-bottom: 20px; color: #4ade80; }
        p { color: #94a3b8; margin-bottom: 15px; line-height: 1.6; }
        .status { 
            display: inline-flex; 
            align-items: center; 
            gap: 8px;
            background: rgba(74, 222, 128, 0.2);
            padding: 8px 16px;
            border-radius: 20px;
            margin-bottom: 30px;
        }
        .status-dot {
            width: 8px;
            height: 8px;
            background: #4ade80;
            border-radius: 50%;
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        code {
            background: rgba(255,255,255,0.1);
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 0.9em;
        }
        .commands {
            text-align: left;
            background: rgba(0,0,0,0.3);
            padding: 20px;
            border-radius: 10px;
            margin-top: 20px;
        }
        .commands code {
            display: block;
            margin: 8px 0;
            padding: 8px;
            background: rgba(255,255,255,0.05);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="status">
            <span class="status-dot"></span>
            <span>Server Running</span>
        </div>
        <h1>🔐 WireGuard Manager</h1>
        <p>Your WireGuard VPN server is installed and running!</p>
        <p>To deploy the full dashboard, set up your GitHub repository:</p>
        <div class="commands">
            <p><strong>Commands:</strong></p>
            <code>wg-manager set-github</code>
            <code>wg-manager update</code>
            <p style="margin-top: 15px;"><strong>Or use CLI:</strong></p>
            <code>wg-manager status</code>
            <code>wg-manager peer add &lt;name&gt;</code>
            <code>wg-noip configure</code>
            <code>wg-subdomain configure</code>
        </div>
    </div>
</body>
</html>
HTMLEOF
        print_info "Placeholder page created. Deploy full UI with: wg-manager set-github && wg-manager update"
    fi
    
    print_success "Frontend setup complete"
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
    setup_backend_api
    setup_frontend
    setup_nginx
    
    echo ""
    read -p "Would you like to set up a GitHub repository for the dashboard? (yes/no): " setup_github
    if [ "$setup_github" = "yes" ]; then
        read -p "Enter GitHub repository URL: " github_url
        sed -i "s|GITHUB_REPO=.*|GITHUB_REPO=\"${github_url}\"|" ${CONFIG_FILE}
        GITHUB_REPO="${github_url}"
        /usr/local/bin/wg-update
    fi
    
    echo ""
    read -p "Would you like to configure node subdomains? (yes/no): " setup_subdomains
    if [ "$setup_subdomains" = "yes" ]; then
        /usr/local/bin/wg-subdomain configure
    fi
    
    echo ""
    read -p "Would you like to configure No-IP DNS? (yes/no): " setup_noip
    if [ "$setup_noip" = "yes" ]; then
        /usr/local/bin/wg-noip configure
    fi
    
    echo ""
    read -p "Would you like to create an admin user now? (yes/no): " create_admin
    if [ "$create_admin" = "yes" ]; then
        create_admin_user
    fi
    
    echo ""
    read -p "Would you like to set up SSL/HTTPS now? (yes/no): " setup_ssl_choice
    if [ "$setup_ssl_choice" = "yes" ]; then
        setup_ssl
    fi
    
    print_summary
}

main "$@"
