import { mkdirSync } from 'node:fs';
import { test, expect } from '@playwright/test';
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4175/';
const shots = 'artifacts/ui';
test.beforeAll(() => mkdirSync(shots, { recursive: true }));
test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', colorScheme: 'light', reducedMotion: 'reduce' });

async function boot(page) {
  await page.goto(`${base}app/`);
  await expect(page.locator('.app-shell')).toBeVisible();
  const skip = page.locator('.modal-card .button--secondary');
  if (await skip.isVisible()) await skip.click();
  await expect(page.locator('.modal-card')).toBeHidden();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save-status', 'saved');
}
async function move(page, type, qty, note) {
  await page.locator('.mobile-nav button').nth(2).click();
  await page.locator('.operation-types button').filter({ hasText: new RegExp(`^${type}$`) }).click();
  await page.getByLabel('Product').selectOption('product-oil');
  const location = type === 'Issue' ? 'From location' : 'To location';
  await page.getByLabel(location).selectOption('location-a01');
  await page.getByLabel('Quantity', { exact: true }).fill(String(qty));
  await page.getByLabel('Note', { exact: true }).fill(note);
  await page.getByRole('button', { name: 'Save movement', exact: true }).click();
}
const errorsFor = page => { const errors=[]; page.on('pageerror', e=>errors.push(e.message)); return errors; };

