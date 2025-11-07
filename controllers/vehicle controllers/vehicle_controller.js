// --- Required dependencies and shared objects ---
const { Pool } = require("pg");
const dotenv = require("dotenv");
const mqtt = require("mqtt");
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
dotenv.config();

// Shared in-memory objects
const lockStatusMap = {};
/* const logsMap = {};
const activeStreams = {}; */
const activeRetrieveStreams = {};
const { logsMap, activeStreams } = require('../../vehicle_service');
// PostgreSQL pool setup
const pool = new Pool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT
});

// MQTT client setup
const mqttClient = mqtt.connect("mqtt://ekco-tracking.co.za:1883", {
    username: process.env.MQTT_USERNAME || "dev:ekcoFleets",
    password: process.env.MQTT_PASSWORD || "dzRND6ZqiI"
});

// --- End dependencies ---

// ---------------- MQTT lock ---------------- //
const lockVehicle = async (req, res) => {
    const { serial_number, status } = req.body;
    if (!serial_number || typeof status !== "number") {
        return res.status(400).json({ error: "Missing or invalid parameters." });
    }
    const topic = `ekco/v1/${serial_number}/lock/control`;
    const payload = `${status}`;
    const mqttOptions = {
        username: process.env.MQTT_USERNAME,
        password: process.env.MQTT_PASSWORD,
        reconnectPeriod: 0
    };
    const client = mqtt.connect("mqtt://ekco-tracking.co.za:1883", mqttOptions);
    let responded = false;
    client.on("connect", () => {
        client.publish(topic, payload, { retain: false }, async (err) => {
            if (!responded) {
                responded = true;
                if (err) {
                    console.error("MQTT publish error:", err);
                    res.status(500).json({ error: "Failed to publish to MQTT", details: err.message });
                } else {
                    lockStatusMap[serial_number] = status;
                    try {
                        await pool.query(
                            'INSERT INTO vehicle_lock_status (serial_number, status) VALUES ($1, $2) ON CONFLICT (serial_number) DO UPDATE SET status = EXCLUDED.status',
                            [serial_number, status]
                        );
                    } catch (dbErr) {
                        console.error('Failed to persist lock status from API:', dbErr);
                    }
                    res.json({ message: "Command sent successfully", topic, payload });
                }
                client.end();
            }
        });
    });
    client.on("error", (err) => {
        if (!responded) {
            responded = true;
            console.error("MQTT connection error:", err);
            res.status(500).json({ error: "MQTT connection failed", details: err.message });
        }
        client.end();
    });
};

const getLockStatus = async (req, res) => {
    const { serial_number } = req.params;
    try {
        const result = await pool.query(
            'SELECT status FROM vehicle_lock_status WHERE serial_number = $1',
            [serial_number]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "No status found for this vehicle." });
        }
        res.json({ status: result.rows[0].status });
    } catch (err) {
        res.status(500).json({ error: "Database error", details: err.message });
    }
};

const getLockStatuses = async (req, res) => {
    try {
        const result = await pool.query('SELECT serial_number, status FROM vehicle_lock_status');
        res.json({ lockStatuses: result.rows });
    } catch (err) {
        res.status(500).json({ error: "Database error", details: err.message });
    }
};

const deviceReset = async (req, res) => {
    const { serial_number, status } = req.body;
    if (!serial_number || typeof status !== "number") {
        return res.status(400).json({ error: "Missing or invalid parameters." });
    }
    const topic = `ekco/v1/${serial_number}/device/reset`;
    const payload = `${status}`;
    const mqttOptions = {
        username: "dev:ekcoFleets",
        password: "dzRND6ZqiI",
        reconnectPeriod: 0
    };
    const client = mqtt.connect("mqtt://ekco-tracking.co.za:1883", mqttOptions);
    let responded = false;
    client.on("connect", () => {
        client.publish(topic, payload, { retain: false }, (err) => {
            if (!responded) {
                responded = true;
                if (err) {
                    console.error("MQTT publish error:", err);
                    res.status(500).json({ error: "Failed to publish to MQTT", details: err.message });
                } else {
                    res.json({ message: "Command sent successfully", topic, payload });
                }
                client.end();
            }
        });
    });
    client.on("error", (err) => {
        if (!responded) {
            responded = true;
            console.error("MQTT connection error:", err);
            res.status(500).json({ error: "MQTT connection failed", details: err.message });
        }
        client.end();
    });
};

