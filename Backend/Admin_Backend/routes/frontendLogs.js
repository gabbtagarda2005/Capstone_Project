/**
 * Frontend Logging Routes
 * Receives and stores frontend errors, performance metrics, and system events
 */

const express = require('express');
const router = express.Router();
const FrontendErrorLog = require('../models/FrontendErrorLog');

/**
 * POST /api/logs/frontend-errors
 * Receive batch of frontend errors
 */
router.post('/frontend-errors', async (req, res) => {
  try {
    const logs = Array.isArray(req.body) ? req.body : [req.body];
    
    if (logs.length === 0) {
      return res.status(400).json({ error: 'No logs provided' });
    }

    // Save all logs asynchronously (fire-and-forget)
    const insertPromises = logs.map((log) => {
      return FrontendErrorLog.create({
        timestamp: log.timestamp ? new Date(log.timestamp) : new Date(),
        severity: log.severity || 'error',
        message: log.message,
        stack: log.stack,
        userId: log.userId,
        page: log.page,
        context: log.context,
        userAgent: log.userAgent,
        url: log.url,
      }).catch((err) => {
        console.error('Error saving frontend error log:', err);
      });
    });

    // Don't wait for saves - return immediately
    Promise.all(insertPromises).catch(() => {});

    // Send 202 Accepted - logs are queued for processing
    res.status(202).json({
      accepted: logs.length,
      message: 'Logs queued for storage',
    });
  } catch (error) {
    console.error('Error in /api/logs/frontend-errors:', error);
    res.status(500).json({ error: 'Failed to process logs' });
  }
});

/**
 * POST /api/logs/performance
 * Log performance metrics
 */
router.post('/performance', async (req, res) => {
  try {
    const { name, value, page, context } = req.body;

    if (!name || typeof value !== 'number') {
      return res.status(400).json({ error: 'Invalid metric data' });
    }

    // Log performance metrics (non-blocking)
    FrontendErrorLog.create({
      timestamp: new Date(),
      severity: 'info',
      message: `PERF: ${name} took ${value.toFixed(1)}ms`,
      page,
      context: {
        type: 'performance',
        metric: name,
        value,
        ...context,
      },
    }).catch((err) => {
      console.error('Error saving performance metric:', err);
    });

    res.status(202).json({ accepted: true });
  } catch (error) {
    console.error('Error in /api/logs/performance:', error);
    res.status(500).json({ error: 'Failed to log performance' });
  }
});

/**
 * POST /api/logs/system-event
 * Log system events (page loads, user actions, etc.)
 */
router.post('/system-event', async (req, res) => {
  try {
    const { type, name, duration, status, metadata } = req.body;

    if (!type || !name) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Log system event
    FrontendErrorLog.create({
      timestamp: new Date(),
      severity: 'info',
      message: `EVENT: ${type.toUpperCase()}: ${name}${status ? ` [${status}]` : ''}`,
      page: (metadata && metadata.page) || '/',
      context: {
        type: 'system_event',
        eventType: type,
        eventName: name,
        duration,
        status,
        ...metadata,
      },
    }).catch((err) => {
      console.error('Error saving system event:', err);
    });

    res.status(202).json({ accepted: true });
  } catch (error) {
    console.error('Error in /api/logs/system-event:', error);
    res.status(500).json({ error: 'Failed to log system event' });
  }
});

/**
 * GET /api/logs/frontend-errors
 * Retrieve frontend error logs (admin only)
 * Query params: severity, page, limit, skip
 */
router.get('/frontend-errors', async (req, res) => {
  try {
    // TODO: Add authentication check for admin

    const { severity, page, limit = 100, skip = 0 } = req.query;
    const filter = {};

    if (severity) filter.severity = severity;
    if (page) filter.page = page;

    const logs = await FrontendErrorLog.find(filter)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip));

    const total = await FrontendErrorLog.countDocuments(filter);

    res.json({
      logs,
      pagination: {
        total,
        limit: parseInt(limit),
        skip: parseInt(skip),
        hasMore: parseInt(skip) + parseInt(limit) < total,
      },
    });
  } catch (error) {
    console.error('Error in GET /api/logs/frontend-errors:', error);
    res.status(500).json({ error: 'Failed to retrieve logs' });
  }
});

/**
 * GET /api/logs/error-statistics
 * Get error statistics over time window
 * Query params: timeWindow (ms, default 1 hour)
 */
router.get('/error-statistics', async (req, res) => {
  try {
    // TODO: Add authentication check for admin

    const timeWindow = parseInt(req.query.timeWindow) || 3600000; // 1 hour default
    const stats = await FrontendErrorLog.getErrorStatistics(timeWindow);

    res.json({
      timeWindow,
      statistics: stats,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error('Error in GET /api/logs/error-statistics:', error);
    res.status(500).json({ error: 'Failed to retrieve statistics' });
  }
});

/**
 * GET /api/logs/error-by-page
 * Get error summary by page
 */
router.get('/error-by-page', async (req, res) => {
  try {
    // TODO: Add authentication check for admin

    const { limit = 20 } = req.query;

    const stats = await FrontendErrorLog.aggregate([
      {
        $group: {
          _id: '$page',
          count: { $sum: 1 },
          severities: {
            $push: '$severity',
          },
          latestError: { $max: '$timestamp' },
        },
      },
      { $sort: { count: -1 } },
      { $limit: parseInt(limit) },
    ]);

    res.json({
      errorsByPage: stats,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error('Error in GET /api/logs/error-by-page:', error);
    res.status(500).json({ error: 'Failed to retrieve page errors' });
  }
});

module.exports = router;
