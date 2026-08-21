import assert from 'node:assert/strict';
import test from 'node:test';
import { applyMovement, emptyMiniState } from '../src/domain.ts';
import { importProductsFile, reportRows } from '../src/dataExchange.ts';
import ExcelJS from 'exceljs';
import { disablePin, readLock, setPin, verifyPin } from '../src/security.ts';
import { copyFor } from '../src/i18n.ts';

function base(){const now=new Date().toISOString();return {...emptyMiniState(),onboardingCompleted:true,products:[{id:'p1',sku:'SKU-1',name:'Milk',barcode:'123',unit:'ks',minimumStock:3,categoryId:null,createdAt:now,updatedAt:now}],locations:[{id:'l1',code:'A01',name:'A01',createdAt:now},{id:'l2',code:'B01',name:'B01',createdAt:now}]};}

test('batch receipt, transfer and issue retain lot and expiry traceability',()=>{let state=applyMovement(base(),{type:'RECEIPT',productId:'p1',toLocationId:'l1',quantity:10,lotNumber:'LOT-24',expiryDate:'2027-01-31'});assert.equal(state.batches[0].quantity,10);const batch=state.batches[0];state=applyMovement(state,{type:'MOVE',productId:'p1',fromLocationId:'l1',toLocationId:'l2',quantity:4,batchId:batch.id});assert.equal(state.batches.find(b=>b.locationId==='l1').quantity,6);const target=state.batches.find(b=>b.locationId==='l2');assert.equal(target.quantity,4);state=applyMovement(state,{type:'ISSUE',productId:'p1',fromLocationId:'l2',quantity:2,batchId:target.id});assert.equal(state.batches.find(b=>b.id===target.id).quantity,2);assert.equal(state.movements[0].lotNumber,'LOT-24');});

test('batch-controlled stock cannot be issued without selecting its batch',()=>{const state=applyMovement(base(),{type:'RECEIPT',productId:'p1',toLocationId:'l1',quantity:2,lotNumber:'L1'});assert.throws(()=>applyMovement(state,{type:'ISSUE',productId:'p1',fromLocationId:'l1',quantity:1}),/BATCH_REQUIRED/);});

test('CSV import validates rows before applying and creates categories, locations and opening movement',async()=>{const file=new File(['SKU,Name,Barcode,Unit,Minimum stock,Category,Location,Quantity,Batch,Expiry date\nNEW-1,Filter,999,ks,2,Service,C01,5,B-1,2027-02-01'],'products.csv',{type:'text/csv'});const state=await importProductsFile(emptyMiniState(),file);assert.equal(state.products.length,1);assert.equal(state.categories[0].name,'Service');assert.equal(state.locations[0].code,'C01');assert.equal(state.batches[0].quantity,5);assert.equal(state.movements.length,1);});

test('CSV import is atomic when any row is invalid',async()=>{const original=base();const file=new File(['SKU,Name\nOK,Good\nOK,Duplicate'],'bad.csv',{type:'text/csv'});await assert.rejects(importProductsFile(original,file),/INVALID_ROW/);assert.equal(original.products.length,1);assert.equal(original.movements.length,0);});

test('CSV import rejects a barcode already owned by another product',async()=>{const original=base();const file=new File(['SKU,Name,Barcode\nNEW-2,Other,123'],'duplicate-barcode.csv',{type:'text/csv'});await assert.rejects(importProductsFile(original,file),/INVALID_ROW_2/);assert.equal(original.products.length,1);assert.equal(original.products[0].barcode,'123');});

test('CSV import rejects duplicate barcodes between new rows atomically',async()=>{const original=base();const file=new File(['SKU,Name,Barcode\nNEW-A,Alpha,999\nNEW-B,Beta,999'],'duplicate-new-barcode.csv',{type:'text/csv'});await assert.rejects(importProductsFile(original,file),/INVALID_ROW_3/);assert.equal(original.products.length,1);});

test('CSV import allows two existing products to swap unique barcodes atomically',async()=>{const original=base();const now=new Date().toISOString();original.products.push({id:'p2',sku:'SKU-2',name:'Bread',barcode:'456',unit:'ks',minimumStock:0,categoryId:null,createdAt:now,updatedAt:now});const file=new File(['SKU,Name,Barcode\nSKU-1,Milk,456\nSKU-2,Bread,123'],'swap-barcodes.csv',{type:'text/csv'});const state=await importProductsFile(original,file);assert.equal(state.products.find(p=>p.id==='p1').barcode,'456');assert.equal(state.products.find(p=>p.id==='p2').barcode,'123');});

test('report range includes only movements inside selected dates',()=>{let state=applyMovement(base(),{type:'RECEIPT',productId:'p1',toLocationId:'l1',quantity:1});const day=state.movements[0].createdAt.slice(0,10);assert.equal(reportRows(state,day,day).length,1);assert.equal(reportRows(state,'2000-01-01','2000-01-02').length,0);});

test('real XLSX workbook imports through the same validated path',async()=>{const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('Import');sheet.addRow(['SKU','Name','Barcode','Unit','Minimum stock','Category','Location','Quantity','Batch','Expiry date']);sheet.addRow(['XLS-1','Seal','','ks',4,'Parts','D01',7,'LOT-X','2028-03-10']);const file=new File([await book.xlsx.writeBuffer()],'products.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});const state=await importProductsFile(emptyMiniState(),file);assert.equal(state.products[0].sku,'XLS-1');assert.equal(state.batches[0].expiryDate,'2028-03-10');});

test('PIN lock stores only a salted derived hash and verifies the PIN',async()=>{const values=new Map();globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};await setPin('2468');const config=readLock();assert.ok(config?.salt);assert.ok(config?.hash);assert.equal(JSON.stringify(config).includes('2468'),false);assert.equal(await verifyPin('2468'),true);assert.equal(await verifyPin('1111'),false);disablePin();assert.equal(readLock(),null);});

test('corrupt PIN lock data is ignored safely instead of crashing unlock',async()=>{const values=new Map();globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};for(const corrupt of ['{broken',JSON.stringify({salt:123,hash:'x'}),JSON.stringify({salt:'zz',hash:'00'}),JSON.stringify({salt:'00'.repeat(16),hash:'not-a-sha256'})]){values.set('aardvarkland-mini-lock-v1',corrupt);assert.equal(readLock(),null);assert.equal(await verifyPin('2468'),true);}});

test('all new customer features are translated in all six languages',()=>{for(const language of ['cs','en','ua','fr','de','es']){const copy=copyFor(language);for(const key of ['navReports','category','batches','expiryDate','importSpreadsheet','exportExcel','reportsTitle','lowStockNotifications','appLock','onboardingTitle','lowStockTitle'])assert.equal(typeof copy[key],'string',`${language}.${key}`);}});
