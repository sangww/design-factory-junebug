const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '.env.tunnel') });

if (!process.env.TUNNEL_TOKEN || !process.env.TUNNEL_TOKEN.trim()) {
  console.error('Set TUNNEL_TOKEN in .env.tunnel (Git-ignored), then run npm run tunnel again.');
  process.exitCode = 1;
} else {
  const executable = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  const localExecutable = path.join(__dirname, executable);
  const command = process.env.CLOUDFLARED_PATH || (fs.existsSync(localExecutable) ? localExecutable : executable);
  // cloudflared reads TUNNEL_TOKEN from its environment; keep it out of CLI arguments.
  const child = spawn(command, ['tunnel', 'run'], {
    stdio: 'inherit',
    windowsHide: true,
    env: process.env
  });
  child.on('error', (error) => {
    console.error(error.code === 'ENOENT'
      ? 'cloudflared was not found. Install it on PATH, place it in the project folder, or set CLOUDFLARED_PATH in .env.tunnel.tunnel.'
      : `Could not start cloudflared (${error.code || 'unknown error'}).`);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    process.exitCode = code === null ? (signal === 'SIGINT' ? 130 : 1) : code;
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
  }
}