// --- Extracted route handlers as controller methods ---

const getLogs = (req, res) => {
    const { serial_number } = req.params;
    const logs = logsMap[serial_number] || [];
    res.json({ logs });
};

const streamData = (req, res) => {
    const { serial_number, type } = req.params;
    req.socket.setTimeout(0);
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    });
    res.flushHeaders();
    if (type === 'logs') {
        const logs = logsMap[serial_number] || [];
        logs.forEach(log => {
            res.write(`data: ${JSON.stringify(log)}\n\n`);
        });
    }
    if (type === 'lock') {
        if (lockStatusMap[serial_number] !== undefined) {
            res.write(`data: ${JSON.stringify({ timestamp: Date.now(), status: lockStatusMap[serial_number] })}\n\n`);
        }
    }
    if (!activeStreams[serial_number]) activeStreams[serial_number] = {};
    if (!activeStreams[serial_number][type]) activeStreams[serial_number][type] = [];
    activeStreams[serial_number][type].push(res);
    req.on('close', () => {
        if (activeStreams[serial_number] && activeStreams[serial_number][type]) {
            activeStreams[serial_number][type] = activeStreams[serial_number][type].filter(r => r !== res);
        }
    });
};

const stopStream = (req, res) => {
    const { serial_number, type } = req.params;
    if (activeStreams[serial_number] && activeStreams[serial_number][type]) {
        activeStreams[serial_number][type].forEach(r => {
            r.write('event: end\ndata: Stream stopped by server\n\n');
            r.end();
        });
        activeStreams[serial_number][type] = [];
        res.json({ message: `Stopped ${type} stream for ${serial_number}` });
    } else {
        res.status(404).json({ error: `No active stream for ${serial_number} and type ${type}` });
    }
};

const retrieveLogsStream = (req, res) => {
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
};

const stopRetrieveLogsStream = (req, res) => {
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
};

const retrieveLogsSync = async (req, res) => {
    const { serial_number } = req.params;
    const { command = "1", timeout = 5000 } = req.body;
    const topic = `ekco/v1/${serial_number}/logs/control`;
    const logsTopic = `ekco/v1/${serial_number}/logs/data`;
    const startTime = Date.now();
    const initialLogCount = (logsMap[serial_number] || []).length;
    console.log(`[RETRIEVE] Publishing to topic: ${topic} | payload: ${String(command)}`);
    mqttClient.publish(topic, String(command), { retain: false }, (err) => {
        if (err) {
            console.error(`[RETRIEVE] Publish error:`, err);
            return res.status(500).json({ error: "Failed to publish control command", details: err.message });
        }
        console.log(`[RETRIEVE] Publish successful to ${topic}`);
    });
    const checkLogs = () => {
        const logs = logsMap[serial_number] || [];
        if (logs.length > initialLogCount) {
            console.log(`[RETRIEVE] New logs received for ${serial_number}:`, logs.slice(initialLogCount));
            return res.json({ logs: logs.slice(initialLogCount) });
        }
        if (Date.now() - startTime > timeout) {
            console.log(`[RETRIEVE] Timeout waiting for logs for ${serial_number}`);
            return res.status(504).json({ error: "Timeout waiting for logs" });
        }
        setTimeout(checkLogs, 300);
    };
    checkLogs();
};

