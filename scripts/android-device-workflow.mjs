const port = process.env.WMS_MINI_CDP_PORT ?? '9229';
const page = (await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json()))
  .find((candidate) => candidate.type === 'page' && candidate.url.startsWith('https://localhost'));
if (!page) throw new Error('WMS-Mini WebView was not found.');
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let id = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const request = pending.get(message.id); pending.delete(message.id);
  message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
});
const command = (method, params = {}) => new Promise((resolve, reject) => { const requestId = ++id; pending.set(requestId, { resolve, reject }); socket.send(JSON.stringify({ id: requestId, method, params })); });
const evaluate = async (expression) => { const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result.value; };
const wait = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));
const run = async (expression, ms = 250) => { const value = await evaluate(expression); await wait(ms); return value; };

const inputHelper = `const setValue = (element, value) => { const setter = Object.getOwnPropertyDescriptor(element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set; setter.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); };`;
await run(`localStorage.setItem('aardvarkland-mini-language', 'cs')`, 50);
await command('Page.reload');
await wait(800);
await run(`document.querySelectorAll('.mobile-nav button')[1].click()`);

let state = await evaluate(`new Promise((resolve, reject) => { const open=indexedDB.open('aardvarkland-mini-wms'); open.onsuccess=()=>{const db=open.result;const get=db.transaction('state').objectStore('state').get('warehouse');get.onsuccess=()=>resolve(get.result);get.onerror=()=>reject(get.error)};open.onerror=()=>reject(open.error) })`);
if (!state.locations.some((location) => location.code === 'QA-A01')) {
  await run(`(() => { ${inputHelper} const form=document.querySelectorAll('.forms-row form')[1]; const inputs=form.querySelectorAll('input'); setValue(inputs[0], 'QA-A01'); setValue(inputs[1], 'QA mobilní lokace'); form.requestSubmit(); return true; })()`, 600);
}

await run(`document.querySelectorAll('.mobile-nav button')[2].click()`);
const executeMovement = async (typeIndex, quantity) => run(`(() => { ${inputHelper} const types=document.querySelectorAll('.operation-types button'); types[${typeIndex}].click(); const form=document.querySelector('.operation-form'); const product=form.querySelector('select'); setValue(product, product.options[1].value); const location=form.querySelectorAll('select')[1]; setValue(location, location.options[1].value); const quantityInput=form.querySelector('input[type=number]'); setValue(quantityInput, ${JSON.stringify(String(quantity))}); form.requestSubmit(); return true; })()`, 600);

state = await evaluate(`new Promise((resolve, reject) => { const open=indexedDB.open('aardvarkland-mini-wms'); open.onsuccess=()=>{const get=open.result.transaction('state').objectStore('state').get('warehouse');get.onsuccess=()=>resolve(get.result);get.onerror=()=>reject(get.error)};open.onerror=()=>reject(open.error) })`);
const baselineMovements = state.movements.length;
await executeMovement(0, 10);
await executeMovement(1, 3);
await executeMovement(3, 12);

const beforeRejected = await evaluate(`new Promise((resolve, reject) => { const open=indexedDB.open('aardvarkland-mini-wms'); open.onsuccess=()=>{const get=open.result.transaction('state').objectStore('state').get('warehouse');get.onsuccess=()=>resolve(get.result.movements.length);get.onerror=()=>reject(get.error)} })`);
await executeMovement(1, 99);
const rejection = await evaluate(`({ toast: document.querySelector('[role=status]')?.textContent ?? '', movements: null })`);

await run(`(() => { ${inputHelper} const scan=document.querySelector('.scan-input input'); setValue(scan, '8590000000802'); scan.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`, 500);
const scanSelected = await evaluate(`document.querySelector('.selected-product')?.textContent ?? ''`);
await command('Page.reload');
await wait(800);
const finalState = await evaluate(`new Promise((resolve, reject) => { const open=indexedDB.open('aardvarkland-mini-wms'); open.onsuccess=()=>{const get=open.result.transaction('state').objectStore('state').get('warehouse');get.onsuccess=()=>resolve(get.result);get.onerror=()=>reject(get.error)};open.onerror=()=>reject(open.error) })`);
const location = finalState.locations.find((item) => item.code === 'QA-A01');
const product = finalState.products.find((item) => item.sku === 'QA-SKU-0802');
const balance = finalState.balances.find((item) => item.locationId === location?.id && item.productId === product?.id)?.quantity;
const afterRejected = finalState.movements.length;
const report = {
  locationCreated: Boolean(location), receiptIssueCountPersisted: afterRejected === baselineMovements + 3,
  finalBalance: balance, negativeIssueBlocked: afterRejected === beforeRejected,
  rejectionMessage: rejection.toast, keyboardWedgeSelected: scanSelected.includes('QA_Product'),
  schemaVersion: finalState.schemaVersion, products: finalState.products.length, locations: finalState.locations.length,
  movements: finalState.movements.length, balances: finalState.balances.length,
};
report.ok = report.locationCreated && report.receiptIssueCountPersisted && report.finalBalance === 12 && report.negativeIssueBlocked && report.keyboardWedgeSelected && report.schemaVersion === 3;
console.log(JSON.stringify(report, null, 2));
socket.close();
process.exitCode = report.ok ? 0 : 1;
