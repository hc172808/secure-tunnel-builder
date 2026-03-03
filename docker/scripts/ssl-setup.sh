#!/bin/bash
# ──────────────────────────────────────────────────────────────
# SSL/TLS Setup Script — Let's Encrypt via Certbot
# Called by entrypoint.sh when ENABLE_SSL=true and DOMAIN is set
# ──────────────────────────────────────────────────────────────

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[ssl-setup]${NC} $1"; }
warn() { echo -e "${YELLOW}[ssl-setup]${NC} $1"; }

DOMAIN="${DOMAIN:?DOMAIN environment variable is required}"
EMAIL="${LETSENCRYPT_EMAIL:-}"

# Ensure certbot is installed
if ! command -v certbot &> /dev/null; then
    log "Installing certbot..."
    apt-get update -qq && apt-get install -y -qq certbot python3-certbot-nginx > /dev/null 2>&1
fi

# Create webroot directory for ACME challenges
mkdir -p /var/www/certbot

# Check if certificate already exists
if [ -d "/etc/letsencrypt/live/${DOMAIN}" ]; then
    log "Certificate for ${DOMAIN} already exists. Attempting renewal..."
    certbot renew --quiet --no-self-upgrade
else
    log "Requesting new certificate for ${DOMAIN}..."

    # Build certbot command
    CERTBOT_CMD="certbot certonly --webroot --webroot-path=/var/www/certbot"
    CERTBOT_CMD="${CERTBOT_CMD} -d ${DOMAIN}"
    
    # Add www subdomain if not already a subdomain
    if [[ "${DOMAIN}" != *.*.* ]]; then
        CERTBOT_CMD="${CERTBOT_CMD} -d www.${DOMAIN}"
    fi

    if [ -n "${EMAIL}" ]; then
        CERTBOT_CMD="${CERTBOT_CMD} --email ${EMAIL} --agree-tos --no-eff-email"
    else
        CERTBOT_CMD="${CERTBOT_CMD} --register-unsafely-without-email --agree-tos"
    fi

    CERTBOT_CMD="${CERTBOT_CMD} --non-interactive"

    # Nginx must be running on port 80 for webroot validation
    # First try with webroot (requires nginx running)
    if nginx -t 2>/dev/null && pgrep nginx > /dev/null; then
        eval ${CERTBOT_CMD}
    else
        # Fallback to standalone if nginx isn't running yet
        log "Nginx not running, using standalone mode..."
        certbot certonly --standalone \
            -d "${DOMAIN}" \
            ${EMAIL:+--email "${EMAIL}" --agree-tos --no-eff-email} \
            ${EMAIL:---register-unsafely-without-email --agree-tos} \
            --non-interactive
    fi
fi

# Verify certificate was obtained
if [ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
    warn "Failed to obtain SSL certificate. Continuing with HTTP only."
    exit 1
fi

# Enable SSL nginx config
log "Enabling SSL configuration..."
cp /etc/nginx/sites-available/ssl.conf /etc/nginx/sites-available/ssl-active.conf
sed -i "s/DOMAIN_PLACEHOLDER/${DOMAIN}/g" /etc/nginx/sites-available/ssl-active.conf
ln -sf /etc/nginx/sites-available/ssl-active.conf /etc/nginx/sites-enabled/ssl-active.conf

# Test and reload nginx
if nginx -t 2>/dev/null; then
    nginx -s reload 2>/dev/null || true
    log "SSL enabled successfully for ${DOMAIN}"
else
    warn "Nginx config test failed. Check SSL configuration."
    rm -f /etc/nginx/sites-enabled/ssl-active.conf
    exit 1
fi

# Set up auto-renewal cron (twice daily as recommended)
CRON_LINE="0 */12 * * * certbot renew --quiet --deploy-hook 'nginx -s reload' >> /var/log/certbot-renew.log 2>&1"
(crontab -l 2>/dev/null | grep -v certbot; echo "${CRON_LINE}") | crontab -
log "Auto-renewal cron configured (every 12 hours)"
