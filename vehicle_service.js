const express = require("express");
const { Pool } = require("pg");
const dotenv = require("dotenv");
const mqtt = require("mqtt");
const cors = require("cors");
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const vehicleRoutes= require('./routes/vehicle_routes');
const authenticateMiddleWare= require('./config/authMiddleWare');
const lockStatusMap = {}; 
dotenv.config();
const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());
app.use(cors());
app.use('/api', vehicleRoutes);

// PostgreSQL pool setup
const pool = new Pool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT
});

// --- Lock Status Persistence ---
// lockStatusMap is now initialized and loaded from DB above

// Ensure vehicle_lock_status table exists and load statuses into lockStatusMap
(async () => {
    const createTableQuery = `
        CREATE TABLE IF NOT EXISTS vehicle_lock_status (
            serial_number TEXT PRIMARY KEY,
            status INTEGER NOT NULL
        );
    `;
    try {
        await pool.query(createTableQuery);
        const result = await pool.query('SELECT serial_number, status FROM vehicle_lock_status');
        result.rows.forEach(row => {
            lockStatusMap[row.serial_number] = row.status;
        });
        console.log('Loaded lock statuses from DB:', lockStatusMap);
    } catch (err) {
        console.error('Error initializing lock status table or loading data:', err);
    }
})();



// ---------------- MQTT Reset ---------------- //


// ---------------- MQTT Status Display ---------------- //

const mqttClient = mqtt.connect("mqtt://ekco-tracking.co.za:1883", {
    username: "dev:ekcoFleets",
    password: "dzRND6ZqiI"
});


mqttClient.on("connect", () => {
    console.log("✅ MQTT backend connected");
    mqttClient.subscribe("ekco/v1/+/lock/control", (err) => {
        if (err) {
            console.error("❌ Failed to subscribe:", err);
        } else {
            console.log("✅ Subscribed to all vehicle lock/control topics");
        }
    });
    mqttClient.subscribe("ekco/v1/+/logs/data", (err) => {
        if (err) {
            console.error("❌ Failed to subscribe to logs/data:", err);
        } else {
            console.log("✅ Subscribed to all vehicle logs/data topics");
        }
    });
});

// In-memory log storage: { serial_number: [log1, log2, ...] }
const logsMap = {};

// Track active SSE streams per serial_number and type

const activeStreams = {};

mqttClient.on("message", (topic, message) => {
    const payload = message.toString();
    console.log(`[MQTT] Received on topic: ${topic} | payload: ${payload}`);
    const matchLock = topic.match(/^ekco\/v1\/(.+)\/lock\/control$/);
    if (matchLock) {
        const serial = matchLock[1];
        const status = parseInt(payload);
        lockStatusMap[serial] = status; // 0 or 1
        // Persist to DB
        pool.query(
            'INSERT INTO vehicle_lock_status (serial_number, status) VALUES ($1, $2) ON CONFLICT (serial_number) DO UPDATE SET status = EXCLUDED.status',
            [serial, status]
        ).catch(err => console.error('Failed to persist lock status:', err));
        // Stream to active SSE clients for lock
        if (activeStreams[serial] && activeStreams[serial].lock) {
            activeStreams[serial].lock.forEach(res => {
                res.write(`data: ${JSON.stringify({ timestamp: Date.now(), status: lockStatusMap[serial] })}\n\n`);
            });
        }
        return;
    }
    const matchLogs = topic.match(/^ekco\/v1\/(.+)\/logs\/data$/);
    if (matchLogs) {
        const serial = matchLogs[1];
        if (!logsMap[serial]) logsMap[serial] = [];
        const logEntry = {
            timestamp: Date.now(),
            data: payload
        };
        logsMap[serial].push(logEntry);
        // Optionally limit log size per device
        if (logsMap[serial].length > 1000) logsMap[serial].shift();
        // Stream to active SSE clients for logs
        if (activeStreams[serial] && activeStreams[serial].logs) {
            activeStreams[serial].logs.forEach(res => {
                res.write(`data: ${JSON.stringify(logEntry)}\n\n`);
            });
        }
        return;
    }
    // Add more topic types here as needed (e.g., reset, etc.)
});
console.log("logs map"+ logsMap.toString())

/* app.get("/api/lockStatus/:serial_number", (req, res) => {
    const { serial_number } = req.params;
    const status = lockStatusMap[serial_number];
    if (status === undefined) {
        return res.status(404).json({ error: "No status found for this vehicle." });
    }
    res.json({ status }); // status = 0 or 1
}); */

// Get logs for a device


// SSE endpoint to continuously stream logs as they are received from the device
// Track active retrieve/stream connections

const activeRetrieveStreams = {};




app.get('/logs/:serial_number/retrieve/stream', (req, res) => {
    const { serial_number } = req.params;
    const command = "1";
    const controlTopic = `ekco/v1/${serial_number}/logs/control`;
    const dataTopic = `ekco/v1/${serial_number}/logs/data`;
    req.socket.setTimeout(0);
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    });
    res.flushHeaders();
    const onMessage = (topic, message) => {
        if (topic === dataTopic) {
            const payload = message.toString();
            res.write(`data: ${JSON.stringify({ topic, payload })}\n\n`);
            console.log(`[SSE STREAM] ${serial_number} log:`, payload);
        }
    };
    mqttClient.on('message', onMessage);
    if (!activeRetrieveStreams[serial_number]) activeRetrieveStreams[serial_number] = [];
    activeRetrieveStreams[serial_number].push({ res, onMessage });
    mqttClient.publish(controlTopic, String(command), { retain: false }, (err) => {
        if (err) {
            res.write(`event: error\ndata: ${JSON.stringify({ error: 'Failed to publish control command', details: err.message })}\n\n`);
            res.end();
            mqttClient.off('message', onMessage);
            activeRetrieveStreams[serial_number] = (activeRetrieveStreams[serial_number] || []).filter(r => r.res !== res);
        }
    });


    req.on('close', () => {
        mqttClient.off('message', onMessage);
        if (activeRetrieveStreams[serial_number]) {
            activeRetrieveStreams[serial_number] = activeRetrieveStreams[serial_number].filter(r => r.res !== res);
        }
    });
});




app.post('/logs/:serial_number/retrieve/stream/stop', (req, res)=>{
 const { serial_number } = req.params;
    const controlTopic = `ekco/v1/${serial_number}/logs/control`;
    mqttClient.publish(controlTopic, "0", { retain: false }, (err) => {
        if (err) {
            console.error(`Failed to send stop command to ${controlTopic}:`, err);
        }
    });
    if (activeRetrieveStreams[serial_number] && activeRetrieveStreams[serial_number].length > 0) {
        activeRetrieveStreams[serial_number].forEach(({ res: streamRes, onMessage }) => {
            streamRes.write('event: end\ndata: Stream stopped by server\n\n');
            streamRes.end();
            mqttClient.off('message', onMessage);
        });
        activeRetrieveStreams[serial_number] = [];
        res.json({ message: `Stopped retrieve/stream for ${serial_number} and sent stop command` });
    } else {
        res.status(404).json({ error: `No active retrieve/stream for ${serial_number}` });
    }


})

// Start server
app.listen(PORT, () => {
    console.log(`Vehicle Service running on port: ${PORT}`);
});