const retrieveLogsPromise = async (req, res) => {
    const { serial_number } = req.params;
    const { command = "get_logs", timeout = 5000 } = req.body;
    const controlTopic = `ekco/v1/${serial_number}/logs/control`;
    const dataTopic = `ekco/v1/${serial_number}/logs/data`;
    try {
        const responsePromise = new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error("Timeout waiting for logs from vehicle."));
            }, timeout);
            const onMessage = (topic, message) => {
                if (topic === dataTopic) {
                    clearTimeout(timeoutId);
                    const payload = message.toString();
                    resolve({ topic, payload });
                    mqttClient.off('message', onMessage);
                }
            };
            mqttClient.on('message', onMessage);
            mqttClient.publish(controlTopic, String(command), { retain: false }, (err) => {
                if (err) {
                    clearTimeout(timeoutId);
                    mqttClient.off('message', onMessage);
                    reject(new Error(`Failed to publish control command: ${err.message}`));
                }
            });
        });
        const response = await responsePromise;
        res.json({ message: "Logs received", ...response });
    } catch (err) {
        console.error(`Error in /api/logs/retrieve for ${serial_number}:`, err);
        res.status(500).json({ error: err.message });
    }
};

const controlLogs = (req, res) => {
    const { serial_number } = req.params;
    const { command } = req.body;
    if (!command) {
        return res.status(400).json({ error: "Missing 'command' in request body." });
    }
    const topic = `ekco/v1/${serial_number}/logs/control`;
    console.log(`[MQTT] Publishing to topic: ${topic} | payload: ${String(command)}`);
    mqttClient.publish(topic, String(command), { retain: false }, (err) => {
        if (err) {
            console.error(`[MQTT] Publish error:`, err);
            return res.status(500).json({ error: "Failed to publish control command", details: err.message });
        }
        console.log(`[MQTT] Publish successful to ${topic}`);
        res.json({ message: "Control command published", topic, command });
    });
};

const getVehicles = async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM vehicle_info");
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "Database error", details: err.message });
    }
};

const getVehicleBySerial = async (req, res) => {
    const { device_serial } = req.params;
    try {
        const result = await pool.query("SELECT * FROM vehicle_info WHERE device_serial = $1", [device_serial]);
        if (result.rows.length > 0) {
            res.json(result.rows);
        } else {
            res.status(404).json({ error: "Item not found" });
        }
    } catch (err) {
        res.status(500).json({ error: "Database error", details: err.message });
    }
};

const getCommissionedDevices = async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM devices WHERE commissioned = false");
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "Database error", details: err.message });
    }
};

const addVehicle = async (req, res) => {
    const {
        vehicle_name,
        vehicle_model,
        vehicle_colour,
        vehicle_year,
        device_serial,
        vehicle_reg,
        company_id,
        fleet_number , 
        motors = []
    } = req.body;

    if (!vehicle_name || !vehicle_model || !device_serial || !company_id) {
        return res.status(400).json({ error: "Missing required fields." });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const deviceExists = await client.query(
            "SELECT 1 FROM devices WHERE device_serial = $1",
            [device_serial]
        );
        if (deviceExists.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "Device not found." });
        }

        const alreadyAssigned = await client.query(
            "SELECT 1 FROM vehicle_info WHERE device_serial = $1",
            [device_serial]
        );
        if (alreadyAssigned.rowCount > 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "Device already assigned to a vehicle." });
        }

        const vehicle_id = uuidv4();

        const insertQuery = `
            INSERT INTO vehicle_info
            (vehicle_id, vehicle_name, vehicle_model, vehicle_colour, vehicle_year, device_serial, vehicle_reg, company_id, fleet_number)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *;
        `;

        const values = [
            vehicle_id,
            vehicle_name,
            vehicle_model,
            vehicle_colour,
            vehicle_year,
            device_serial,
            vehicle_reg,
            company_id,
            fleet_number 
        ];

        const result = await client.query(insertQuery, values);

        const motorSerials = motors
            .filter(m => m?.motor_serial)
            .map(m => BigInt(m.motor_serial));

        const numericDeviceSerial = BigInt(device_serial);

        if (motorSerials.length > 0) {
            await client.query(
                `UPDATE actuators
                 SET device_serial = $1
                 WHERE motor_serial = ANY($2)`,
                [numericDeviceSerial, motorSerials]
            );
        }

        await client.query(
            "UPDATE devices SET commissioned = true, active = true WHERE device_serial = $1",
            [device_serial]
        );

        const healthCheck = await client.query(
            "SELECT 1 FROM device_health WHERE device_serial = $1",
            [numericDeviceSerial]
        );
        if (healthCheck.rowCount === 0) {
            await client.query(
                `INSERT INTO device_health (device_serial)
                 VALUES ($1)`,
                [numericDeviceSerial]
            );
        }

        await client.query("COMMIT");
        res.status(201).json({
            message: "Vehicle added, device commissioned, motors linked, device_health updated",
            vehicle: result.rows[0]
        });

    } catch (err) {
        await client.query("ROLLBACK");
        console.error("Database error:", err);
        res.status(500).json({
            error: "Database error",
            details: err.stack
        });
    } finally {
        client.release();
    }
};


