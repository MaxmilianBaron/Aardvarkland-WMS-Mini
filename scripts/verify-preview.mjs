import { readdir, lstat, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
const allowed = new Set(['.html','.css','.js','.webmanifest','.png','.svg','.woff','.woff2','.ico']);
let bytes=0, files=0;
async function walk(directory) {
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    const path=join(directory,entry.name);
    if(entry.isSymbolicLink())throw new Error(`Symbolic link in preview: ${path}`);
    if(entry.isDirectory()){if(!/^(app|assets|fonts|icons)$/.test(entry.name))throw new Error(`Unexpected preview directory: ${path}`);await walk(path);continue;}
    if(!entry.isFile())throw new Error(`Unsupported preview entry: ${path}`);
    if(!allowed.has(extname(path)) && entry.name!=='.nojekyll' && entry.name!=='OFL.txt')throw new Error(`Unexpected preview file: ${path}`);
    files++;bytes+=(await lstat(path)).size;
    if(files>300||bytes>30*1024*1024)throw new Error('Preview exceeds its size budget');
    if(/\.(html|js|css|svg|webmanifest)$/.test(path)){
      const text=await readFile(path,'utf8');
      if(/sourceMappingURL=|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgithub_pat_[A-Za-z0-9_]{20,}/.test(text))throw new Error(`Forbidden content in ${path}`);
    }
  }
}
await walk('dist');
for(const required of ['index.html','preview.css','preview.js','app/index.html','app/sw.js','app/manifest.webmanifest'])await lstat(join('dist',required));
const index=await readFile('dist/index.html','utf8');
if(!index.includes('WMS-Mini · mobile preview')||!index.includes('Open standalone')||!index.includes('lang="en"'))throw new Error('English wrapper contract failed');
console.log(`Verified preview: ${files} runtime files, ${bytes} bytes.`);
