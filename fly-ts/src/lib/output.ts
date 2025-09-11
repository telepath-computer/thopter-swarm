// Terminal output utilities with colors and emojis
import chalk from 'chalk';

// Emojis used throughout the deployment scripts
export const EMOJIS = {
  CHECK: '✅',
  CROSS: '❌',
  WARNING: '⚠️',
  INFO: 'ℹ️',
  ROCKET: '🚀',
  STAR: '🏆',
  GEAR: '⚙️',
  REDIS: '📊',
  BOOM: '💥',
  HELICOPTER: '🚁',
  BIRD: '🐦',
  CLEAN: '🧹'
} as const;

export function success(message: string): void {
  console.log(chalk.green(`${EMOJIS.CHECK} ${message}`));
}

export function error(message: string): void {
  console.log(chalk.red(`${EMOJIS.CROSS} ${message}`));
}

export function warning(message: string): void {
  console.log(chalk.yellow(`${EMOJIS.WARNING} ${message}`));
}

export function info(message: string): void {
  console.log(chalk.blue(`${EMOJIS.INFO} ${message}`));
}

export function header(title: string, emoji: string = EMOJIS.HELICOPTER): void {
  console.log(chalk.blue(`${emoji} ${title}`));
  console.log('='.repeat(Math.max(40, title.length + 4)));
  console.log('');
}

export function separator(): void {
  console.log('');
}

export function resultHeader(title: string, emoji: string = EMOJIS.ROCKET): void {
  separator();
  console.log('='.repeat(40));
  console.log(chalk.green(`${emoji} ${title}`));
  console.log('='.repeat(40));
  separator();
}

export function section(title: string): void {
  console.log(chalk.blue(title));
}

export function detail(label: string, value: string, indent: string = '  '): void {
  console.log(`${indent}${label}: ${value}`);
}

export function progress(message: string, step?: string): void {
  const prefix = step ? `${step}. ` : '';
  console.log(`${prefix}${message}...`);
}

// For interactive prompts - returns true/false based on user input
export async function confirmDestructive(
  message: string, 
  defaultChoice: boolean = false
): Promise<boolean> {
  const inquirer = await import('inquirer');
  const { confirm } = await inquirer.prompt([{
    type: 'confirm',
    name: 'confirm',
    message: `${EMOJIS.WARNING} ${message}`,
    default: defaultChoice
  }]);
  return confirm;
}

// Multiple choice prompt
export async function selectOption<T extends string>(
  message: string,
  choices: Array<{ name: string; value: T }>,
  defaultValue?: T
): Promise<T> {
  const inquirer = await import('inquirer');
  const { selection } = await inquirer.prompt([{
    type: 'list',
    name: 'selection',
    message,
    choices,
    default: defaultValue
  }]);
  return selection;
}

// For waiting/retry operations
export function waitMessage(message: string, attempt: number, total: number): void {
  console.log(`   ${message} (${attempt}/${total})`);
}

// Error display with context
export function displayError(err: Error, context?: string): void {
  if (context) {
    error(`${context}: ${err.message}`);
  } else {
    error(err.message);
  }
  
  // Show stack trace in development/debug mode
  if (process.env.DEBUG || process.env.NODE_ENV === 'development') {
    console.log(chalk.gray(err.stack));
  }
}