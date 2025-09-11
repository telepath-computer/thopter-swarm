// Docker CLI wrapper
import { DockerBuildConfig, ExternalToolError } from './types';
import { runCommandOrThrow, runCommand } from './shell';

export class DockerWrapper {
  async build(config: DockerBuildConfig): Promise<void> {
    const args = ['build', '-t', config.image];
    
    if (config.dockerfile) {
      args.push('-f', config.dockerfile);
    }
    
    if (config.platform) {
      args.push('--platform', config.platform);
    }
    
    if (config.buildArgs) {
      Object.entries(config.buildArgs).forEach(([key, value]) => {
        args.push('--build-arg', `${key}=${value}`);
      });
    }
    
    args.push(config.context);
    
    await runCommandOrThrow('docker', args);
  }

  async buildWithBuildx(config: DockerBuildConfig): Promise<void> {
    const args = ['buildx', 'build', '-t', config.image];
    
    if (config.dockerfile) {
      args.push('-f', config.dockerfile);
    }
    
    if (config.platform) {
      args.push('--platform', config.platform);
    }
    
    if (config.buildArgs) {
      Object.entries(config.buildArgs).forEach(([key, value]) => {
        args.push('--build-arg', `${key}=${value}`);
      });
    }
    
    args.push(config.context);
    
    await runCommandOrThrow('docker', args);
  }

  async push(image: string): Promise<void> {
    await runCommandOrThrow('docker', ['push', image]);
  }

  async detectArchitecture(): Promise<'amd64' | 'arm64'> {
    const result = await runCommand('uname', ['-m']);
    const arch = result.stdout.trim();
    
    if (arch === 'arm64' || arch === 'aarch64') {
      return 'arm64';
    }
    
    return 'amd64';
  }

  async buildMultiPlatform(config: DockerBuildConfig): Promise<void> {
    const arch = await this.detectArchitecture();
    
    if (arch === 'arm64') {
      // Use buildx for cross-compilation to linux/amd64
      await this.buildWithBuildx({
        ...config,
        platform: 'linux/amd64'
      });
    } else {
      // Use native docker build
      await this.build(config);
    }
  }

  async imageExists(image: string): Promise<boolean> {
    try {
      const result = await runCommand('docker', ['images', '-q', image], { silent: true });
      return result.success && result.stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  async pullImage(image: string): Promise<void> {
    await runCommandOrThrow('docker', ['pull', image]);
  }

  async tagImage(sourceImage: string, targetImage: string): Promise<void> {
    await runCommandOrThrow('docker', ['tag', sourceImage, targetImage]);
  }

  async removeImage(image: string, force: boolean = false): Promise<void> {
    const args = ['rmi'];
    if (force) {
      args.push('-f');
    }
    args.push(image);
    
    await runCommandOrThrow('docker', args);
  }

  async generateImageTag(prefix: string): Promise<string> {
    const timestamp = new Date().toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '-')
      .substring(0, 19); // Remove milliseconds and timezone
    
    return `${prefix}-${timestamp}`;
  }
}