// Démarrage robuste (local, Docker, Render, Pterodactyl) :
// construit l'interface si dist/ est absent, puis lance le serveur (site + API + PeerJS).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexHtml = path.join(root, 'dist', 'index.html');

if (!fs.existsSync(indexHtml)) {
  console.log('[box] dist/ introuvable : construction de l’interface (npm run build)…');
  const build = spawnSync('npm', ['run', 'build'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (build.status !== 0 || !fs.existsSync(indexHtml)) {
    console.error(
      '[box] Échec de la construction : le serveur API démarrera, mais sans interface. ' +
        'Lance « npm run build » pour diagnostiquer.',
    );
  } else {
    console.log('[box] Interface construite avec succès.');
  }
}

await import('../server.js');
