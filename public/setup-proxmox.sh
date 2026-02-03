#!/bin/bash
#
# WireGuard Manager - Proxmox LXC Container Setup Script
# Automatically creates an LXC container with all requirements
#
# Usage: ./setup-proxmox.sh
#
# This script will:
# 1. Create a new LXC container on Proxmox
# 2. Configure networking and resources
# 3. Install WireGuard and all dependencies
# 4. Set up the dashboard with backend API
#
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Default Configuration
CONTAINER_ID=""
CONTAINER_NAME="wireguard-manager"
TEMPLATE="local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst"
STORAGE="local-lvm"
DISK_SIZE="8"
MEMORY="1024"
SWAP="512"
CORES="2"
BRIDGE="vmbr0"
IP_ADDRESS=""
GATEWAY=""
DNS_SERVER="1.1.1.1"
PASSWORD=""
SSH_KEY=""
START_AFTER_CREATE="yes"
INSTALL_SCRIPT_URL="https://raw.githubusercontent.com/your-repo/wireguard-manager/main/public/install-wireguard.sh"

print_banner() {
    echo -e "${CYAN}"
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║     WireGuard Manager - Proxmox LXC Container Setup          ║"
    echo "║              Automated Container Deployment                   ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

check_proxmox() {
    if ! command -v pct &> /dev/null; then
        log_error "This script must be run on a Proxmox VE host"
        log_error "pct command not found"
        exit 1
    fi
    
    if ! command -v pvesh &> /dev/null; then
        log_error "pvesh command not found"
        exit 1
    fi
    
    log_success "Proxmox VE detected"
}

check_template() {
    log_info "Checking for Ubuntu 22.04 template..."
    
    # List available templates
    TEMPLATES=$(pveam list local 2>/dev/null || true)
    
    if echo "$TEMPLATES" | grep -q "ubuntu-22.04"; then
        TEMPLATE=$(echo "$TEMPLATES" | grep "ubuntu-22.04" | head -1 | awk '{print $1}')
        log_success "Found template: $TEMPLATE"
    else
        log_warning "Ubuntu 22.04 template not found. Downloading..."
        pveam update
        pveam download local ubuntu-22.04-standard_22.04-1_amd64.tar.zst
        TEMPLATE="local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst"
        log_success "Template downloaded"
    fi
}

get_next_vmid() {
    # Find the next available VMID
    NEXT_ID=$(pvesh get /cluster/nextid 2>/dev/null || echo "100")
    echo "$NEXT_ID"
}

prompt_configuration() {
    echo ""
    echo -e "${CYAN}=== Container Configuration ===${NC}"
    echo ""
    
    # Container ID
    DEFAULT_ID=$(get_next_vmid)
    read -p "Container ID [$DEFAULT_ID]: " CONTAINER_ID
    CONTAINER_ID=${CONTAINER_ID:-$DEFAULT_ID}
    
    # Container Name
    read -p "Container Name [$CONTAINER_NAME]: " input
    CONTAINER_NAME=${input:-$CONTAINER_NAME}
    
    # Storage
    echo ""
    log_info "Available storage:"
    pvesm status | grep -E "^[a-zA-Z]" | awk '{print "  - "$1" ("$2")"}'
    read -p "Storage [$STORAGE]: " input
    STORAGE=${input:-$STORAGE}
    
    # Disk Size
    read -p "Disk Size in GB [$DISK_SIZE]: " input
    DISK_SIZE=${input:-$DISK_SIZE}
    
    # Memory
    read -p "Memory in MB [$MEMORY]: " input
    MEMORY=${input:-$MEMORY}
    
    # CPU Cores
    read -p "CPU Cores [$CORES]: " input
    CORES=${input:-$CORES}
    
    # Network
    echo ""
    echo -e "${CYAN}=== Network Configuration ===${NC}"
    echo ""
    
    # Bridge
    log_info "Available bridges:"
    ip link show type bridge | grep -oP "^\d+: \K[^:@]+" | while read br; do
        echo "  - $br"
    done
    read -p "Network Bridge [$BRIDGE]: " input
    BRIDGE=${input:-$BRIDGE}
    
    # IP Address
    echo ""
    read -p "IP Address (e.g., 192.168.1.100/24) or 'dhcp': " IP_ADDRESS
    if [ "$IP_ADDRESS" != "dhcp" ] && [ -n "$IP_ADDRESS" ]; then
        read -p "Gateway (e.g., 192.168.1.1): " GATEWAY
    fi
    
    # DNS
    read -p "DNS Server [$DNS_SERVER]: " input
    DNS_SERVER=${input:-$DNS_SERVER}
    
    # Root Password
    echo ""
    echo -e "${CYAN}=== Security Configuration ===${NC}"
    echo ""
    while [ -z "$PASSWORD" ]; do
        read -sp "Root Password (required): " PASSWORD
        echo ""
        if [ -z "$PASSWORD" ]; then
            log_error "Password is required"
        fi
    done
    
    # SSH Key (optional)
    read -p "SSH Public Key file path (optional, press Enter to skip): " SSH_KEY_PATH
    if [ -n "$SSH_KEY_PATH" ] && [ -f "$SSH_KEY_PATH" ]; then
        SSH_KEY=$(cat "$SSH_KEY_PATH")
    fi
    
    # Confirm
    echo ""
    echo -e "${CYAN}=== Configuration Summary ===${NC}"
    echo "  Container ID:    $CONTAINER_ID"
    echo "  Container Name:  $CONTAINER_NAME"
    echo "  Template:        $TEMPLATE"
    echo "  Storage:         $STORAGE"
    echo "  Disk Size:       ${DISK_SIZE}GB"
    echo "  Memory:          ${MEMORY}MB"
    echo "  CPU Cores:       $CORES"
    echo "  Network Bridge:  $BRIDGE"
    echo "  IP Address:      ${IP_ADDRESS:-dhcp}"
    echo "  Gateway:         ${GATEWAY:-auto}"
    echo "  DNS Server:      $DNS_SERVER"
    echo ""
    
    read -p "Proceed with container creation? (y/n): " CONFIRM
    if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
        log_info "Cancelled by user"
        exit 0
    fi
}

create_container() {
    log_info "Creating LXC container $CONTAINER_ID..."
    
    # Build network configuration
    if [ "$IP_ADDRESS" = "dhcp" ]; then
        NET_CONFIG="name=eth0,bridge=$BRIDGE,ip=dhcp"
    elif [ -n "$IP_ADDRESS" ]; then
        NET_CONFIG="name=eth0,bridge=$BRIDGE,ip=$IP_ADDRESS,gw=$GATEWAY"
    else
        NET_CONFIG="name=eth0,bridge=$BRIDGE,ip=dhcp"
    fi
    
    # Create container
    pct create "$CONTAINER_ID" "$TEMPLATE" \
        --hostname "$CONTAINER_NAME" \
        --storage "$STORAGE" \
        --rootfs "$STORAGE:$DISK_SIZE" \
        --memory "$MEMORY" \
        --swap "$SWAP" \
        --cores "$CORES" \
        --net0 "$NET_CONFIG" \
        --nameserver "$DNS_SERVER" \
        --password "$PASSWORD" \
        --unprivileged 0 \
        --features nesting=1,keyctl=1 \
        --onboot 1 \
        --start 0
    
    log_success "Container $CONTAINER_ID created"
}

configure_container() {
    log_info "Configuring container for WireGuard..."
    
    # Add necessary capabilities for WireGuard
    cat >> /etc/pve/lxc/${CONTAINER_ID}.conf << 'EOF'

# WireGuard specific configuration
lxc.cgroup2.devices.allow: c 10:200 rwm
lxc.mount.entry: /dev/net dev/net none bind,create=dir
lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file
EOF
    
    # If SSH key provided, add it
    if [ -n "$SSH_KEY" ]; then
        log_info "Adding SSH public key..."
        mkdir -p /var/lib/lxc/${CONTAINER_ID}/rootfs/root/.ssh
        echo "$SSH_KEY" > /var/lib/lxc/${CONTAINER_ID}/rootfs/root/.ssh/authorized_keys
        chmod 700 /var/lib/lxc/${CONTAINER_ID}/rootfs/root/.ssh
        chmod 600 /var/lib/lxc/${CONTAINER_ID}/rootfs/root/.ssh/authorized_keys
    fi
    
    log_success "Container configured"
}

start_container() {
    log_info "Starting container $CONTAINER_ID..."
    pct start "$CONTAINER_ID"
    
    # Wait for container to be ready
    log_info "Waiting for container to be ready..."
    sleep 10
    
    # Wait for network
    for i in {1..30}; do
        if pct exec "$CONTAINER_ID" -- ping -c 1 1.1.1.1 &>/dev/null; then
            log_success "Container network is ready"
            break
        fi
        sleep 2
    done
    
    log_success "Container $CONTAINER_ID started"
}

install_wireguard_manager() {
    log_info "Installing WireGuard Manager inside container..."
    
    # Update and install base packages
    pct exec "$CONTAINER_ID" -- bash -c "
        export DEBIAN_FRONTEND=noninteractive
        apt-get update
        apt-get upgrade -y
        apt-get install -y curl wget git sudo
    "
    
    # Create the install script inside the container
    log_info "Creating installation script..."
    
    # Copy the install script
    pct exec "$CONTAINER_ID" -- bash -c "
        curl -fsSL 'https://raw.githubusercontent.com/your-repo/wireguard-manager/main/public/install-wireguard.sh' -o /root/install-wireguard.sh || {
            # If curl fails, create a minimal version
            cat > /root/install-wireguard.sh << 'SCRIPT'
#!/bin/bash
set -e

echo '=== WireGuard Manager Installation ==='

# Update system
apt-get update
apt-get upgrade -y

# Install WireGuard
apt-get install -y wireguard wireguard-tools

# Install dependencies
apt-get install -y \
    postgresql postgresql-contrib \
    nginx \
    certbot python3-certbot-nginx \
    nodejs npm \
    ufw \
    qrencode \
    dnsutils \
    jq

# Enable IP forwarding
echo 'net.ipv4.ip_forward = 1' >> /etc/sysctl.conf
echo 'net.ipv6.conf.all.forwarding = 1' >> /etc/sysctl.conf
sysctl -p

# Generate WireGuard keys
umask 077
wg genkey | tee /etc/wireguard/server_private.key | wg pubkey > /etc/wireguard/server_public.key

# Configure WireGuard interface
PRIVATE_KEY=\$(cat /etc/wireguard/server_private.key)
DEFAULT_IFACE=\$(ip route | grep default | awk '{print \$5}' | head -1)

cat > /etc/wireguard/wg0.conf << WGCONF
[Interface]
Address = 10.0.0.1/24
ListenPort = 51820
PrivateKey = \$PRIVATE_KEY
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o \$DEFAULT_IFACE -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o \$DEFAULT_IFACE -j MASQUERADE
WGCONF

chmod 600 /etc/wireguard/wg0.conf

# Enable WireGuard
systemctl enable wg-quick@wg0
systemctl start wg-quick@wg0

# Configure firewall
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 51820/udp
ufw --force enable

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Install PM2
npm install -g pm2

echo ''
echo '=== Installation Complete ==='
echo ''
echo 'WireGuard Status:'
wg show
echo ''
echo 'Server Public Key:'
cat /etc/wireguard/server_public.key
echo ''
SCRIPT
        }
        chmod +x /root/install-wireguard.sh
    "
    
    # Run the installation script
    log_info "Running WireGuard installation (this may take a few minutes)..."
    pct exec "$CONTAINER_ID" -- bash -c "/root/install-wireguard.sh"
    
    log_success "WireGuard Manager installed"
}

get_container_ip() {
    # Get container IP
    IP=$(pct exec "$CONTAINER_ID" -- hostname -I 2>/dev/null | awk '{print $1}')
    echo "$IP"
}

print_summary() {
    CONTAINER_IP=$(get_container_ip)
    
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║              Installation Complete!                          ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${CYAN}Container Details:${NC}"
    echo "  Container ID:    $CONTAINER_ID"
    echo "  Container Name:  $CONTAINER_NAME"
    echo "  IP Address:      $CONTAINER_IP"
    echo ""
    echo -e "${CYAN}Access Methods:${NC}"
    echo "  Proxmox Console: pct enter $CONTAINER_ID"
    echo "  SSH Access:      ssh root@$CONTAINER_IP"
    echo ""
    echo -e "${CYAN}WireGuard:${NC}"
    echo "  Status:          pct exec $CONTAINER_ID -- wg show"
    echo "  VPN Port:        51820/UDP"
    echo ""
    echo -e "${CYAN}Next Steps:${NC}"
    echo "  1. Connect to the container:"
    echo "     pct enter $CONTAINER_ID"
    echo ""
    echo "  2. Run the full setup script if needed:"
    echo "     /root/install-wireguard.sh"
    echo ""
    echo "  3. Configure SSL (if you have a domain):"
    echo "     certbot --nginx -d your-domain.com"
    echo ""
    echo "  4. Access the dashboard:"
    echo "     http://$CONTAINER_IP"
    echo ""
    echo -e "${YELLOW}Security Reminder:${NC}"
    echo "  - Change the default passwords"
    echo "  - Configure firewall rules as needed"
    echo "  - Set up regular backups"
    echo ""
}

# Cleanup function
cleanup() {
    if [ $? -ne 0 ]; then
        log_error "Installation failed!"
        if [ -n "$CONTAINER_ID" ]; then
            read -p "Do you want to remove the partially created container? (y/n): " REMOVE
            if [ "$REMOVE" = "y" ] || [ "$REMOVE" = "Y" ]; then
                pct stop "$CONTAINER_ID" 2>/dev/null || true
                pct destroy "$CONTAINER_ID" 2>/dev/null || true
                log_info "Container $CONTAINER_ID removed"
            fi
        fi
    fi
}

# Advanced options menu
advanced_options() {
    echo ""
    echo -e "${CYAN}=== Advanced Options ===${NC}"
    echo "1. Create container with default settings"
    echo "2. Create container with custom settings"
    echo "3. Install on existing container"
    echo "4. Generate install script only"
    echo "5. Exit"
    echo ""
    read -p "Select option [1]: " OPTION
    OPTION=${OPTION:-1}
    
    case $OPTION in
        1)
            # Use defaults with auto-generated values
            CONTAINER_ID=$(get_next_vmid)
            IP_ADDRESS="dhcp"
            while [ -z "$PASSWORD" ]; do
                read -sp "Root Password (required): " PASSWORD
                echo ""
            done
            ;;
        2)
            prompt_configuration
            ;;
        3)
            read -p "Enter existing Container ID: " CONTAINER_ID
            if ! pct status "$CONTAINER_ID" &>/dev/null; then
                log_error "Container $CONTAINER_ID does not exist"
                exit 1
            fi
            pct start "$CONTAINER_ID" 2>/dev/null || true
            install_wireguard_manager
            print_summary
            exit 0
            ;;
        4)
            log_info "Generating install script..."
            cat > ./wireguard-install.sh << 'SCRIPT'
#!/bin/bash
# Run this inside the container
curl -fsSL https://raw.githubusercontent.com/your-repo/wireguard-manager/main/public/install-wireguard.sh | bash
SCRIPT
            chmod +x ./wireguard-install.sh
            log_success "Script saved to ./wireguard-install.sh"
            exit 0
            ;;
        5)
            exit 0
            ;;
        *)
            log_error "Invalid option"
            exit 1
            ;;
    esac
}

# Main execution
trap cleanup EXIT

print_banner

# Check if running on Proxmox
check_proxmox

# Check for template
check_template

# Show options
advanced_options

# Create and configure container
create_container
configure_container
start_container
install_wireguard_manager

# Print summary
print_summary

log_success "Setup complete!"
