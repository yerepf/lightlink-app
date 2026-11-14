import { loadEnv } from 'vite';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const backend = fileURLToPath(new URL('../backend/', import.meta.url));
const localBackend = process.argv.includes('--local-backend');
const viteArgs = process.argv.slice(2).filter(arg => arg !== '--local-backend');
const env = loadEnv('development', root, '');
process.env.BACKEND_URL = localBackend ? 'http://127.0.0.1:3000' : (process.env.BACKEND_URL || env.BACKEND_URL || 'https://backend.lightlink.club');
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
function launch(args, cwd) {
  const child = spawn(process.execPath, args, { cwd, stdio: 'inherit', windowsHide: true });
  children.push(child);
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code ?? 1); });
}
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());

if (localBackend) {
  if (!existsSync(new URL('../backend/node_modules/fastify/package.json', import.meta.url))) {
    console.error('Falta instalar el backend. Ejecuta npm run setup:backend.'); process.exit(1);
  }
  let healthy = false;
  try {
    const response = await fetch('http://127.0.0.1:3000/health', { signal: AbortSignal.timeout(1500) });
    healthy = response.ok && (await response.json()).status === 'ok';
  } catch {}
  if (!healthy) {
    launch(['--import', 'tsx', 'src/server.ts'], backend);
    for (let i = 0; i < 40 && !stopping; i++) {
      await new Promise(resolve => setTimeout(resolve, 250));
      try {
        const response = await fetch('http://127.0.0.1:3000/health', { signal: AbortSignal.timeout(500) });
        if (response.ok && (await response.json()).status === 'ok') { healthy = true; break; }
      } catch {}
    }
    if (!healthy) { console.error('No se pudo iniciar el backend en 127.0.0.1:3000.'); stop(1); }
  } else console.log('Usando backend disponible en http://127.0.0.1:3000');
}
if (!stopping) {
  console.log(`Backend: ${process.env.BACKEND_URL} (proxy /api)`);
  launch(['node_modules/vite/bin/vite.js', ...viteArgs], root);
}
