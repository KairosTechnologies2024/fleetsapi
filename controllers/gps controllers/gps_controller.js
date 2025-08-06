// --- Required dependencies ---
const { Pool } = require("pg");
const dotenv = require("dotenv");
dotenv.config();

const pool = new Pool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT
});

// ---------------- GPS Controller Methods ---------------- //

const getAllGpsData = async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM gps_ts");
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "Database error", details: err.message });
    }
};

const getLatestGpsData = async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT DISTINCT ON (device_serial) *
            FROM gps_ts
            ORDER BY device_serial, time DESC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "Database error", details: err.message });
    }
};

const getGpsDataBySerial = async (req, res) => {
    const { device_serial } = req.params;
    try {
        const result = await pool.query("SELECT * FROM gps_ts WHERE device_serial = $1", [device_serial]);
        if (result.rows.length > 0) {
            res.json(result.rows);
        } else {
            res.status(404).json({ error: "Item not found" });
        }
    } catch (err) {
        res.status(500).json({ error: "Database error", details: err.message });
    }
};

const getGpsCoordinates = async (req, res) => {
    const { device_serial } = req.params;
    try {
        const result = await pool.query(`
            SELECT device_serial, location, speed
            FROM gps_ts
            WHERE device_serial = $1
            ORDER BY time DESC
            LIMIT 1
        `, [device_serial]);
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.status(404).json({ error: "Device not found or no data available" });
        }
    } catch (err) {
        res.status(500).json({ error: "Database error", details: err.message });
    }
};

const getTripData = async (req, res) => {
    const { device_serial } = req.params;
    const { start, end } = req.query;
    if (!start || !end) {
        return res.status(400).json({ error: "Start and end date are required" });
    }
    try {
        const result = await pool.query(
            `
      SELECT 
        gps.device_serial,
        gps.location,
        gps.speed,
        gps.time,
        CONCAT(v.vehicle_name, ' ', v.vehicle_model, ' ', v.vehicle_year) AS vehicle_full_name
      FROM gps_ts gps
      LEFT JOIN vehicle_info v ON gps.device_serial::text = v.device_serial
      WHERE gps.device_serial = $1::bigint
        AND gps.time >= EXTRACT(EPOCH FROM $2::timestamp)
        AND gps.time <= EXTRACT(EPOCH FROM $3::timestamp)
      ORDER BY gps.time ASC
    `,
            [device_serial, start, end]
        );
        res.json(result.rows);
    } catch (err) {
        console.error("Trip data query failed:", err);
        res.status(500).json({ error: "Database error", details: err.message });
    }
};

// ---------------- Alerts Controller Methods ---------------- //

const getAllAlerts = async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM alert_ts");
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "Database error", details: err.message });
    }
};

const getLatestAlerts = async (req, res) => {
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
};

const getLatest200Alerts = async (req, res) => {
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
};

const getTop200AlertsPerDevice = async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM (
                SELECT *,
                       ROW_NUMBER() OVER (PARTITION BY device_serial ORDER BY time DESC) as rn
                FROM alert_ts
            ) sub
            WHERE rn <= 200
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "Database error", details: err.message });
    }
};

const getAlertsBySerial = async (req, res) => {
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
};

// ---------------- Device Health Controller Methods ---------------- //

const getDeviceHealth = async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM device_health");
        if (result.rows.length > 0) {
            res.json(result.rows);
        } else {
            res.status(404).json({ error: "Item not found" });
        }
    } catch (err) {
        res.status(500).json({ error: "Database error", details: err.message });
    }
};

const getMotorHealth = async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM actuators");
        if (result.rows.length > 0) {
            res.json(result.rows);
        } else {
            res.status(404).json({ error: "Item not found" });
        }
    } catch (err) {
        res.status(500).json({ error: "Database error", details: err.message });
    }
};

// ---------------- Ignition Status Controller Methods ---------------- //

const getIgnitionStatus = async (req, res) => {
    const { device_serial } = req.params;
    try {
        const result = await pool.query("SELECT * FROM engine_ts WHERE device_serial = $1", [device_serial]);
        if (result.rows.length > 0) {
            res.json(result.rows);
        } else {
            res.status(404).json({ error: "Item not found" });
        }
    } catch (err) {
        res.status(500).json({ error: "Database error", details: err.message });
    }
};

module.exports = {
    getAllGpsData,
    getLatestGpsData,
    getGpsDataBySerial,
    getGpsCoordinates,
    getTripData,
    getAllAlerts,
    getLatestAlerts,
    getLatest200Alerts,
    getTop200AlertsPerDevice,
    getAlertsBySerial,
    getDeviceHealth,
    getMotorHealth,
    getIgnitionStatus
};
