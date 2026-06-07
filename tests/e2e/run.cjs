const {spawn} = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const port = Number(process.env.E2E_PORT || 4173);
const serverPath = path.join(__dirname, 'server.cjs');
const playwrightBin = path.join(
  repoRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'playwright.cmd' : 'playwright'
);

function waitForServer(timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Timed out waiting for E2E server on port ${port}`));
          return;
        }
        setTimeout(check, 150);
      });
    };
    check();
  });
}

function stopProcess(child) {
  return new Promise((resolve) => {
    if (!child || child.killed) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch (error) {
        // Process may already be gone.
      }
      resolve();
    }, 2000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      child.kill('SIGTERM');
    } catch (error) {
      clearTimeout(timer);
      resolve();
    }
  });
}

async function main() {
  const args = process.argv.slice(2);
  const server = spawn(process.execPath, [serverPath, String(port)], {
    cwd: repoRoot,
    env: {...process.env, E2E_PORT: String(port)},
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  server.stdout.on('data', (chunk) => process.stdout.write(chunk));
  server.stderr.on('data', (chunk) => process.stderr.write(chunk));

  try {
    await waitForServer();
    const testArgs = ['test', ...args];
    const test = spawn(playwrightBin, testArgs, {
      cwd: repoRoot,
      env: {...process.env, E2E_PORT: String(port)},
      shell: process.platform === 'win32',
      stdio: 'inherit',
    });
    const code = await new Promise((resolve) => {
      test.on('exit', (exitCode, signal) => resolve(exitCode || (signal ? 1 : 0)));
    });
    await stopProcess(server);
    process.exit(code);
  } catch (error) {
    await stopProcess(server);
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
  }
}

main();
