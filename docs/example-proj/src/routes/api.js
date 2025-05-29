// src/routes/api.js
const express = require('express');
const router = express.Router();

// Stats endpoint
router.get('/stats', (req, res) => {
  const stats = {
    server: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      platform: process.platform,
      nodeVersion: process.version,
      pid: process.pid
    },
    app: {
      name: 'express-tilt-example',
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString()
    },
    kubernetes: {
      namespace: process.env.NAMESPACE || 'default',
      podName: process.env.HOSTNAME || 'unknown',
      nodeName: process.env.NODE_NAME || 'unknown'
    },
    requests: {
      total: global.requestCount || 0,
      current: new Date().toISOString()
    }
  };

  // Increment request counter
  global.requestCount = (global.requestCount || 0) + 1;

  res.json(stats);
});

// Random data endpoint
router.get('/random', (req, res) => {
  const data = {
    number: Math.floor(Math.random() * 1000),
    color: ['red', 'blue', 'green', 'yellow', 'purple'][Math.floor(Math.random() * 5)],
    timestamp: new Date().toISOString(),
    emoji: ['🎲', '🎯', '🎨', '🎪', '🎭'][Math.floor(Math.random() * 5)]
  };
  
  res.json(data);
});

// Echo endpoint
router.post('/echo', (req, res) => {
  res.json({
    received: req.body,
    headers: req.headers,
    method: req.method,
    url: req.url,
    timestamp: new Date().toISOString()
  });
});

// Time endpoint
router.get('/time', (req, res) => {
  const now = new Date();
  res.json({
    iso: now.toISOString(),
    unix: Math.floor(now.getTime() / 1000),
    local: now.toString(),
    utc: now.toUTCString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
  });
});

module.exports = router;