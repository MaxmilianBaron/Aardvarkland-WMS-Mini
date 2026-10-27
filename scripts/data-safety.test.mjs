import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ExcelJS from 'exceljs';
import { applyMovement, emptyMiniState, stockAt } from '../src/domain.ts';
import { MAX_QUANTITY, normalizeQuantity, addQuantity } from '../src/quantity.ts';
import { parseCsv, csvCell, IMPORT_LIMITS, validateXlsxArchive } from '../src/importSafety.ts';
import { importProductsFile } from '../src/dataExchange.ts';
function base() { const now=new Date().toISOString();return {...emptyMiniState(),products:[{id:'p',sku:'P',name:'P',barcode:'',unit:'kg',minimumStock:0,categoryId:null,createdAt:now,updatedAt:now}],locations:[{id:'a',code:'A',name:'A',createdAt:now},{id:'b',code:'B',name:'B',createdAt:now}]}; }
test('decimal receipt and complete split issue have exactly zero balance', () => {
  let state=applyMovement(base(),{type:'RECEIPT',productId:'p',toLocationId:'a',quantity:0.3});
  state=applyMovement(state,{type:'ISSUE',productId:'p',fromLocationId:'a',quantity:0.1});
  assert.equal(stockAt(state,'p','a'),0.2);
  state=applyMovement(state,{type:'ISSUE',productId:'p',fromLocationId:'a',quantity:0.2});
  assert.equal(stockAt(state,'p','a'),0);
  assert.equal(state.movements.length,3);
});
test('micro-unit arithmetic rejects overflow and unsupported precision before mutation', () => {
  for(const value of [Infinity,NaN,1e308,MAX_QUANTITY+1,0.0000001]) assert.throws(()=>normalizeQuantity(value),/INVALID_QUANTITY/);
  assert.throws(()=>addQuantity(MAX_QUANTITY,0.000001),/INVALID_QUANTITY/);
  assert.equal(normalizeQuantity(0.19999999999999998),0.2);
  const state=applyMovement(base(),{type:'RECEIPT',productId:'p',toLocationId:'a',quantity:MAX_QUANTITY});const before=structuredClone(state);
  assert.throws(()=>applyMovement(state,{type:'RECEIPT',productId:'p',toLocationId:'a',quantity:1}),/INVALID_QUANTITY/);assert.deepEqual(state,before);
});
test('decimal batch transfers and inventory stay in sync',()=>{
  let state=applyMovement(base(),{type:'RECEIPT',productId:'p',toLocationId:'a',quantity:0.3,lotNumber:'LOT'});
  state=applyMovement(state,{type:'MOVE',productId:'p',fromLocationId:'a',toLocationId:'b',quantity:0.1,batchId:state.batches[0].id});
  assert.equal(state.batches.find(b=>b.locationId==='a').quantity,0.2);
  state=applyMovement(state,{type:'COUNT',productId:'p',toLocationId:'a',quantity:0.4});
  assert.equal(state.batches.find(b=>b.locationId==='a').quantity,0.4);
});
test('CSV detects one delimiter and handles BOM, escaped quotes and embedded newlines',()=>{
  assert.deepEqual(parseCsv('\ufeffSKU;Name\r\nA;"Name, with tab\tand ""quotes""\nand newline"'),[['SKU','Name'],['A','Name, with tab\tand "quotes"\nand newline']]);
  for(const text of ['SKU,Name\nA,"open','SKU,Name\nA,"closed"junk','SKU,Name\nA,b"ad']) assert.throws(()=>parseCsv(text),/MALFORMED_CSV/);
});
test('CSV limits row count, columns, cell length and import size',async()=>{
  assert.throws(()=>parseCsv('SKU,Name\n'+('A,B\n'.repeat(IMPORT_LIMITS.rows+1))),/TOO_MANY_ROWS/);
  assert.throws(()=>parseCsv(Array(34).fill('a').join(',')),/TOO_MANY_COLUMNS/);
  assert.throws(()=>parseCsv('a'.repeat(IMPORT_LIMITS.cell+1)),/CELL_TOO_LONG/);
  await assert.rejects(importProductsFile(base(),new File(['x'.repeat(IMPORT_LIMITS.bytes+1)],'huge.csv')),/IMPORT_TOO_LARGE/);
  await assert.rejects(importProductsFile(base(),new File(['SKU,Name'],'data.txt')),/UNSUPPORTED_IMPORT/);
});
test('human-facing CSV reports neutralize formulas without converting real numbers to text',()=>{
  for(const text of ['=1+1','+1','-1','@SUM(A1)',' \t=1','＝1+1']) assert.equal(csvCell(text).startsWith('"\t'),true);
  assert.equal(csvCell(-2),'"-2"');assert.equal(csvCell('a"b'),'"a""b"');
});
test('XLSX validates expanded bytes and rejects forged sizes before workbook parsing',async()=>{
  const book=new ExcelJS.Workbook();book.addWorksheet('Import').addRow(['SKU','Name']);
  const buffer=await book.xlsx.writeBuffer(); const valid=Uint8Array.from(buffer).buffer;
  await validateXlsxArchive(valid);
  const bad=valid.slice(0); const view=new DataView(bad);
  for(let i=0;i<bad.byteLength-46;i++){if(view.getUint32(i,true)===0x02014b50 && view.getUint32(i+24,true)>0){view.setUint32(i+24,1,true);break;}}
  await assert.rejects(validateXlsxArchive(bad),/XLSX_EXPANSION_LIMIT|INVALID_XLSX/);
});
test('service worker activation removes only old versions of its own scope',async()=>{
  const callbacks=new Map();const deleted=[];const scope='https://example.test/mini/';
  vm.runInNewContext(await readFile(new URL('../public/sw.js',import.meta.url),'utf8'),{
    URL,self:{registration:{scope},clients:{claim:async()=>{}},addEventListener:(event,callback)=>callbacks.set(event,callback)},
    caches:{keys:async()=>['other-app-v1','aardvarkland-mini:/mini/:old','aardvarkland-mini:/different/:old','aardvarkland-mini:/mini/:development'],delete:async key=>deleted.push(key)},
  });
  let done;callbacks.get('activate')({waitUntil:promise=>{done=promise;}});await done;
  assert.deepEqual(deleted,['aardvarkland-mini:/mini/:old']);
  for(const url of ['https://example.test/api/data','https://other.test/mini/assets/app.js','https://example.test/mini/assets/app.js?token=test']) {
    callbacks.get('fetch')({request:{url,method:'GET',headers:new Headers()},respondWith:()=>assert.fail('unsafe request intercepted')});
  }
});
