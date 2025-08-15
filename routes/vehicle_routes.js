const express = require('express');
const router = express.Router();
const vehicleController = require('../controllers/vehicle controllers/vehicle_controller');

// MQTT lock endpoints
router.post('/lockVehicle', vehicleController.lockVehicle);
router.get('/lockStatuse', vehicleController.getLockStatus); // Note: original typo preserved
router.get('/lockStatuses', vehicleController.getLockStatuses);
router.post('/reset', vehicleController.deviceReset);

// Logs and streaming endpoints
router.get('/logs/:serial_number', vehicleController.getLogs);
router.get('/stream/:serial_number/:type', vehicleController.streamData);
router.post('/stream/:serial_number/:type/stop', vehicleController.stopStream);
//router.get('/logs/:serial_number/retrieve/stream', vehicleController.retrieveLogsStream);
//router.post('/logs/:serial_number/retrieve/stream/stop', vehicleController.stopRetrieveLogsStream);
router.post('/logs/:serial_number/retrieve', vehicleController.retrieveLogsSync); // If you want to use retrieveLogsPromise, swap here
router.post('/logs/:serial_number/control', vehicleController.controlLogs);

// Vehicle endpoints
router.get('/vehicles', vehicleController.getVehicles);
router.post('/vehicles/update-device-motors', vehicleController.updateDeviceMotors);
router.get('/vehicles/:device_serial', vehicleController.getVehicleBySerial);
router.get('/devices/commissioned', vehicleController.getCommissionedDevices);
router.post('/vehicles/add', vehicleController.addVehicle);
router.patch('/vehicles/unlink-device', vehicleController.unlinkDevice);
router.post('/vehicles/relink-device', vehicleController.relinkDevice);



// Trip reports
router.get('/tripReports/:device_serial', vehicleController.getTripReports);

module.exports = router;
