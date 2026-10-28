import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function offlineAssets() {
  let outDir = 'dist';
  return {
    name: 'offline-assets',
    configResolved(config: { build: { outDir: string } }) { outDir = config.build.outDir; },
    async closeBundle() {
      const files = (await readdir(outDir, { recursive: true })).filter(file => /\.(html|js|css|woff2?|png|svg|webmanifest)$/.test(file) && file !== 'sw.js').sort();
      const digest = createHash('sha256');
      for (const file of files) digest.update(file).update(await readFile(join(outDir, file)));
      const workerPath = join(outDir, 'sw.js');
      const worker = await readFile(workerPath, 'utf8');
      digest.update(worker);
      await writeFile(workerPath, worker.replace("const BUILD_VERSION = 'development';", `const BUILD_VERSION = '${digest.digest('hex').slice(0, 20)}';`)
        .replace('const BUILD_ASSETS = [];', `const BUILD_ASSETS = ${JSON.stringify(files.map(file => './' + file.replaceAll('\\', '/')))};`));
    },
  };
}
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), offlineAssets(), {
    name: 'preview-language',
    transformIndexHtml(html: string) {
      return mode === 'public-preview' ? html.replace('<html lang="cs">', '<html lang="en">')
        .replace('offline skladová aplikace pro malé provozy.', 'offline warehouse management for small operations.') : html;
    },
  }],
  server: { host: '0.0.0.0', port: 4010, strictPort: true },
  preview: { host: '0.0.0.0', port: 4010, strictPort: true },
}));
