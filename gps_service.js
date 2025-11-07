const express = require("express");
const { Pool } = require("pg");
const dotenv = require("dotenv");
const cors = require("cors");
const http = require("http");
const WebSocket = require("ws");
const  gpsRoutes= require('./routes/gps_routes');
const authenticateMiddleWare= require('./config/authMiddleWare');
dotenv.config();
const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(cors());
app.use('/api',gpsRoutes);
// Database connection
const pool = new Pool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT
});

// ---------------- WebSocket ---------------- //

//HTTP server and WebSocket server
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// WebSocket connections
wss.on("connection", (ws) => {
    console.log("Client connected to WebSocket");

    ws.send(
        JSON.stringify({
            type: "welcome",
            message: "Connected to GPS/Alert WebSocket",
        })
    );

    ws.on("message", (message) => {
        console.log("Received:", message);
    });

    ws.on("close", () => {
        console.log("Client disconnected");
    });
});

function broadcast(data) {
    const message = JSON.stringify(data);
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        } else {
            console.log("Client not open:", client.readyState);
        }
    });
}

// ---------------- GPS Broadcast ---------------- //

setInterval(async () => {
    try {
        const result = await pool.query(`
      SELECT DISTINCT ON (device_serial) *
      FROM gps_ts
      ORDER BY device_serial, time DESC
    `);

        broadcast({ type: "gps_update", data: result.rows });
    } catch (err) {
        console.error("Error broadcasting GPS:", err.message);
    }
}, 3000);

// ---------------- Alerts Broadcast ---------------- //

// let latestAlertTimestamp = 0;
// let latestAlertTimestamp;
latestAlertTimestamp = Math.floor(Date.now() / 1000) - 60;

(async () => {
    const res = await pool.query('SELECT MAX(time)::bigint AS latest FROM alert_ts');
    const maxDBTime = parseInt(res.rows[0].latest) || 0;
    const now = Math.floor(Date.now() / 1000);
    const sixtySecondsAgo = now - 60;

    if (maxDBTime > now) {
        console.warn("⚠️ maxDBTime is in the future! Resetting to now:", now);
        latestAlertTimestamp = now;
    } else if (maxDBTime < sixtySecondsAgo) {
        console.log("✅ Using maxDBTime from DB:", maxDBTime);
        latestAlertTimestamp = maxDBTime;
    } else {
        console.log("🕒 DB time is recent or missing. Using now - 60s:", sixtySecondsAgo);
        latestAlertTimestamp = sixtySecondsAgo;
    }

    console.log("🔧 Initial latestAlertTimestamp set to:", latestAlertTimestamp);

    setInterval(broadcastAlerts, 3000);
})();


async function broadcastAlerts() {
    try {
        const now = Math.floor(Date.now() / 1000);
        // console.log("🕵️‍♂️ Checking for alerts after:", latestAlertTimestamp);

        const result = await pool.query(
            `
            SELECT time::bigint AS time, device_serial, alert 
            FROM alert_ts 
            WHERE time::bigint > $1 
            ORDER BY time DESC
            `,
            [latestAlertTimestamp]
        );

        // console.log("🔍 Raw new alerts:", result.rows.map(r => ({
        //     time: r.time,
        //     alert: r.alert
        // })));

        if (result.rows.length === 0) {
            // console.log("📭 No new alerts found.");
            return;
        }

        // Discard alerts in the future
        const validAlerts = result.rows.filter(r => {
            const t = parseInt(r.time);
            if (t > now) {
                // console.warn(`⚠️ Skipping future alert time=${t} (now=${now}, skew=${t - now}s)`);
                return false;
            }
            return true;
        });

        if (validAlerts.length === 0) {
            // console.log("🚫 All alerts are in the future. Skipping broadcast.");
            return;
        }

        // Optional: Log how many were skipped
        const skippedCount = result.rows.length - validAlerts.length;
        if (skippedCount > 0) {
            // console.log(`🧹 Skipped ${skippedCount} future-dated alerts.`);
        }

        // Filter unimportant alerts
        const filteredAlerts = validAlerts.filter(r =>
            r.alert !== "Door opened" && r.alert !== "Ignition on"
        );

        if (filteredAlerts.length > 0) {
            const alertTimes = filteredAlerts.map(r => parseInt(r.time));
            const maxTime = Math.max(...alertTimes);

            // console.log("📤 Filtered new alerts to broadcast:", filteredAlerts.map(r => ({
            //     time: r.time,
            //     alert: r.alert
            // })));

            latestAlertTimestamp = maxTime + 1;

            broadcast({
                type: "alert_update",
                data: filteredAlerts,
            });
        } else {
            // All valid, but filtered out as unimportant
            const allTimes = validAlerts.map(r => parseInt(r.time));
            latestAlertTimestamp = Math.max(...allTimes) + 1;
            // console.log("⚠️ All alerts filtered out. Timestamp updated anyway.");
        }

    } catch (err) {
        console.error("❌ Error broadcasting alerts:", err.message);
    }
}


