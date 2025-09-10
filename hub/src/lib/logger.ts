import { LogEvent } from './types';

class Logger {
  private logs: LogEvent[] = [];
  private readonly maxLogs = 100;
  
  private addLog(level: LogEvent['level'], message: string, agentId?: string, source?: string, context?: any): void {
    const logEvent: LogEvent = {
      timestamp: new Date(),
      level,
      message,
      agentId,
      source,
      context
    };
    
    // Add to circular buffer
    this.logs.push(logEvent);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift(); // Remove oldest log
    }
    
    // Also log to console with formatting
    const timestamp = logEvent.timestamp.toISOString();
    const prefix = agentId ? `[${agentId}]` : '';
    const sourcePrefix = source ? `{${source}}` : '';
    const levelPrefix = level.toUpperCase().padEnd(5);
    
    console.log(`${timestamp} ${levelPrefix} ${sourcePrefix}${prefix} ${message}`);
    
    if (context) {
      console.log(`${timestamp} ${levelPrefix} ${sourcePrefix}${prefix} Context:`, context);
    }
  }
  
  info(message: string, agentId?: string, source?: string, context?: any): void {
    this.addLog('info', message, agentId, source, context);
  }
  
  warn(message: string, agentId?: string, source?: string, context?: any): void {
    this.addLog('warn', message, agentId, source, context);
  }
  
  error(message: string, agentId?: string, source?: string, context?: any): void {
    this.addLog('error', message, agentId, source, context);
  }
  
  debug(message: string, agentId?: string, source?: string, context?: any): void {
    this.addLog('debug', message, agentId, source, context);
  }
  
  getRecentLogs(limit?: number): LogEvent[] {
    const logsToReturn = limit ? this.logs.slice(-limit) : this.logs;
    return [...logsToReturn]; // Return copy to prevent mutation
  }
  
  clearLogs(): void {
    this.logs = [];
  }
}

// Export singleton instance
export const logger = new Logger();