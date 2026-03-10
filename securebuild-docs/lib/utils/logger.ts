export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const getTimestamp = () => new Date().toISOString();

const formatMessage = (level: LogLevel, message: string, context?: Record<string, unknown>) => {
  const timestamp = getTimestamp();
  const contextStr = context ? ` ${JSON.stringify(context)}` : '';
  return `[${timestamp}] ${level.toUpperCase()} Server ${message}${contextStr}`;
};

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => {
    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.debug(formatMessage('debug', message, context));
    }
  },
  info: (message: string, context?: Record<string, unknown>) => {
    // eslint-disable-next-line no-console
    console.log(formatMessage('info', message, context));
  },
  warn: (message: string, context?: Record<string, unknown>) => {
    // eslint-disable-next-line no-console
    console.warn(formatMessage('warn', message, context));
  },
  error: (message: string, error?: unknown, context?: Record<string, unknown>) => {
    const errorContext = error instanceof Error ?
      { ...context, error: { message: error.message, stack: error.stack } } :
      context;
    // eslint-disable-next-line no-console
    console.error(formatMessage('error', message, errorContext));
  }
};
