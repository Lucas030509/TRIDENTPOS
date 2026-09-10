import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import electronModule from 'electron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');
const testScript = path.join(packageRoot, 'dist', 'electron.test.js');

// Resolve actual electron binary
const electronBinary = typeof electronModule === 'string' ? electronModule : electronModule.default;

if (!electronBinary) {
  console.error('ERROR: Could not resolve Electron binary path.');
  process.exit(1);
}

let command = electronBinary;
let args = [testScript];

// On Linux, verify SUID sandbox configuration or provide OS process-level fallback
if (process.platform === 'linux') {
  const chromeSandbox = path.join(path.dirname(electronBinary), 'chrome-sandbox');
  let hasValidSuid = false;
  try {
    const stat = fs.statSync(chromeSandbox);
    // mode 4755: SUID bit (0o4000) and owned by root (uid 0)
    hasValidSuid = stat.uid === 0 && (stat.mode & 0o4000) !== 0;
  } catch {
    hasValidSuid = false;
  }

  if (!hasValidSuid) {
    console.log('[LINUX SANDBOX NOTICE]: Root SUID chrome-sandbox not configured; adding --no-sandbox for OS process.');
    args.unshift('--no-sandbox');
  }
}

// On Linux CI/headless environments without DISPLAY, wrap execution with xvfb-run
if (process.platform === 'linux' && !process.env.DISPLAY) {
  console.log('[HEADLESS LINUX DETECTED]: Wrapping Electron execution with xvfb-run...');
  command = 'xvfb-run';
  args = ['--auto-servernum', '--server-args=-screen 0 1024x768x24', electronBinary, ...args];
}

console.log(`[EXECUTING ACTUAL ELECTRON BINARY]: ${command} ${args.join(' ')}`);

const child = spawn(command, args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    // Ensure Node options don't tamper with Electron runtime
    ELECTRON_ENABLE_LOGGING: '1',
  },
});

child.on('error', (err) => {
  console.error('FATAL: Failed to spawn Electron test process:', err);
  process.exit(1);
});

child.on('close', (code) => {
  if (code !== 0) {
    console.error(`ERROR: Electron integration test suite failed with exit code ${code}`);
    process.exit(code ?? 1);
  }
  process.exit(0);
});
