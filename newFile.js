const { app, logsMap, activeLogStreams } = require("./vehicle_service");

// SSE endpoint to stream logs in real-time
app.get("/api/logs/:serial_number/stream", (req, res) => {
    const { serial_number } = req.params;
    req.socket.setTimeout(0); // Prevent socket timeout
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    });
    res.flushHeaders();

    // Send existing logs first
    const logs = logsMap[serial_number] || [];
    logs.forEach(log => {
        res.write(`data: ${JSON.stringify(log)}\n\n`);
    });

    // Register this response in the active streams
    if (!activeLogStreams[serial_number]) activeLogStreams[serial_number] = [];
    activeLogStreams[serial_number].push(res);

    console.log(activeLogStreams);

    // Remove on client disconnect
    req.on('close', () => {
        activeLogStreams[serial_number] = (activeLogStreams[serial_number] || []).filter(r => r !== res);
    });
});
