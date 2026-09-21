export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogContext {
  traceId?: string;
  spanId?: string;
  tenantId?: string;
  correlationId?: string;
  workflowId?: string;
  [key: string]: any;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  trace_id?: string;
  span_id?: string;
  tenant_id?: string;
  correlation_id?: string;
  workflow_id?: string;
  context?: Record<string, any>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

const LOG_LEVEL_PRIORITIES: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

export class StructuredLogger {
  protected serviceName: string;
  protected defaultContext: LogContext;
  protected minLevel: LogLevel;

  constructor(serviceName: string, defaultContext: LogContext = {}, minLevel?: LogLevel) {

    this.serviceName = serviceName;
    this.defaultContext = defaultContext;
    const envLevel = (process.env.LOG_LEVEL?.toLowerCase() as LogLevel) || 'info';
    this.minLevel = minLevel || envLevel;
  }

  public child(context: LogContext): StructuredLogger {
    return new StructuredLogger(
      this.serviceName,
      { ...this.defaultContext, ...context },
      this.minLevel
    );
  }

  public debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  public info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  public warn(message: string, context?: LogContext, err?: Error): void {
    this.log('warn', message, context, err);
  }

  public error(message: string, context?: LogContext, err?: Error): void {
    this.log('error', message, context, err);
  }

  public fatal(message: string, context?: LogContext, err?: Error): void {
    this.log('fatal', message, context, err);
  }

  public log(level: LogLevel, message: string, context?: LogContext, err?: Error): void {
    if (LOG_LEVEL_PRIORITIES[level] < LOG_LEVEL_PRIORITIES[this.minLevel]) {
      return;
    }

    const mergedContext = { ...this.defaultContext, ...(context || {}) };
    const {
      traceId,
      spanId,
      tenantId,
      correlationId,
      workflowId,
      ...otherContext
    } = mergedContext;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.serviceName,
      message,
    };

    if (traceId) entry.trace_id = traceId;
    if (spanId) entry.span_id = spanId;
    if (tenantId) entry.tenant_id = tenantId;
    if (correlationId) entry.correlation_id = correlationId;
    if (workflowId) entry.workflow_id = workflowId;

    if (Object.keys(otherContext).length > 0) {
      entry.context = otherContext;
    }

    if (err) {
      entry.error = {
        name: err.name,
        message: err.message,
        stack: err.stack,
      };
    }

    const output = JSON.stringify(entry);

    if (level === 'error' || level === 'fatal') {
      console.error(output);
    } else if (level === 'warn') {
      console.warn(output);
    } else {
      console.log(output);
    }
  }
}

const loggers = new Map<string, StructuredLogger>();

export function getLogger(serviceName: string, defaultContext?: LogContext): StructuredLogger {
  const key = `${serviceName}:${JSON.stringify(defaultContext || {})}`;
  if (!loggers.has(key)) {
    loggers.set(key, new StructuredLogger(serviceName, defaultContext));
  }
  return loggers.get(key)!;
}
