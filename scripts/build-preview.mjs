import { spawnSync } from 'node:child_process';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';

const check = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'], { stdio: 'inherit' });
if (check.status !== 0) process.exit(check.status ?? 1);
await rm('dist', { recursive: true, force: true });
const build = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--mode', 'public-preview', '--outDir', 'dist/app'], { stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);
await mkdir('dist', { recursive: true });
for (const file of ['index.html', 'preview.css', 'preview.js']) await cp(`preview/${file}`, `dist/${file}`);
await writeFile('dist/.nojekyll', '');
