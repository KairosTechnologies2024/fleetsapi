const express = require('express');
const router = express.Router();
const gpsController = require('../controllers/gps controllers/gps_controller');

// GPS Data Endpoints
router.get('/data', gpsController.getAllGpsData);
router.get('/data/latest', gpsController.getLatestGpsData);
router.get('/data/:device_serial', gpsController.getGpsDataBySerial);
router.get('/data/:device_serial/coordinates', gpsController.getGpsCoordinates);
router.get('/data/:device_serial/trip', gpsController.getTripData);

// Alerts Endpoints
router.get('/alerts', gpsController.getAllAlerts);
router.get('/alerts/latest', gpsController.getLatestAlerts);
router.get('/alerts/latest200', gpsController.getLatest200Alerts);
router.get('/alerts/top200', gpsController.getTop200AlertsPerDevice);
router.get('/alerts/:device_serial', gpsController.getAlertsBySerial);

// Device Health Endpoints
router.get('/deviceHealth/', gpsController.getDeviceHealth);
router.get('/motorHealth/', gpsController.getMotorHealth);

// Ignition Status Endpoint
router.get('/ignitionStatus/:device_serial', gpsController.getIgnitionStatus);

module.exports = router;
