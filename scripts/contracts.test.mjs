import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('Mini WMS offers every supported language', async () => {
  const [types, translations] = await Promise.all([
    read('src/types.ts'),
    read('src/i18n.ts'),
  ])

  for (const language of ['cs', 'en', 'ua', 'fr', 'de', 'es']) {
    assert.match(types, new RegExp(`\\b${language}\\b`))
    assert.match(translations, new RegExp(`\\b${language}:`))
  }
})

test('Mini shell shares the Server identity and workspace toggles', async () => {
  const [app, styles] = await Promise.all([
    read('src/App.tsx'),
    read('src/styles.css'),
  ])

  assert.match(app, /icons\/icon-512\.png/)
  assert.match(app, /className="language-switch"/)
  assert.match(app, /className="theme-toggle"/)
  assert.match(app, /aardvarkland-ui-theme/)
  assert.match(styles, /grid-template-areas:\s*[\r\n\s]*"sidebar topbar"/)
  assert.match(styles, /--brand-orange: #f36b21/)
  assert.match(styles, /\.theme-toggle svg/)
  assert.match(app, /className="dashboard-hero"/)
  assert.match(app, /className="operation-types"/)
  assert.match(styles, /\.mobile-nav button\.is-primary/)
})

test('Mini WMS stores operational data locally and supports backups', async () => {
  const storage = await read('src/storage.ts')
  const app = await read('src/App.tsx')

  assert.match(storage, /indexedDB\.open/)
  assert.match(storage, /localStorage/)
  assert.match(app, /JSON\.stringify/)
  assert.match(app, /parseMiniBackup/)
  assert.match(storage, /DATABASE_VERSION = 3/)
  assert.match(storage, /\[1, 2, 3\]/)
  assert.doesNotMatch(storage, /slice\(0,\s*5_000\)/)
})

test('production service worker precaches the generated JavaScript and CSS shell', async () => {
  const worker = await read('public/sw.js')

  assert.match(worker, /cacheAppShell/)
  assert.match(worker, /html\.matchAll/)
  assert.match(worker, /cache\.add\(asset\)/)
  assert.match(worker, /SKIP_WAITING/)
})

test('PWA manifest has installable PNG and maskable assets', async () => {
  const manifest = JSON.parse(await read('public/manifest.webmanifest'))
  assert.equal(manifest.name, 'Aardvarkland WMS-Mini')
  assert.equal(manifest.short_name, 'WMS-Mini')
  assert.equal(manifest.start_url, './')
  assert.equal(manifest.scope, './')
  assert.ok(manifest.icons.some((icon) => icon.src.endsWith('icon-192.png') && icon.sizes === '192x192'))
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'))
  assert.equal(manifest.screenshots.length, 2)
})

test('Mini protects master data referenced by movement history', async () => {
  const domain = await read('src/domain.ts')
  assert.match(domain, /PRODUCT_IN_USE/)
  assert.match(domain, /LOCATION_IN_USE/)
  assert.match(domain, /function updateProduct/)
  assert.match(domain, /function updateLocation/)
})

test('Android package is configured for Capacitor and API 36', async () => {
  const config = await read('capacitor.config.ts')
  const variables = await read('android/variables.gradle')
  const manifest = await read('android/app/src/main/AndroidManifest.xml')
  assert.match(config, /cz\.aardvarkland\.wmsmini/)
  assert.match(config, /Aardvarkland WMS-Mini/)
  assert.match(await read('android/app/src/main/res/values/strings.xml'), /<string name="app_name">WMS-Mini<\/string>/)
  assert.match(variables, /minSdkVersion = 24/)
  assert.match(variables, /compileSdkVersion = 36/)
  assert.match(variables, /targetSdkVersion = 36/)
  assert.match(manifest, /android\.permission\.CAMERA/)
})

test('Mini WMS does not depend on the original backend API', async () => {
  const files = await Promise.all([
    read('src/App.tsx'),
    read('src/domain.ts'),
    read('src/storage.ts'),
  ])

  for (const source of files) {
    assert.doesNotMatch(source, /localhost:4001|\/api\//)
    assert.doesNotMatch(source, /\bfetch\s*\(/)
  }
})

test('stock rules prevent invalid or negative movements', async () => {
  const domain = await read('src/domain.ts')

  assert.match(domain, /quantity <= 0/)
  assert.match(domain, /available < quantity/)
  assert.match(domain, /INSUFFICIENT_STOCK/)
  assert.match(domain, /input\.type === 'COUNT'/)
})
