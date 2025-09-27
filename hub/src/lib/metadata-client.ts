import Redis from 'ioredis';
import { logger } from './logger';

export interface MetadataValues {
  thopterImage?: string;
  hubImage?: string;
}

export class MetadataClient {
  private redis: Redis | null = null;
  private connectionPromise: Promise<void> | null = null;
  private readonly host: string;
  private readonly maxRetries = 3; // Reduced from 5
  private readonly retryDelay = 1000; // Reduced from 2 seconds

  constructor() {
    this.host = process.env.METADATA_SERVICE_HOST!;
    if (!this.host) {
      throw new Error('METADATA_SERVICE_HOST environment variable is required');
    }
  }

  /**
   * Initialize connection to metadata service
   */
  async connect(): Promise<void> {
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = this.doConnect();
    return this.connectionPromise;
  }

  private async doConnect(): Promise<void> {
    logger.info(`Connecting to metadata service at ${this.host}:6379`, undefined, 'metadata-client');
    logger.info(`METADATA_SERVICE_HOST environment variable: '${process.env.METADATA_SERVICE_HOST}'`, undefined, 'metadata-client');
    
    let attempt = 0;
    while (attempt < this.maxRetries) {
      try {
        this.redis = new Redis({
          host: this.host,
          port: 6379,
          family: 6, // Force IPv6 for fly.io internal networking
          maxRetriesPerRequest: 3,
          connectTimeout: 10000,
          lazyConnect: true
        });

        // Set up event handlers
        this.redis.on('error', (err: Error) => {
          logger.error(`Redis connection error: ${err.message}`, undefined, 'metadata-client');
        });

        this.redis.on('connect', () => {
          logger.info('Connected to metadata service', undefined, 'metadata-client');
        });

        this.redis.on('reconnecting', () => {
          logger.info('Reconnecting to metadata service...', undefined, 'metadata-client');
        });

        // Test connection
        await this.redis.connect();
        await this.redis.ping();
        
        logger.info('Metadata service connection established', undefined, 'metadata-client');
        return;
      } catch (error) {
        attempt++;
        logger.warn(`Failed to connect to metadata service (attempt ${attempt}/${this.maxRetries}): ${error}`, undefined, 'metadata-client');
        
        if (attempt >= this.maxRetries) {
          logger.error(`Failed to connect to metadata service after ${this.maxRetries} attempts: ${error}`, undefined, 'metadata-client');
          // Don't throw - allow hub to start without metadata service
          return;
        }
        
        await this.sleep(this.retryDelay);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get a value from the metadata hash
   */
  private async getValue(key: string): Promise<string | null> {
    if (!this.redis) {
      throw new Error('Metadata client not connected');
    }

    try {
      const value = await this.redis.hget('metadata', key);
      return value;
    } catch (error) {
      logger.error(`Failed to get metadata value ${key}: ${error}`, undefined, 'metadata-client');
      throw error;
    }
  }

  /**
   * Set a value in the metadata hash
   */
  private async setValue(key: string, value: string): Promise<void> {
    if (!this.redis) {
      throw new Error('Metadata client not connected');
    }

    try {
      await this.redis.hset('metadata', key, value);
      logger.info(`Set metadata ${key} = ${value}`, undefined, 'metadata-client');
    } catch (error) {
      logger.error(`Failed to set metadata value ${key}: ${error}`, undefined, 'metadata-client');
      throw error;
    }
  }

  /**
   * Get all metadata values at once
   */
  async getAllValues(): Promise<MetadataValues> {
    if (!this.redis) {
      throw new Error('Metadata client not connected');
    }

    try {
      const values = await this.redis.hgetall('metadata');
      return {
        thopterImage: values.THOPTER_IMAGE || undefined,
        hubImage: values.HUB_IMAGE || undefined,
      };
    } catch (error) {
      logger.error(`Failed to get all metadata values: ${error}`, undefined, 'metadata-client');
      throw error;
    }
  }

  // Specific getters
  async getThopterImage(): Promise<string | null> {
    return this.getValue('THOPTER_IMAGE');
  }



  async getMetadataMachineId(): Promise<string | null> {
    return this.getValue('METADATA_MACHINE_ID');
  }

  // Specific setters
  async setThopterImage(image: string): Promise<void> {
    return this.setValue('THOPTER_IMAGE', image);
  }


  async setHubImage(image: string): Promise<void> {
    return this.setValue('HUB_IMAGE', image);
  }

  /**
   * Validate that required metadata values exist
   */
  async validateRequiredValues(): Promise<void> {
    if (!this.redis) {
      throw new Error('Metadata client not connected - cannot validate values');
    }

    try {
      const values = await this.getAllValues();
      
      const required: string[] = [];
      const missing = required.filter(key => !values[key as keyof MetadataValues]);
      
      if (missing.length > 0) {
        throw new Error(`Missing required metadata values: ${missing.join(', ')}`);
      }

      // THOPTER_IMAGE is required for provisioning
      if (!values.thopterImage) {
        logger.warn('THOPTER_IMAGE not set in metadata - provisioning will fail until thopter image is built', undefined, 'metadata-client');
      }

      logger.info('Metadata validation passed', undefined, 'metadata-client');
    } catch (error) {
      logger.error(`Metadata validation failed: ${error}`, undefined, 'metadata-client');
      throw error;
    }
  }

  /**
   * Disconnect from metadata service
   */
  async disconnect(): Promise<void> {
    if (this.redis) {
      await this.redis.disconnect();
      this.redis = null;
      this.connectionPromise = null;
      logger.info('Disconnected from metadata service', undefined, 'metadata-client');
    }
  }
}

// Singleton instance
export const metadataClient = new MetadataClient();
