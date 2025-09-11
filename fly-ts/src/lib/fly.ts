// Fly.io CLI wrapper with type safety
import { FlyMachine, FlyVolume, MachineConfig, ExternalToolError } from './types';
import { runCommandJson, runCommandOrThrow, runCommand } from './shell';

export class FlyWrapper {
  constructor(private appName?: string) {}

  private getAppArgs(): string[] {
    return this.appName ? ['-a', this.appName] : [];
  }

  async listMachines(): Promise<FlyMachine[]> {
    try {
      return await runCommandJson<FlyMachine[]>('fly', [
        'machines', 'list', '--json',
        ...this.getAppArgs()
      ]);
    } catch (error) {
      if (error instanceof ExternalToolError && error.details?.stdout?.includes('[]')) {
        return [];
      }
      throw error;
    }
  }

  async getMachine(id: string): Promise<FlyMachine | null> {
    const machines = await this.listMachines();
    return machines.find(machine => machine.id === id) || null;
  }

  async getMachineByName(name: string): Promise<FlyMachine | null> {
    const machines = await this.listMachines();
    return machines.find(machine => machine.name === name) || null;
  }

  async getMachinesByPrefix(prefix: string): Promise<FlyMachine[]> {
    const machines = await this.listMachines();
    return machines.filter(machine => machine.name?.startsWith(prefix));
  }

  async createMachine(config: MachineConfig): Promise<string> {
    const args = ['machine', 'run', config.image, '--name', config.name];
    
    if (config.region) {
      args.push('--region', config.region);
    }
    
    if (config.vmSize) {
      args.push('--vm-size', config.vmSize);
    }
    
    if (config.autostop === false) {
      args.push('--autostop=off');
    }
    
    if (config.volume) {
      args.push('--volume', `${config.volume.name}:${config.volume.mountPath}`);
    }
    
    if (config.env) {
      Object.entries(config.env).forEach(([key, value]) => {
        args.push('--env', `${key}=${value}`);
      });
    }
    
    if (config.ports) {
      config.ports.forEach(port => {
        args.push('--port', port.port.toString());
      });
    }
    
    if (config.metadata) {
      Object.entries(config.metadata).forEach(([key, value]) => {
        args.push('--metadata', `${key}=${value}`);
      });
    }
    
    args.push(...this.getAppArgs());
    
    const result = await runCommandOrThrow('fly', args);
    
    // Extract machine ID from output (fly usually outputs the machine ID)
    const lines = result.stdout.split('\n');
    for (const line of lines) {
      if (line.includes('machine') && line.includes('created')) {
        const match = line.match(/machine\s+([a-f0-9]+)/i);
        if (match && match[1]) {
          return match[1];
        }
      }
    }
    
    // Fallback: try to find the machine by name
    const machine = await this.getMachineByName(config.name);
    if (machine) {
      return machine.id;
    }
    
    throw new ExternalToolError('fly', 'Could not determine created machine ID');
  }

  async startMachine(id: string): Promise<void> {
    await runCommandOrThrow('fly', [
      'machine', 'start', id,
      ...this.getAppArgs()
    ]);
  }

  async stopMachine(id: string): Promise<void> {
    await runCommandOrThrow('fly', [
      'machine', 'stop', id,
      ...this.getAppArgs()
    ]);
  }

  async destroyMachine(id: string, force: boolean = false): Promise<void> {
    const args = ['machine', 'destroy', id];
    if (force) {
      args.push('--force');
    }
    args.push(...this.getAppArgs());
    
    await runCommandOrThrow('fly', args);
  }

  async waitForMachineState(
    id: string, 
    targetState: string, 
    timeoutMs: number = 60000
  ): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      const machine = await this.getMachine(id);
      if (machine?.state === targetState) {
        return true;
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    return false;
  }

  async listVolumes(): Promise<FlyVolume[]> {
    try {
      return await runCommandJson<FlyVolume[]>('fly', [
        'volumes', 'list', '--json',
        ...this.getAppArgs()
      ]);
    } catch (error) {
      if (error instanceof ExternalToolError && error.details?.stdout?.includes('[]')) {
        return [];
      }
      throw error;
    }
  }

  async getVolume(id: string): Promise<FlyVolume | null> {
    const volumes = await this.listVolumes();
    return volumes.find(volume => volume.id === id) || null;
  }

  async getVolumeByName(name: string): Promise<FlyVolume | null> {
    const volumes = await this.listVolumes();
    return volumes.find(volume => volume.name === name) || null;
  }

  async createVolume(
    name: string, 
    sizeGb: number, 
    region: string
  ): Promise<string> {
    const result = await runCommandOrThrow('fly', [
      'volume', 'create', name,
      '--size', sizeGb.toString(),
      '--region', region,
      '-y',
      ...this.getAppArgs()
    ]);
    
    // Extract volume ID from output
    const match = result.stdout.match(/volume\s+([a-f0-9]+)/i);
    if (match && match[1]) {
      return match[1];
    }
    
    // Fallback: find volume by name
    const volume = await this.getVolumeByName(name);
    if (volume) {
      return volume.id;
    }
    
    throw new ExternalToolError('fly', 'Could not determine created volume ID');
  }

  async destroyVolume(id: string): Promise<void> {
    await runCommandOrThrow('fly', [
      'volumes', 'destroy', id, '--yes',
      ...this.getAppArgs()
    ]);
  }

  async authenticateDocker(): Promise<void> {
    await runCommandOrThrow('fly', ['auth', 'docker']);
  }

  async sshCommand(machineId: string, command: string): Promise<string> {
    const result = await runCommandOrThrow('fly', [
      'ssh', 'console',
      '--machine', machineId,
      '--command', command,
      ...this.getAppArgs()
    ]);
    
    return result.stdout;
  }

  async checkAuth(): Promise<string> {
    const result = await runCommandOrThrow('fly', ['auth', 'whoami']);
    return result.stdout.trim();
  }

  async listApps(): Promise<string[]> {
    const result = await runCommandOrThrow('fly', ['apps', 'list']);
    const lines = result.stdout.split('\n');
    const apps: string[] = [];
    
    // Parse app list output
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('Name') && !trimmed.startsWith('---')) {
        const appName = trimmed.split(/\s+/)[0];
        if (appName) {
          apps.push(appName);
        }
      }
    }
    
    return apps;
  }
}