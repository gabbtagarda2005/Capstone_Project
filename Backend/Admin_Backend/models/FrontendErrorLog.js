/**
 * Frontend Error Log Model
 * Tracks frontend errors, warnings, and performance issues
 */

const { Schema, model } = require('mongoose');

const frontendErrorLogSchema = new Schema({
  timestamp: {
    type: Date,
    default: Date.now,
    index: true,
  },
  severity: {
    type: String,
    enum: ['info', 'warning', 'error', 'critical'],
    default: 'error',
    index: true,
  },
  message: {
    type: String,
    required: true,
    maxlength: 1000,
  },
  stack: {
    type: String,
    maxlength: 5000,
  },
  userId: {
    type: String,
    index: true,
  },
  page: {
    type: String,
    index: true,
  },
  context: Schema.Types.Mixed,
  userAgent: String,
  url: String,
  
  // Indexing for queries
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 2592000, // Auto-delete after 30 days
  },
});

// Compound indexes for efficient queries
frontendErrorLogSchema.index({ severity: 1, timestamp: -1 });
frontendErrorLogSchema.index({ userId: 1, timestamp: -1 });
frontendErrorLogSchema.index({ page: 1, timestamp: -1 });

// Methods
frontendErrorLogSchema.statics.logError = async function(errorData) {
  try {
    const error = new this(errorData);
    return await error.save();
  } catch (err) {
    console.error('Error saving frontend error log:', err);
  }
};

frontendErrorLogSchema.statics.getErrorsByPage = async function(page, limit = 100) {
  return await this.find({ page })
    .sort({ timestamp: -1 })
    .limit(limit);
};

frontendErrorLogSchema.statics.getErrorsBySeverity = async function(severity, limit = 100) {
  return await this.find({ severity })
    .sort({ timestamp: -1 })
    .limit(limit);
};

frontendErrorLogSchema.statics.getErrorStatistics = async function(timeWindowMs = 3600000) {
  const startTime = new Date(Date.now() - timeWindowMs);
  return await this.aggregate([
    { $match: { timestamp: { $gte: startTime } } },
    {
      $group: {
        _id: '$severity',
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);
};

module.exports = model('FrontendErrorLog', frontendErrorLogSchema);
