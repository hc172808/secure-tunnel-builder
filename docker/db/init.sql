-- ──────────────────────────────────────────────────────────────
-- WireGuard Manager — Database Initialization Script
-- ──────────────────────────────────────────────────────────────
-- This file is run automatically on first container start.
-- Admins can also run it manually to reset/update the schema:
--
--   psql -h localhost -U $DB_USER -d $DB_NAME -f /opt/wireguard-manager/db/init.sql
--
-- All statements are idempotent (safe to re-run).
-- ──────────────────────────────────────────────────────────────

-- ── Extensions ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Enums ───────────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE app_role AS ENUM ('admin', 'user');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Tables ──────────────────────────────────────────────────

-- Server settings (key-value store)
CREATE TABLE IF NOT EXISTS server_settings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    setting_key TEXT NOT NULL UNIQUE,
    setting_value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID
);

-- Peer groups
CREATE TABLE IF NOT EXISTS peer_groups (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#3b82f6',
    description TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- WireGuard peers
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
    group_id UUID REFERENCES peer_groups(id) ON DELETE SET NULL,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Traffic statistics
CREATE TABLE IF NOT EXISTS traffic_stats (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    peer_id UUID NOT NULL REFERENCES wireguard_peers(id) ON DELETE CASCADE,
    rx_bytes BIGINT DEFAULT 0,
    tx_bytes BIGINT DEFAULT 0,
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Firewall rules
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

-- Audit logs
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

-- Email notification logs
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

-- Peer notifications
CREATE TABLE IF NOT EXISTS peer_notifications (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    peer_id UUID REFERENCES wireguard_peers(id) ON DELETE SET NULL,
    peer_name TEXT NOT NULL,
    event_type TEXT NOT NULL,
    read BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Profiles (local user accounts)
CREATE TABLE IF NOT EXISTS profiles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL UNIQUE,
    username TEXT,
    display_name TEXT,
    avatar_url TEXT,
    api_token TEXT DEFAULT encode(gen_random_bytes(32), 'hex'),
    is_disabled BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User roles
CREATE TABLE IF NOT EXISTS user_roles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    role app_role NOT NULL DEFAULT 'user',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, role)
);

-- Invitations
CREATE TABLE IF NOT EXISTS invitations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email TEXT NOT NULL,
    token TEXT DEFAULT encode(gen_random_bytes(32), 'hex'),
    invited_by UUID,
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pending peer requests
CREATE TABLE IF NOT EXISTS pending_peer_requests (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    name TEXT NOT NULL,
    public_key TEXT,
    allowed_ips TEXT DEFAULT '10.0.0.0/24',
    status TEXT DEFAULT 'pending',
    approved_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Peer assignments (user ↔ peer mapping)
CREATE TABLE IF NOT EXISTS peer_assignments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    peer_id UUID NOT NULL REFERENCES wireguard_peers(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    assigned_by UUID,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (peer_id, user_id)
);

-- DDNS update history
CREATE TABLE IF NOT EXISTS ddns_update_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    provider TEXT NOT NULL,
    hostname TEXT NOT NULL,
    old_ip TEXT,
    new_ip TEXT,
    status TEXT DEFAULT 'success',
    error_message TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Subscription plans
CREATE TABLE IF NOT EXISTS subscription_plans (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    price_per_peer NUMERIC NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'GYD',
    max_peers INTEGER,
    is_active BOOLEAN NOT NULL DEFAULT true,
    duration_hours INTEGER DEFAULT 720,
    speed_limit_mbps INTEGER,
    billing_type TEXT NOT NULL DEFAULT 'per_peer',
    features JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User subscriptions
CREATE TABLE IF NOT EXISTS user_subscriptions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    plan_id UUID REFERENCES subscription_plans(id),
    peer_count INTEGER NOT NULL DEFAULT 1,
    total_amount NUMERIC NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    expires_at TIMESTAMPTZ,
    expiry_notified_at TIMESTAMPTZ,
    auto_renew BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Crypto payments
CREATE TABLE IF NOT EXISTS crypto_payments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    subscription_id UUID REFERENCES user_subscriptions(id),
    amount NUMERIC NOT NULL,
    currency TEXT NOT NULL DEFAULT 'GYD',
    wallet_address TEXT NOT NULL,
    tx_hash TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    confirmed_by UUID,
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bandwidth rate tiers (usage-based billing)
CREATE TABLE IF NOT EXISTS bandwidth_rate_tiers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    min_gb NUMERIC NOT NULL DEFAULT 0,
    max_gb NUMERIC,
    rate_per_gb NUMERIC NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'GYD',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Usage billing records
CREATE TABLE IF NOT EXISTS usage_billing_records (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    peer_id UUID REFERENCES wireguard_peers(id) ON DELETE SET NULL,
    billing_period_start TIMESTAMPTZ NOT NULL,
    billing_period_end TIMESTAMPTZ NOT NULL,
    total_bytes BIGINT NOT NULL DEFAULT 0,
    total_gb NUMERIC GENERATED ALWAYS AS (total_bytes::numeric / 1073741824.0) STORED,
    amount_due NUMERIC NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'GYD',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- GYD validator nodes
CREATE TABLE IF NOT EXISTS gyd_validator_nodes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    node_type TEXT NOT NULL DEFAULT 'lite',
    endpoint_url TEXT NOT NULL,
    api_key TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_health_check TIMESTAMPTZ,
    health_status TEXT NOT NULL DEFAULT 'unknown',
    priority INTEGER NOT NULL DEFAULT 1,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payment validation logs
CREATE TABLE IF NOT EXISTS payment_validation_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    payment_id UUID REFERENCES crypto_payments(id) ON DELETE CASCADE,
    validator_node_id UUID REFERENCES gyd_validator_nodes(id) ON DELETE SET NULL,
    validation_status TEXT NOT NULL DEFAULT 'pending',
    tx_hash TEXT,
    block_number BIGINT,
    confirmations INTEGER DEFAULT 0,
    response_data JSONB,
    validated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_peers_status ON wireguard_peers(status);
CREATE INDEX IF NOT EXISTS idx_peers_group ON wireguard_peers(group_id);
CREATE INDEX IF NOT EXISTS idx_traffic_peer ON traffic_stats(peer_id);
CREATE INDEX IF NOT EXISTS idx_traffic_time ON traffic_stats(recorded_at);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_roles_user ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_assignments_user ON peer_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_assignments_peer ON peer_assignments(peer_id);

-- ── Functions ───────────────────────────────────────────────

-- Check if a user has a specific role
CREATE OR REPLACE FUNCTION has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM user_roles
        WHERE user_id = _user_id AND role = _role
    )
$$;

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- ── Triggers ────────────────────────────────────────────────
DO $$ BEGIN
    CREATE TRIGGER trg_peers_updated_at
        BEFORE UPDATE ON wireguard_peers
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TRIGGER trg_firewall_updated_at
        BEFORE UPDATE ON firewall_rules
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TRIGGER trg_profiles_updated_at
        BEFORE UPDATE ON profiles
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TRIGGER trg_settings_updated_at
        BEFORE UPDATE ON server_settings
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TRIGGER trg_pending_requests_updated_at
        BEFORE UPDATE ON pending_peer_requests
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Done ────────────────────────────────────────────────────
-- Schema ready. The entrypoint.sh will seed initial server
-- settings (keys, endpoint, DDNS) from environment variables.