const unlinkDevice = async (req, res) => {
    const { device_serial } = req.body;
    if (!device_serial) {
        return res.status(400).json({ error: "Missing device_serial in request." });
    }
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const deviceResult = await client.query(
            "SELECT board_revision, board_type FROM devices WHERE device_serial = $1",
            [device_serial]
        );
        if (deviceResult.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Device not found." });
        }
        const { board_revision, board_type } = deviceResult.rows[0];
        const rabbitmqUsername = device_serial;
        const vehicleCheck = await client.query(
            "SELECT vehicle_id FROM vehicle_info WHERE device_serial = $1",
            [device_serial]
        );
        if (vehicleCheck.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "No vehicle associated with this device." });
        }
        const vehicleId = vehicleCheck.rows[0].vehicle_id;
        await client.query(
            "UPDATE actuators SET device_serial = NULL WHERE device_serial = $1",
            [device_serial]
        );
        await client.query(
            "UPDATE vehicle_info SET device_serial = NULL WHERE vehicle_id = $1",
            [vehicleId]
        );
        await client.query(
            "UPDATE devices SET commissioned = false, active = false WHERE device_serial = $1",
            [device_serial]
        );
        await client.query(
            "DELETE FROM device_health WHERE device_serial = $1",
            [device_serial]
        );
        await client.query("COMMIT");
        const rabbitHost = "http://152.53.82.236:15672/";
        const rabbitAdminUser = "ekcoAdmin";
        const rabbitAdminPass = "admin@ekco_prado123!";
        const deleteUrl = `${rabbitHost}api/users/${encodeURIComponent(rabbitmqUsername)}/`;
        console.log(`Attempting to delete RabbitMQ user: ${rabbitmqUsername}`);
        try {
            const response = await fetch(deleteUrl, {
                method: 'DELETE',
                headers: {
                    'Authorization': 'Basic ' + Buffer.from(`${rabbitAdminUser}:${rabbitAdminPass}`).toString('base64'),
                    'Accept': '*/*'
                }
            });
            const body = await response.text();
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${body}`);
            }
            console.log(`RabbitMQ user '${rabbitmqUsername}' deleted.`);
        } catch (err) {
            console.error(`Failed to delete RabbitMQ user: ${err.message}`);
        }
        res.status(200).json({
            message: "Device unlinked, decommissioned, removed from device_health, and RabbitMQ user deleted."
        });
    } catch (err) {
        await client.query("ROLLBACK");
        res.status(500).json({ error: "Database error", details: err.message });
    } finally {
        client.release();
    }
};

const relinkDevice = async (req, res) => {
    const { vehicle_id, device_serial, motors = [] } = req.body;
    if (!vehicle_id || !device_serial || motors.length !== 2) {
        return res.status(400).json({ error: "Missing vehicle_id, device_serial, or motors (expecting 2 motors)" });
    }
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const vehicleResult = await client.query(
            "SELECT device_serial FROM vehicle_info WHERE vehicle_id = $1",
            [vehicle_id]
        );
        if (vehicleResult.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Vehicle not found." });
        }
        if (vehicleResult.rows[0].device_serial) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "This vehicle already has a device linked." });
        }
        const deviceCheck = await client.query(
            "SELECT 1 FROM devices WHERE device_serial = $1",
            [device_serial]
        );
        if (deviceCheck.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "Device not found in devices table." });
        }
        await client.query(
            "UPDATE vehicle_info SET device_serial = $1 WHERE vehicle_id = $2",
            [device_serial, vehicle_id]
        );
        await client.query(
            `UPDATE actuators
             SET device_serial = $1::bigint
             WHERE motor_serial = ANY($2::bigint[])`,
            [device_serial, motors]
        );
        await client.query(
            "UPDATE devices SET commissioned = true, active = true WHERE device_serial = $1",
            [device_serial]
        );
        const healthCheck = await client.query(
            "SELECT 1 FROM device_health WHERE device_serial = $1",
            [device_serial]
        );
        if (healthCheck.rowCount === 0) {
            await client.query(
                `INSERT INTO device_health (device_serial)
                 VALUES ($1)`,
                [device_serial]
            );
        }
        await client.query("COMMIT");
        res.status(200).json({ message: "Device relinked, motors linked, commissioned, and device_health updated." });
    } catch (err) {
        await client.query("ROLLBACK");
        console.error(err);
        res.status(500).json({ error: "Database error", details: err.message });
    } finally {
        client.release();
    }
};

const getTripReports = async (req, res) => {
    const { device_serial } = req.params;
    try {
        const tripsResult = await pool.query(
            "SELECT * FROM trips WHERE device_serial = $1 ORDER BY start_time",
            [device_serial]
        );
        const tripsWithPath = await Promise.all(
            tripsResult.rows.map(async (trip) => {
                const pathResult = await pool.query(
                    `SELECT 
                      time,
                      ST_X(location::geometry) AS longitude,
                      ST_Y(location::geometry) AS latitude,
                      speed
                    FROM gps_ts 
                    WHERE device_serial = $1 
                      AND time BETWEEN $2 AND $3
                    ORDER BY time`,
                    [device_serial, trip.start_time, trip.end_time]
                );
                return {
                    ...trip,
                    path: pathResult.rows,
                };
            })
        );
        res.json(tripsWithPath);
    } catch (err) {
        res.status(500).json({ error: "Database error", details: err.message });
    }
};


const updateDeviceMotors = async (req, res) => {
  const { motor_serial, device_serial } = req.body;

  // Check if motor_serial and device_serial are provided
  if (!motor_serial || !device_serial) {
    return res.status(400).json({
      status: 'error',
      message: 'motor_serial and device_serial are required.'
    });
  }

  try {
    // Start a transaction to ensure atomicity
    const client = await pool.connect();

    try {
      await client.query('BEGIN');  // Start transaction

      // 1. Find the current motor that the device is associated with
      const result = await client.query(
        'SELECT motor_serial FROM actuators WHERE device_serial = $1',
        [device_serial]
      );

      // If a device is already associated with another motor
      if (result.rows.length > 0) {
        const currentMotorSerial = result.rows[0].motor_serial;

        // Nullify the current motor's device_serial
        await client.query(
          'UPDATE actuators SET device_serial = NULL WHERE motor_serial = $1',
          [currentMotorSerial]
        );
      }

      // 2. Now, associate the provided motor_serial with the device_serial
      await client.query(
        'UPDATE actuators SET device_serial = $1 WHERE motor_serial = $2',
        [device_serial, motor_serial]
      );

      // Commit the transaction
      await client.query('COMMIT');

      // Send success response
      res.json({
        status: 'success',
        message: 'Motor successfully swapped with new device.',
        motor_serial: motor_serial,
        new_device_serial: device_serial
      });
    } catch (err) {
      // In case of error, rollback transaction
      await client.query('ROLLBACK');
      console.error('Error during motor swap:', err);
      res.status(500).json({
        status: 'error',
        message: 'An error occurred while swapping the motor.',
        error: err.message
      });
    } finally {
      client.release(); // Release the client back to the pool
    }
  } catch (err) {
    console.error('DB connection error:', err);
    res.status(500).json({
      status: 'error',
      message: 'Database connection error.',
      error: err.message}
    )}};
  





module.exports = {
    lockVehicle,
    getLockStatus,
    getLockStatuses,
    deviceReset,
    getLogs,
    streamData,
    stopStream,
    retrieveLogsStream,
    stopRetrieveLogsStream,
    retrieveLogsSync,
    retrieveLogsPromise,
    controlLogs,
    getVehicles,
    getVehicleBySerial,
    getCommissionedDevices,
    addVehicle,
    unlinkDevice,
    relinkDevice,
    getTripReports,
    updateDeviceMotors
};
