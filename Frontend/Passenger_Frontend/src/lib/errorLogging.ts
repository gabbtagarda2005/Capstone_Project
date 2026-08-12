/**
 * Frontend Error & Performance Logging System
 * Logs errors, performance metrics, and system events to backend
 */

export interface FrontendErrorLog {
  timestamp: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  stack?: string;
  userId?: string;
  page: string;
  context?: Record<string, any>;
  userAgent?: string;
  url?: string;
}

export interface PerformanceMetric {
  name: string;
  value: number; // milliseconds
  timestamp: string;
  page: string;
  context?: Record<string, any>;
}

export interface SystemEvent {
  type: 'page_load' | 'api_call' | 'user_action' | 'error' | 'warning';
  name: string;
  timestamp: string;
  duration?: number;
  status?: 'success' | 'failure';
  metadata?: Record<string, any>;
}

const API_BASE = (import.meta.env.VITE_PASSENGER_API_URL || 'http://localhost:4000').replace(/\/+$/, '');
const LOG_QUEUE: FrontendErrorLog[] = [];
const QUEUE_FLUSH_INTERVAL = 30000; // 30 seconds
const QUEUE_SIZE_LIMIT = 50; // logs

let flushIntervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Initialize error logging system
 * Sets up global error handlers and periodic log flushing
 */
export function initializeErrorLogging(): void {
  // Global error handler
  window.addEventListener('error', (event) => {
    logError({
      message: event.message,
      stack: event.error?.stack,
      severity: 'error',
      context: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    });
  });

  // Unhandled promise rejection handler
  window.addEventListener('unhandledrejection', (event) => {
    logError({
      message: `Unhandled Promise Rejection: ${event.reason}`,
      severity: 'error',
      context: {
        reason: event.reason,
      },
    });
  });

  // Start periodic log flushing
  if (!flushIntervalId) {
    flushIntervalId = setInterval(() => {
      flushLogQueue();
    }, QUEUE_FLUSH_INTERVAL);
  }

  console.log('[ErrorLogger] Initialized global error logging');
}

/**
 * Log an error or warning
 */
export function logError(options: {
  message: string;
  stack?: string;
  severity?: 'warning' | 'error' | 'critical';
  context?: Record<string, any>;
  userId?: string;
}): void {
  const {
    message,
    stack,
    severity = 'error',
    context = {},
    userId,
  } = options;

  const errorLog: FrontendErrorLog = {
    timestamp: new Date().toISOString(),
    severity,
    message,
    stack,
    userId,
    page: window.location.pathname,
    context,
    userAgent: navigator.userAgent,
    url: window.location.href,
  };

  LOG_QUEUE.push(errorLog);

  // Flush if queue is full
  if (LOG_QUEUE.length >= QUEUE_SIZE_LIMIT) {
    void flushLogQueue();
  }

  // Also log to console in development
  if (import.meta.env.DEV) {
    console.group(`[${severity.toUpperCase()}] ${message}`);
    console.log('Details:', errorLog);
    if (stack) console.log('Stack:', stack);
    console.groupEnd();
  }
}

/**
 * Log a performance metric
 */
export async function logPerformanceMetric(options: {
  name: string;
  value: number; // milliseconds
  context?: Record<string, any>;
}): Promise<void> {
  const { name, value, context = {} } = options;

  const metric: PerformanceMetric = {
    name,
    value,
    timestamp: new Date().toISOString(),
    page: window.location.pathname,
    context,
  };

  try {
    await fetch(`${API_BASE}/api/logs/performance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metric),
    });
  } catch (error) {
    console.error('[PerformanceLogger] Failed to log metric:', error);
  }

  if (import.meta.env.DEV) {
    console.log(`[PERF] ${name}: ${value.toFixed(1)}ms`, context);
  }
}

/**
 * Log a system event
 */
export async function logSystemEvent(event: SystemEvent): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/logs/system-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
  } catch (error) {
    console.error('[SystemEventLogger] Failed to log event:', error);
  }
}

/**
 * Log API call timing
 */
export async function logApiCall(options: {
  endpoint: string;
  method: string;
  duration: number;
  status: number;
  context?: Record<string, any>;
}): Promise<void> {
  const { endpoint, method, duration, status, context = {} } = options;

  await logPerformanceMetric({
    name: `API ${method} ${endpoint}`,
    value: duration,
    context: {
      endpoint,
      method,
      status,
      ...context,
    },
  });
}

/**
 * Log page view/navigation
 */
export async function logPageView(pagePath: string): Promise<void> {
  const startTime = performance.now();
  
  await logSystemEvent({
    type: 'page_load',
    name: pagePath,
    timestamp: new Date().toISOString(),
    duration: performance.now() - startTime,
    status: 'success',
  });
}

/**
 * Track user action
 */
export async function logUserAction(options: {
  action: string;
  target?: string;
  metadata?: Record<string, any>;
}): Promise<void> {
  const { action, target, metadata = {} } = options;

  await logSystemEvent({
    type: 'user_action',
    name: action,
    timestamp: new Date().toISOString(),
    metadata: {
      target,
      ...metadata,
    },
  });
}

/**
 * Flush all queued logs to server
 */
export async function flushLogQueue(): Promise<void> {
  if (LOG_QUEUE.length === 0) {
    return;
  }

  const logsToSend = [...LOG_QUEUE];
  LOG_QUEUE.length = 0; // Clear queue

  try {
    await fetch(`${API_BASE}/api/logs/frontend-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(logsToSend),
    });

    if (import.meta.env.DEV) {
      console.log(`[ErrorLogger] Flushed ${logsToSend.length} logs`);
    }
  } catch (error) {
    console.error('[ErrorLogger] Failed to flush logs:', error);
    // Re-add logs to queue on failure (with limit to prevent memory issues)
    if (LOG_QUEUE.length < QUEUE_SIZE_LIMIT * 2) {
      LOG_QUEUE.unshift(...logsToSend);
    }
  }
}

/**
 * Force flush logs before page unload
 */
export function setupBeforeUnloadHandler(): void {
  window.addEventListener('beforeunload', async () => {
    // Use navigator.sendBeacon for reliable delivery
    if (LOG_QUEUE.length > 0 && 'sendBeacon' in navigator) {
      navigator.sendBeacon(
        `${API_BASE}/api/logs/frontend-errors`,
        JSON.stringify(LOG_QUEUE)
      );
    }
  });
}

/**
 * Get current error statistics
 */
export function getErrorStats(): {
  totalErrors: number;
  queuedLogs: number;
  queueCapacity: number;
} {
  return {
    totalErrors: LOG_QUEUE.length,
    queuedLogs: LOG_QUEUE.length,
    queueCapacity: QUEUE_SIZE_LIMIT,
  };
}

/**
 * Clear all queued logs (for testing/debugging)
 */
export function clearLogQueue(): void {
  LOG_QUEUE.length = 0;
  console.log('[ErrorLogger] Log queue cleared');
}

/**
 * Disable error logging
 */
export function disableErrorLogging(): void {
  if (flushIntervalId) {
    clearInterval(flushIntervalId);
    flushIntervalId = null;
  }
  console.log('[ErrorLogger] Error logging disabled');
}

// Auto-initialize on import
if (typeof window !== 'undefined') {
  initializeErrorLogging();
  setupBeforeUnloadHandler();
}

export default {
  initializeErrorLogging,
  logError,
  logPerformanceMetric,
  logSystemEvent,
  logApiCall,
  logPageView,
  logUserAction,
  flushLogQueue,
  getErrorStats,
  clearLogQueue,
  disableErrorLogging,
};
