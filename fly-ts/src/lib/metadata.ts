// Redis metadata service client
import { runCommand } from './shell';
import { ExternalToolError } from './types';

export interface MetadataServiceConfig {
  host: string;
  port: number;
  timeout: number;
}

export class MetadataClient {
  constructor(
    private host: string,
    private port: number = 6379,
    private timeout: number = 10
  ) {}

  async ping(): Promise<boolean> {
    try {
      const result = await runCommand('redis-cli', [
        '-h', this.host,
        '-p', this.port.toString(),
        '-t', this.timeout.toString(),
        'ping'
      ], { silent: true });
      
      return result.success && result.stdout.trim() === 'PONG';
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      const result = await runCommand('redis-cli', [
        '-h', this.host,
        '-p', this.port.toString(),
        '-t', this.timeout.toString(),
        'GET', key
      ], { silent: true });
      
      if (!result.success) {
        throw new ExternalToolError('redis-cli', result.stderr || 'GET command failed');
      }
      
      const value = result.stdout.trim();
      return value === '(nil)' ? null : value;
    } catch (error) {
      if (error instanceof ExternalToolError) {
        throw error;
      }
      throw new ExternalToolError('redis-cli', `Failed to get key ${key}: ${error}`);
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      const result = await runCommand('redis-cli', [
        '-h', this.host,
        '-p', this.port.toString(),
        '-t', this.timeout.toString(),
        'SET', key, value
      ], { silent: true });
      
      if (!result.success) {
        throw new ExternalToolError('redis-cli', result.stderr || 'SET command failed');
      }
    } catch (error) {
      if (error instanceof ExternalToolError) {
        throw error;
      }
      throw new ExternalToolError('redis-cli', `Failed to set key ${key}: ${error}`);
    }
  }

  async hget(hashKey: string, field: string): Promise<string | null> {
    try {
      const result = await runCommand('redis-cli', [
        '-h', this.host,
        '-p', this.port.toString(),
        '-t', this.timeout.toString(),
        'HGET', hashKey, field
      ], { silent: true });
      
      if (!result.success) {
        throw new ExternalToolError('redis-cli', result.stderr || 'HGET command failed');
      }
      
      const value = result.stdout.trim();
      return value === '(nil)' ? null : value;
    } catch (error) {
      if (error instanceof ExternalToolError) {
        throw error;
      }
      throw new ExternalToolError('redis-cli', `Failed to hget ${hashKey}.${field}: ${error}`);
    }
  }

  async hset(hashKey: string, field: string, value: string): Promise<void> {
    try {
      const result = await runCommand('redis-cli', [
        '-h', this.host,
        '-p', this.port.toString(),
        '-t', this.timeout.toString(),
        'HSET', hashKey, field, value
      ], { silent: true });
      
      if (!result.success) {
        throw new ExternalToolError('redis-cli', result.stderr || 'HSET command failed');
      }
    } catch (error) {
      if (error instanceof ExternalToolError) {
        throw error;
      }
      throw new ExternalToolError('redis-cli', `Failed to hset ${hashKey}.${field}: ${error}`);
    }
  }

  async hgetall(hashKey: string): Promise<Record<string, string>> {
    try {
      const result = await runCommand('redis-cli', [
        '-h', this.host,
        '-p', this.port.toString(),
        '-t', this.timeout.toString(),
        'HGETALL', hashKey
      ], { silent: true });
      
      if (!result.success) {
        throw new ExternalToolError('redis-cli', result.stderr || 'HGETALL command failed');
      }
      
      const lines = result.stdout.trim().split('\n');
      const obj: Record<string, string> = {};
      
      for (let i = 0; i < lines.length; i += 2) {
        const key = lines[i];
        const value = lines[i + 1];
        if (key && value && i + 1 < lines.length) {
          obj[key] = value;
        }
      }
      
      return obj;
    } catch (error) {
      if (error instanceof ExternalToolError) {
        throw error;
      }
      throw new ExternalToolError('redis-cli', `Failed to hgetall ${hashKey}: ${error}`);
    }
  }

  async waitForReady(
    maxAttempts: number = 12,
    delayMs: number = 5000
  ): Promise<boolean> {
    for (let i = 1; i <= maxAttempts; i++) {
      if (await this.ping()) {
        return true;
      }
      
      if (i < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    
    return false;
  }

  getConnectionString(): string {
    return `${this.host}:${this.port}`;
  }

  static createServiceDiscoveryClient(appName: string): MetadataClient {
    return new MetadataClient(`1.redis.kv._metadata.${appName}.internal`);
  }

  static createMachineClient(machineId: string, appName: string): MetadataClient {
    return new MetadataClient(`${machineId}.vm.${appName}.internal`);
  }
}