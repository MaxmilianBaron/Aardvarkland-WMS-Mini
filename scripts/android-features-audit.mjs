const port=process.env.WMS_MINI_CDP_PORT??'9229';
const pages=await fetch(`http://127.0.0.1:${port}/json`).then(r=>r.json());
const page=pages.find(p=>p.type==='page'&&p.url.startsWith('https://localhost'));
if(!page)throw new Error('WMS-Mini WebView not found');
const socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((ok,no)=>{socket.addEventListener('open',ok,{once:true});socket.addEventListener('error',no,{once:true})});let id=0;const pending=new Map();socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(!m.id||!pending.has(m.id))return;const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result)});const command=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});socket.send(JSON.stringify({id:n,method,params}))});async function evaluate(expression){const r=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);return r.result.value}const wait=ms=>new Promise(r=>setTimeout(r,ms));
const read=`new Promise((resolve,reject)=>{const q=indexedDB.open('aardvarkland-mini-wms');q.onerror=()=>reject(q.error);q.onsuccess=()=>{const db=q.result;const r=db.transaction('state','readonly').objectStore('state').get('warehouse');r.onerror=()=>reject(r.error);r.onsuccess=()=>resolve(r.result)}})`;
const original=await evaluate(read);const originalLocal=await evaluate(`Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)]))`);const checks={};const details={};
try{
  await evaluate(`localStorage.removeItem('aardvarkland-mini-lock-v1');localStorage.setItem('aardvarkland-mini-language','cs');location.reload()`);await wait(900);
  await evaluate(`(()=>{const b=[...document.querySelectorAll('.mobile-nav button')].find(x=>x.textContent.trim()==='Data');b.click()})()`);await wait(250);
  checks.onboarding=await evaluate(`(()=>{const state=${JSON.stringify({...original,onboardingCompleted:false})};const input=[...document.querySelectorAll('input[type=file]')].find(i=>i.accept.includes('application/json'));const dt=new DataTransfer();dt.items.add(new File([JSON.stringify(state)],'onboarding.json',{type:'application/json'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);await wait(700);await evaluate(`location.reload()`);await wait(900);
  checks.onboardingVisible=await evaluate(`document.body.innerText.includes('První spuštění')&&document.body.innerText.includes('Pojmenujte sklad')`);
  details.onboardingText=await evaluate(`document.body.innerText.slice(0,500)`);
  details.onboardingState=await evaluate(`document.body.innerText.includes('První spuštění')`);
  details.storedOnboarding=await evaluate(`(${read}).then(s=>s.onboardingCompleted)`);
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Přeskočit průvodce'))?.click()`);await wait(700);
  await evaluate(`(()=>{const b=[...document.querySelectorAll('.mobile-nav button')].find(x=>x.textContent.trim()==='Data');if(!b)throw new Error('Data tab missing');b.click()})()`);await wait(250);
  checks.dataActions=await evaluate(`['Export Excel','Import CSV / Excel','Stáhnout šablonu','Zapnout upozornění','Nastavit PIN'].every(x=>document.body.innerText.includes(x))`);
  await evaluate(`(()=>{const input=[...document.querySelectorAll('input[type=file]')].find(i=>i.accept.includes('.csv'));const csv='SKU,Name,Barcode,Unit,Minimum stock,Category,Location,Quantity,Batch,Expiry date\\nAUDIT-NEW,Audit produkt,998877,ks,20,Audit kategorie,AUDIT-01,8,AUDIT-LOT,2027-12-31';const dt=new DataTransfer();dt.items.add(new File([csv],'audit.csv',{type:'text/csv'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`);await wait(700);
  const imported=await evaluate(read);const product=imported.products.find(p=>p.sku==='AUDIT-NEW');const category=imported.categories.find(c=>c.id===product?.categoryId);const location=imported.locations.find(l=>l.code==='AUDIT-01');const batch=imported.batches.find(b=>b.productId===product?.id);
  checks.csvImport=Boolean(product&&category?.name==='Audit kategorie'&&location&&batch?.lotNumber==='AUDIT-LOT'&&batch?.expiryDate==='2027-12-31'&&batch?.quantity===8);
  checks.importMovement=imported.movements.some(m=>m.productId===product?.id&&m.type==='RECEIPT'&&m.lotNumber==='AUDIT-LOT');
  await evaluate(`(()=>{const b=[...document.querySelectorAll('.mobile-nav button')].find(x=>x.textContent.includes('Reporty'));if(!b)throw new Error('Reports tab missing');b.click()})()`);await wait(250);
  checks.reports=await evaluate(`['Reporty skladu','Export CSV','Export PDF','Pohyby v období','Aktuální stav','Produkty pod minimem','Expiruje do 30 dnů'].every(x=>document.body.innerText.includes(x))`);
  await evaluate(`(()=>{const b=[...document.querySelectorAll('.mobile-nav button')].find(x=>x.textContent.trim()==='Data');if(!b)throw new Error('Data tab missing');b.click()})()`);await wait(250);
  await evaluate(`document.querySelector('input[type=password]').focus()`);await command('Input.insertText',{text:'2468'});await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Nastavit PIN')?.click()`);await wait(700);
  checks.pinStoredHashed=await evaluate(`(()=>{const v=localStorage.getItem('aardvarkland-mini-lock-v1');return !!v&&!v.includes('2468')&&JSON.parse(v).salt.length===32&&JSON.parse(v).hash.length===64})()`);
  await evaluate(`document.dispatchEvent(new Event('visibilitychange'))`);await evaluate(`location.reload()`);await wait(700);
  checks.lockVisible=await evaluate(`document.body.innerText.includes('Aplikace je zamčená')`);
  if(checks.lockVisible){await evaluate(`document.querySelector('input[type=password]').focus()`);await command('Input.insertText',{text:'2468'});await evaluate(`document.querySelector('form button[type=submit]').click()`);await wait(800);}
  checks.unlock=checks.lockVisible&&await evaluate(`!document.body.innerText.includes('Aplikace je zamčená')`);
}finally{
  await evaluate(`(async()=>{await new Promise((ok,no)=>{const q=indexedDB.open('aardvarkland-mini-wms');q.onsuccess=()=>{const tx=q.result.transaction('state','readwrite');tx.objectStore('state').put(${JSON.stringify(original)},'warehouse');tx.oncomplete=ok;tx.onerror=()=>no(tx.error)}});localStorage.clear();for(const [k,v] of Object.entries(${JSON.stringify(originalLocal)}))localStorage.setItem(k,v);return true})()`);
}
checks.restored=JSON.stringify(await evaluate(read))===JSON.stringify(original);checks.ok=Object.values(checks).every(Boolean);console.log(JSON.stringify({checks,details},null,2));socket.close();process.exitCode=checks.ok?0:1;
