// ──────────────────────────────────────────────────────────────
// WireGuard Manager — Backend API (Docker variant)
// Minimal Express server for peer management & sync
// ──────────────────────────────────────────────────────────────

const express = require("express");
const { execSync, exec } = require("child_process");
const { Pool } = require("pg");
const crypto = require("crypto");

const app = express();
app.use(express.json());

const pool = new Pool({
  host: "localhost",
  database: process.env.DB_NAME || "wireguard_manager",
  user: process.env.DB_USER || "wgadmin",
  password: process.env.DB_PASSWORD,
});

// ── Health check ────────────────────────────────────────────
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    const wgStatus = execSync("wg show wg0 2>/dev/null || echo 'down'").toString().trim();
    res.json({
      status: "healthy",
      wireguard: wgStatus !== "down" ? "up" : "down",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({ status: "unhealthy", error: err.message });
  }
});

// ── Get all peers ───────────────────────────────────────────
app.get("/peers", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM wireguard_peers ORDER BY created_at DESC");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Get server settings ─────────────────────────────────────
app.get("/settings", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT setting_key, setting_value FROM server_settings");
    const settings = {};
    rows.forEach((r) => (settings[r.setting_key] = r.setting_value));
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Sync WireGuard status ───────────────────────────────────
app.post("/sync", async (req, res) => {
  try {
    const wgOutput = execSync("wg show wg0 dump 2>/dev/null || true").toString().trim();
    const lines = wgOutput.split("\n").slice(1); // Skip server line

    for (const line of lines) {
      const parts = line.split("\t");
      if (parts.length < 8) continue;
      const [pubKey, , endpoint, , lastHandshake, rxBytes, txBytes] = parts;

      const handshakeTime = parseInt(lastHandshake) > 0
        ? new Date(parseInt(lastHandshake) * 1000).toISOString()
        : null;

      const isConnected = handshakeTime &&
        Date.now() - new Date(handshakeTime).getTime() < 180000;

      await pool.query(
        `UPDATE wireguard_peers SET 
          endpoint = COALESCE($1, endpoint),
          last_handshake = COALESCE($2, last_handshake),
          transfer_rx = $3, transfer_tx = $4,
          status = $5, updated_at = NOW()
        WHERE public_key = $6`,
        [
          endpoint !== "(none)" ? endpoint : null,
          handshakeTime,
          parseInt(rxBytes) || 0,
          parseInt(txBytes) || 0,
          isConnected ? "connected" : "disconnected",
          pubKey,
        ]
      );
    }

    res.json({ success: true, synced: lines.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Internal: email notification trigger ────────────────────
app.post("/internal/email-notify", async (req, res) => {
  const { peer_name, event_type, peer_ip } = req.body;
  try {
    await pool.query(
      `INSERT INTO email_notification_logs (peer_name, event_type, recipient_email, subject, status)
       VALUES ($1, $2, 'admin', $3, 'queued')`,
      [peer_name, event_type, `DDNS Alert: ${peer_name}`]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start server ────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`WireGuard Manager API running on port ${PORT}`);
});
