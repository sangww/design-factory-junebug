const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: npm run generate-cert [-- --force]');
    console.log('Requires mkcert. Creates certificates for localhost and current LAN IPv4 addresses.');
    console.log('--force replaces existing server certificates (restart the server afterward).');
    return;
  }
  if (args.some((arg) => arg !== '--force')) {
    throw new Error('Unknown option. Use npm run generate-cert -- --help');
  }
  const certPath = path.join(__dirname, 'server-cert.pem');
  const keyPath = path.join(__dirname, 'server-key.pem');
  if (!args.includes('--force') && (fs.existsSync(certPath) || fs.existsSync(keyPath))) {
    throw new Error('Certificate files already exist. To replace them, run npm run generate-cert -- --force');
  }
  const available = spawnSync('mkcert', ['-version'], { encoding: 'utf8', windowsHide: true });
  if (available.error || available.status !== 0) {
    throw new Error('Cannot run mkcert. Install it and make sure it is on PATH:\n'
      + '  macOS (Homebrew): brew install mkcert\n'
      + '  Windows (Chocolatey): choco install mkcert\n'
      + '  Other options: https://github.com/FiloSottile/mkcert#installation\n'
      + (available.error ? available.error.message : available.stderr || 'mkcert failed'));
  }
  const hosts = [...new Set(['localhost', '127.0.0.1', '::1',
    ...Object.values(os.networkInterfaces()).flat()
      .filter((address) => address && address.family === 'IPv4' && !address.internal)
      .map((address) => address.address)
  ])];
  function run(args) {
    const result = spawnSync('mkcert', args, { stdio: 'inherit', windowsHide: true });
    if (result.error || result.status !== 0) {
      throw new Error(result.error ? result.error.message : 'mkcert failed; check the output above.');
    }
  }
  console.log('Installing the local development CA into this computer\'s trust store.');
  console.log('Your operating system may request administrator permission.');
  run(['-install']);
  run(['-cert-file', certPath, '-key-file', keyPath, ...hosts]);
  console.log('\nCreated server-cert.pem and server-key.pem for: ' + hosts.join(', '));
  console.log('Restart with npm start. HTTPS uses port 3001 unless HTTPS_PORT is configured.');
  console.log('For LAN access, set HOST=0.0.0.0 in .env.');
  console.log('Other computers must trust this host\'s CA: run mkcert -CAROOT to locate rootCA.pem.');
  console.log('Install only that public rootCA.pem in their trusted root certificate store.');
  console.log('Never share server-key.pem or rootCA-key.pem.');
  console.log('If your LAN IP changes, rerun with --force and restart the server.');
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
