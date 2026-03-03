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

// ── Docker stats endpoint ───────────────────────────────────
app.get("/docker/stats", async (req, res) => {
  try {
    const os = require("os");
    const fs = require("fs");

    // Container uptime from /proc/uptime
    let uptimeStr = "Unknown";
    try {
      const uptimeSec = parseFloat(fs.readFileSync("/proc/uptime", "utf8").split(" ")[0]);
      const d = Math.floor(uptimeSec / 86400);
      const h = Math.floor((uptimeSec % 86400) / 3600);
      const m = Math.floor((uptimeSec % 3600) / 60);
      uptimeStr = d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
    } catch {}

    // CPU usage from /proc/stat
    let cpuPercent = 0;
    try {
      const loadAvg = os.loadavg()[0];
      cpuPercent = Math.min((loadAvg / os.cpus().length) * 100, 100);
    } catch {}

    // Memory
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPercent = (usedMem / totalMem) * 100;

    // Disk usage
    let diskUsed = 0, diskTotal = 0, diskPercent = 0;
    try {
      const dfOutput = execSync("df / --output=used,size -B1 | tail -1").toString().trim();
      const [used, total] = dfOutput.split(/\s+/).map(Number);
      diskUsed = used;
      diskTotal = total;
      diskPercent = (used / total) * 100;
    } catch {}

    // Network I/O from /proc/net/dev
    let netRx = 0, netTx = 0;
    try {
      const netData = fs.readFileSync("/proc/net/dev", "utf8");
      for (const line of netData.split("\n")) {
        if (line.includes("eth0") || line.includes("wg0")) {
          const parts = line.trim().split(/\s+/);
          netRx += parseInt(parts[1]) || 0;
          netTx += parseInt(parts[9]) || 0;
        }
      }
    } catch {}

    // WireGuard health
    let healthCheck = "healthy";
    try {
      await pool.query("SELECT 1");
      execSync("wg show wg0 2>/dev/null");
    } catch {
      healthCheck = "unhealthy";
    }

    // Restart count (from supervisor)
    let restarts = 0;
    try {
      const supervisorOut = execSync("supervisorctl status 2>/dev/null || true").toString();
      const matches = supervisorOut.match(/STARTING/g);
      restarts = matches ? matches.length : 0;
    } catch {}

    res.json({
      name: "wireguard-manager",
      status: "running",
      uptime: uptimeStr,
      cpu: parseFloat(cpuPercent.toFixed(1)),
      memory: { used: usedMem, total: totalMem, percent: parseFloat(memPercent.toFixed(1)) },
      disk: { used: diskUsed, total: diskTotal, percent: parseFloat(diskPercent.toFixed(1)) },
      network: { rx: netRx, tx: netTx },
      restarts,
      image: "wireguard-manager:latest",
      healthCheck,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start server ────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`WireGuard Manager API running on port ${PORT}`);
});
