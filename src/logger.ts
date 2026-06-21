/** Minimal leveled console logger with no external deps. */

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
} as const;

function paint(color: keyof typeof COLORS, text: string): string {
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

export const logger = {
  info(msg: string): void {
    console.log(`${paint('cyan', '[info]')} ${msg}`);
  },
  success(msg: string): void {
    console.log(`${paint('green', '[ ok ]')} ${msg}`);
  },
  warn(msg: string): void {
    console.warn(`${paint('yellow', '[warn]')} ${msg}`);
  },
  error(msg: string): void {
    console.error(`${paint('red', '[fail]')} ${msg}`);
  },
  skip(msg: string): void {
    console.log(`${paint('dim', '[skip]')} ${paint('dim', msg)}`);
  },
  dryRun(msg: string): void {
    console.log(`${paint('yellow', '[dry ]')} ${msg}`);
  },
};