// ---------------- Manual Test Route ---------------- //

app.get("/test-alert", (req, res) => {
    const mockAlert = {
        type: "alert_update",
        data: [
            {
                // time: Date.now().toString().slice(0, 10),
                // device_serial: "869518071268743",
                // alert: "Mock Test Alert",
                time: Math.floor(Date.now() / 1000).toString(),
                device_serial: "869518071268743",
                alert: "Mock Test Alert",
            },
        ],
    };

    console.log("📢 Manually broadcasting test alert:", mockAlert);
    broadcast(mockAlert);

    res.send("✅ Test alert sent to all WebSocket clients.");
});

// ---------------- Ignition Broadcast ---------------- //

const IMPORTANT_STATUSES = ["on", "off", "start"];
const lastIgnitionStatus = new Map();
let latestEngineTimestamp = Math.floor(Date.now() / 1000) - 60;

(async () => {
    const res = await pool.query('SELECT MAX(time)::bigint AS latest FROM engine_ts');
    const maxDBTime = parseInt(res.rows[0].latest) || 0;
    const now = Math.floor(Date.now() / 1000);
    const sixtySecondsAgo = now - 60;

    if (maxDBTime > now) {
        console.warn("⚠️ engine_ts maxDBTime is in the future! Resetting to now:", now);
        latestEngineTimestamp = now;
    } else if (maxDBTime < sixtySecondsAgo) {
        console.log("✅ Using engine_ts maxDBTime from DB:", maxDBTime);
        latestEngineTimestamp = maxDBTime;
    } else {
        console.log("🕒 engine_ts DB time is recent or missing. Using now - 60s:", sixtySecondsAgo);
        latestEngineTimestamp = sixtySecondsAgo;
    }

    console.log("🔧 Initial latestEngineTimestamp set to:", latestEngineTimestamp);

    setInterval(broadcastEngineUpdates, 3000);
})();

async function broadcastEngineUpdates() {
    try {
        const now = Math.floor(Date.now() / 1000);

        const result = await pool.query(
            `
            SELECT time::bigint AS time, device_serial, ignition_status
            FROM engine_ts 
            WHERE time::bigint > $1 
            ORDER BY time DESC
            `,
            [latestEngineTimestamp]
        );

        // console.log(`📡 Checking engine updates since ${latestEngineTimestamp}...`);

        if (result.rows.length === 0) {
            console.log("📭 No new rows in engine_ts.");
            return;
        }

        const validEntries = result.rows.filter(r => {
            const t = parseInt(r.time);
            return t <= now;
        });

        if (validEntries.length === 0) {
            // console.log("All engine_ts entries were future-dated. Skipping.");
            return;
        }

        const engineTimes = validEntries.map(r => parseInt(r.time));
        const maxTime = Math.max(...engineTimes);
        latestEngineTimestamp = maxTime + 1;

        // console.log(`Broadcasting ${validEntries.length} ignition entries:`);
        // validEntries.forEach((r) => {
        //     console.log(`  - [${r.device_serial}] Time: ${r.time}, Ignition: ${r.ignition_status}`);
        // });

        broadcast({
            type: "engine_update",
            data: validEntries,
        });

    } catch (err) {
        console.error("❌ Error broadcasting ignition updates:", err.message);
    }
}




// Start the server
// app.listen(PORT, () => {
//     console.log(`GPS & Alerts service running on http://ekco-tracking.co.za:${PORT}`);
// });

server.listen(PORT, () => {
    console.log(`GPS & Alerts service running on http://ekco-tracking.co.za:${PORT}`);
});