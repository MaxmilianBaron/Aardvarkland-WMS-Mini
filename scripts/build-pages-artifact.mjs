import { cp, lstat, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const site = join(root, '_site');
const runtimeEntries = ['.nojekyll', 'index.html', 'preview.css', 'preview', 'app'];

const forbiddenSegments = new Set([
  '.git', '.github', 'node_modules', 'e2e', 'scripts', 'docs',
  'artifacts', 'test-results', 'coverage', 'reports',
]);
const forbiddenExtensions = new Set([
  '.map', '.md', '.ts', '.tsx', '.yml', '.yaml', '.ps1', '.bat', '.cmd',
  '.sh', '.zip', '.tar', '.gz', '.apk', '.aab', '.db', '.sqlite', '.sqlite3',
  '.log', '.pem', '.key', '.p12', '.pfx', '.jks', '.keystore',
]);
const textExtensions = new Set([
  '.html', '.css', '.js', '.mjs', '.json', '.webmanifest', '.svg', '.txt', '.xml',
]);
const forbiddenContent = [
  ['private repository name', /Aardvarkland-WMS-Private/i],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i],
  ['GitHub token', /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['service API key', /\b(?:sk|rk)-[A-Za-z0-9_-]{20,}\b/],
  ['credentialed database URL', /\bpostgres(?:ql)?:\/\/[^\s"'`:/]+:[^\s"'`@]+@/i],
];

const maxFiles = 2000;
const maxTotalBytes = 100 * 1024 * 1024;

await rm(site, { recursive: true, force: true });
await mkdir(site, { recursive: true });

for (const entry of runtimeEntries) {
  const source = resolve(root, entry);
  assertInside(root, source, entry);
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw new Error(`Runtime entry must not be a symbolic link: ${entry}`);
  await cp(source, join(site, entry), { recursive: true, force: true });
}

const topLevel = (await readdir(site)).sort();
const expectedTopLevel = [...runtimeEntries].sort();
if (JSON.stringify(topLevel) !== JSON.stringify(expectedTopLevel)) {
  throw new Error(`Unexpected Pages top-level entries: ${topLevel.join(', ')}`);
}

let fileCount = 0;
let totalBytes = 0;
for await (const file of walk(site)) {
  const relativePath = relative(site, file).split(sep).join('/');
  const segments = relativePath.split('/');
  if (segments.some((segment) => forbiddenSegments.has(segment))) {
    throw new Error(`Forbidden Pages path: ${relativePath}`);
  }

  const extension = extname(relativePath).toLowerCase();
  if (forbiddenExtensions.has(extension)) {
    throw new Error(`Forbidden Pages file type: ${relativePath}`);
  }

  const info = await lstat(file);
  if (info.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in Pages: ${relativePath}`);
  fileCount += 1;
  totalBytes += info.size;
  if (fileCount > maxFiles) throw new Error(`Pages artifact exceeds ${maxFiles} files.`);
  if (totalBytes > maxTotalBytes) throw new Error(`Pages artifact exceeds ${maxTotalBytes} bytes.`);

  if (textExtensions.has(extension)) {
    const text = await readFile(file, 'utf8');
    for (const [label, pattern] of forbiddenContent) {
      if (pattern.test(text)) throw new Error(`${label} found in Pages artifact: ${relativePath}`);
    }
  }
}

if (!fileCount) throw new Error('Pages artifact is empty.');
console.log(`Verified Pages artifact: ${fileCount} files, ${totalBytes} bytes.`);

async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in Pages: ${relative(site, path)}`);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
    else throw new Error(`Unsupported Pages entry: ${relative(site, path)}`);
  }
}

function assertInside(base, candidate, label) {
  const rel = relative(base, candidate);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error(`Runtime entry escapes repository root: ${label}`);
  }
}
