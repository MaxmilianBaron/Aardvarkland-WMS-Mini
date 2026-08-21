const port = process.env.WMS_MINI_CDP_PORT ?? '9229';
const pages = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
const page = pages.find((candidate) => candidate.type === 'page' && candidate.url.startsWith('https://localhost'));
if (!page) throw new Error('WMS-Mini WebView was not found. Launch the app and configure adb forwarding first.');

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let requestId = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

function command(method, params = {}) {
  const id = ++requestId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression, awaitPromise = true) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const languages = ['cs', 'en', 'ua', 'fr', 'de', 'es'];
const results = [];

for (const language of languages) {
  await evaluate(`localStorage.setItem('aardvarkland-mini-language', ${JSON.stringify(language)}); location.reload()`);
  await wait(900);
  for (let tab = 0; tab < 6; tab += 1) {
    await evaluate(`document.querySelectorAll('.mobile-nav button')[${tab}]?.click()`);
    await wait(180);
    results.push(await evaluate(`(() => {
      const visible = [...document.querySelectorAll('body *')].filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      });
      const viewportOverflow = visible.filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < -1 || rect.right > innerWidth + 1;
      }).map((element) => ({ tag: element.tagName, className: element.className, text: element.textContent?.trim().slice(0, 100), rect: element.getBoundingClientRect().toJSON() }));
      const clippedText = visible.filter((element) => {
        if (!element.textContent?.trim() || element.children.length > 0) return false;
        const style = getComputedStyle(element);
        return element.scrollWidth > element.clientWidth + 1 && !['auto', 'scroll'].includes(style.overflowX);
      }).map((element) => ({ tag: element.tagName, className: element.className, text: element.textContent?.trim().slice(0, 100), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
      return {
        language: ${JSON.stringify(language)}, tab: ${tab}, htmlLang: document.documentElement.lang,
        font: getComputedStyle(document.body).fontFamily,
        viewport: { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth },
        viewportOverflow, clippedText,
        controls: visible.filter((element) => ['BUTTON', 'INPUT', 'SELECT'].includes(element.tagName)).length,
      };
    })()`));
  }
}

const storage = await evaluate(`new Promise((resolve, reject) => {
  const request = indexedDB.open('aardvarkland-mini-wms');
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const database = request.result;
    const transaction = database.transaction('state', 'readonly');
    const read = transaction.objectStore('state').get('warehouse');
    read.onerror = () => reject(read.error);
    read.onsuccess = () => resolve(read.result ? {
      schemaVersion: read.result.schemaVersion,
      products: read.result.products?.length ?? 0,
      locations: read.result.locations?.length ?? 0,
      movements: read.result.movements?.length ?? 0,
      balances: read.result.balances?.length ?? 0,
      updatedAt: read.result.updatedAt,
    } : null);
  };
})`);

const failures = results.filter((result) => result.viewport.documentWidth > result.viewport.width || result.viewportOverflow.length || result.clippedText.length);
console.log(JSON.stringify({ ok: failures.length === 0, page: { title: page.title, url: page.url }, storage, count: results.length, failures, results }, null, 2));
socket.close();
process.exitCode = failures.length ? 1 : 0;
