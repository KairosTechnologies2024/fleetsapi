const express = require("express");
const { Pool } = require("pg");
const dotenv = require("dotenv");

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3003;

app.use(express.json());
app.use(require("cors")());

// Database connection
const pool = new Pool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT
});

// Fetch all data
app.get("/api/alerts", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM alert_ts");
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "Database error", details: err.message });
    }
});

// Fetch the latest record for each device_serial
app.get("/api/alerts/latest", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT DISTINCT ON (device_serial) *
            FROM alert_ts
            ORDER BY device_serial, time DESC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "Database error", details: err.message });
    }
});

//Fetch latest 200 alerts
app.get("/api/alerts/latest200", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * 
            FROM alert_ts 
            ORDER BY time DESC 
            LIMIT 200
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "Database error", details: err.message });
    }
});

// Fetch item by device_serial
app.get("/api/alerts/:device_serial", async (req, res) => {
    const { device_serial } = req.params;
    try {
        const result = await pool.query("SELECT * FROM alert_ts WHERE device_serial = $1", [device_serial]);
        if (result.rows.length > 0) {
            res.json(result.rows);
        } else {
            res.status(404).json({ error: "Item not found" });
        }
    } catch (err) {
        res.status(500).json({ error: "Database error", details: err.message });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});