test('English phone wrapper, original onboarding, selected SVG flags and light/dark source UI', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const errors = errorsFor(page);
  await page.goto(base);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByText('WMS-Mini · mobile preview', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open standalone' })).toBeVisible();
  const box = await page.locator('iframe').boundingBox();
  expect(box.width).toBe(390); expect(box.height).toBe(844);
  const app = page.frameLocator('iframe');
  await expect(app.locator('.modal-card .eyebrow')).toContainText('1/4');
  await page.screenshot({ path: `${shots}/01-mini-onboarding-phone.png`, fullPage: true });
  await app.locator('.modal-card .button--secondary').click();
  await expect(app.getByRole('heading', {name:'Warehouse overview',exact:true})).toBeVisible();
  await expect(app.getByText('Machine oil 500 ml').first()).toBeVisible();
  await expect(app.locator('.language-switch .language-flag')).toHaveAttribute('data-language-code','en');
  await expect(app.locator('.language-switch svg')).toBeVisible();
  await expect(app.locator('.mobile-nav button')).toHaveCount(6);
  await page.screenshot({ path: `${shots}/02-mini-dashboard-phone-light.png`, fullPage: true });
  await app.locator('.language-switch').click();
  await expect(app.locator('.language-menu__list button svg')).toHaveCount(6);
  await page.screenshot({ path: `${shots}/03-mini-svg-flags-phone.png`, fullPage: true });
  await app.locator('.language-menu__list button').filter({ hasText:'Français' }).click();
  await expect(app.locator('.language-switch .language-flag')).toHaveAttribute('data-language-code','fr');
  await app.locator('.language-switch').click();
  await app.locator('.language-menu__list button').filter({ hasText:'English' }).click();
  await app.locator('.theme-toggle').click();
  await expect(app.locator('html')).toHaveAttribute('data-theme','dark');
  await page.screenshot({ path: `${shots}/04-mini-dashboard-phone-dark.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test('decimal count and split issues persist exactly, with confirmation only after save', async ({ page }) => {
  const errors=errorsFor(page); await boot(page);
  await move(page,'Counted stock','0.3','Fractional count');
  await expect(page.locator('.toast')).toContainText('Movement saved safely.');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save-status','saved');
  await move(page,'Issue','0.1','First fractional issue');
  await expect(page.locator('.toast')).toContainText('Movement saved safely.');
  await move(page,'Issue','0.2','Final fractional issue');
  await expect(page.locator('.toast')).toContainText('Movement saved safely.');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save-status','saved');
  await page.reload();
  await expect(page.getByRole('heading',{name:'Warehouse overview',exact:true})).toBeVisible();
  await page.locator('.mobile-nav button').nth(3).click();
  await expect(page.getByText('Final fractional issue',{exact:false})).toBeVisible();
  await page.screenshot({ path: `${shots}/05-mini-persisted-fractional-history.png`, fullPage:true });
  const quantity = await page.evaluate(() => new Promise((resolve,reject)=>{
    const req=indexedDB.open('aardvarkland-mini-wms',3);req.onerror=()=>reject(req.error);
    req.onsuccess=()=>{const db=req.result;const read=db.transaction('state').objectStore('state').get('warehouse');read.onsuccess=()=>{const state=read.result.state??read.result;resolve(state.balances.find(b=>b.productId==='product-oil'&&b.locationId==='location-a01')?.quantity??0);db.close();};};
  }));
  expect(quantity).toBe(0); expect(errors).toEqual([]);
});

test('failed durable writes show an error, never a saved toast, and can be retried', async ({ page }) => {
  await page.addInitScript(() => {
    const put=IDBObjectStore.prototype.put,set=Storage.prototype.setItem;
    IDBObjectStore.prototype.put=function(...args){if(window.failWrites)throw new DOMException('Test quota','QuotaExceededError');return put.apply(this,args);};
    Storage.prototype.setItem=function(key,value){if(window.failWrites&&key.startsWith('aardvarkland-mini-wms-state'))throw new DOMException('Test quota','QuotaExceededError');return set.call(this,key,value);};
  });
  const errors=errorsFor(page); await boot(page);
  await page.evaluate(()=>{window.failWrites=true;});
  await move(page,'Receipt','1','Retained unsaved receipt');
  await expect(page.getByRole('alert')).toContainText('Changes are NOT saved.');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save-status','error');
  await expect(page.locator('.toast')).toBeHidden();
  await page.screenshot({path:`${shots}/06-mini-storage-failure.png`,fullPage:true});
  await page.evaluate(()=>{window.failWrites=false;});
  await page.getByRole('button',{name:'Retry saving'}).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save-status','saved');
  await page.reload(); await expect(page.locator('.app-shell')).toBeVisible();
  await page.locator('.mobile-nav button').nth(3).click();
  await expect(page.getByText('Retained unsaved receipt',{exact:false})).toBeVisible();
  expect(errors).toEqual([]);
});

test('language storage failures cannot break language or theme switching', async ({page})=>{
  await page.addInitScript(()=>{
    const get=Storage.prototype.getItem,set=Storage.prototype.setItem;
    Storage.prototype.getItem=function(k){if(k==='aardvarkland-mini-language')throw new DOMException('Blocked','SecurityError');return get.call(this,k);};
    Storage.prototype.setItem=function(k,v){if(k==='aardvarkland-mini-language'||k==='aardvarkland-ui-theme')throw new DOMException('Blocked','SecurityError');return set.call(this,k,v);};
  });
  const errors=errorsFor(page);await boot(page);
  await page.locator('.language-switch').click();await page.getByRole('menuitemradio',{name:'Français'}).click();
  await expect(page.locator('html')).toHaveAttribute('lang',/fr/);
  await page.locator('.theme-toggle').click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  expect(errors).toEqual([]);
});

test('second window is read-only and cannot overwrite the first writer',async({page,context})=>{
  await boot(page);const other=await context.newPage();await boot(other);
  await expect(other.locator('.app-shell')).toHaveAttribute('data-read-only','true');
  await expect(other.getByText('Read-only:',{exact:false})).toBeVisible();
  await move(other,'Receipt','7','Must not be saved');
  await expect(other.locator('.toast')).toBeHidden();
  await move(page,'Receipt','2','Authoritative writer');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-save-status','saved');
  await other.close();await page.reload();await expect(page.locator('.app-shell')).toBeVisible();
  await page.locator('.mobile-nav button').nth(3).click();
  await expect(page.getByText('Authoritative writer',{exact:false})).toBeVisible();
  await expect(page.getByText('Must not be saved',{exact:false})).toHaveCount(0);
});

test('corrupt saved data is not replaced with a new empty warehouse',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('aardvarkland-mini-wms-state-v3','{"broken":true}'));
  await page.goto(`${base}app/`);
  await expect(page.getByRole('alert')).toContainText('Nothing was replaced.');
  await expect(page.locator('.app-shell')).toHaveCount(0);
  expect(await page.evaluate(()=>localStorage.getItem('aardvarkland-mini-wms-state-v3'))).toBe('{"broken":true}');
});

test('update notification leaves the active movement draft intact',async({page})=>{
  await boot(page);await page.locator('.mobile-nav button').nth(2).click();
  await page.getByLabel('Note',{exact:true}).fill('Unsubmitted shipment note');
  await page.evaluate(()=>window.dispatchEvent(new Event('wms-mini:update-ready')));
  await expect(page.getByText('An update is ready.',{exact:false})).toBeVisible();
  await expect(page.getByLabel('Note',{exact:true})).toHaveValue('Unsubmitted shipment note');
});

test.describe('installed offline build',()=>{
  test.use({serviceWorkers:'allow'});
  test('offline reload and lazy Excel export work without deleting another app cache',async({page,context})=>{
    await page.goto(`${base}preview.css`);
    await page.evaluate(async()=>{const cache=await caches.open('another-app:keep');await cache.put('/foreign-resource',new Response('foreign'));});
    await boot(page);
    await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
    await expect.poll(()=>page.evaluate(()=>Boolean(navigator.serviceWorker.controller))).toBe(true);
    expect(await page.evaluate(()=>caches.has('another-app:keep'))).toBe(true);
    await context.setOffline(true);await page.reload();
    await expect(page.getByRole('heading',{name:'Warehouse overview',exact:true})).toBeVisible();
    await page.locator('.mobile-nav button').nth(5).click();
    const downloaded=page.waitForEvent('download');
    await page.getByRole('button',{name:/Export Excel/}).click();
    expect((await downloaded).suggestedFilename()).toMatch(/\.xlsx$/);
  });
});
