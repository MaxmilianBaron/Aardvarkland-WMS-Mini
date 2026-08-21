import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import { downloadFile } from './backup';
import { applyMovement, createId, totalStock } from './domain';
import type { MiniState } from './types';

const headers = ['SKU', 'Name', 'Barcode', 'Unit', 'Minimum stock', 'Category', 'Location', 'Quantity', 'Batch', 'Expiry date'];

export async function exportWorkbook(state: MiniState): Promise<void> {
  const book = new ExcelJS.Workbook(); book.creator = 'Aardvarkland WMS-Mini';
  addSheet(book, 'Products', ['SKU','Name','Barcode','Unit','Minimum stock','Category','Total stock'], state.products.map(p => [p.sku,p.name,p.barcode,p.unit,p.minimumStock,state.categories.find(c=>c.id===p.categoryId)?.name ?? '',totalStock(state,p.id)]));
  addSheet(book, 'Stock', ['SKU','Product','Location','Quantity'], state.balances.map(b => { const p=state.products.find(x=>x.id===b.productId); const l=state.locations.find(x=>x.id===b.locationId); return [p?.sku??'',p?.name??'',l?.code??'',b.quantity]; }));
  addSheet(book, 'Movements', ['Date','Type','SKU','From','To','Quantity','Batch','Expiry','Note'], state.movements.map(m=>[m.createdAt,m.type,state.products.find(p=>p.id===m.productId)?.sku??'',state.locations.find(l=>l.id===m.fromLocationId)?.code??'',state.locations.find(l=>l.id===m.toLocationId)?.code??'',m.quantity,m.lotNumber,m.expiryDate??'',m.note]));
  addSheet(book, 'Batches', ['SKU','Location','Batch','Expiry','Quantity'], state.batches.map(b=>[state.products.find(p=>p.id===b.productId)?.sku??'',state.locations.find(l=>l.id===b.locationId)?.code??'',b.lotNumber,b.expiryDate??'',b.quantity]));
  const bytes = new Uint8Array(await book.xlsx.writeBuffer());
  await downloadFile(bytes, `aardvarkland-wms-mini-${today()}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Excel export');
}

export async function downloadImportTemplate(): Promise<void> {
  const book = new ExcelJS.Workbook(); addSheet(book, 'Import', headers, []);
  const sheet=book.getWorksheet('Import')!; sheet.views=[{state:'frozen',ySplit:1}];
  const bytes=new Uint8Array(await book.xlsx.writeBuffer());
  await downloadFile(bytes, 'aardvarkland-wms-mini-import-template.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Import template');
}

export async function importProductsFile(state: MiniState, file: File): Promise<MiniState> {
  let rows: unknown[][];
  if (file.name.toLowerCase().endsWith('.csv')) rows=parseCsv(await file.text());
  else { const book=new ExcelJS.Workbook(); await book.xlsx.load(await file.arrayBuffer()); const sheet=book.worksheets[0]; if(!sheet) throw new Error('EMPTY_IMPORT'); rows=[]; sheet.eachRow(r=>rows.push((r.values as unknown[]).slice(1))); }
  if (!rows.length) throw new Error('EMPTY_IMPORT');
  const normalized=rows[0].map(v=>String(v??'').trim().toLowerCase());
  if (normalized[0] !== 'sku' || !['name','product name','název'].includes(normalized[1])) throw new Error('INVALID_COLUMNS');
  const input=rows.slice(1).filter(r=>r.some(v=>String(v??'').trim())).map((r,i)=>({ sku:String(r[0]??'').trim().toUpperCase(), name:String(r[1]??'').trim(), barcode:String(r[2]??'').trim(), unit:String(r[3]??'ks').trim()||'ks', minimum:Number(r[4]??0), category:String(r[5]??'').trim(), location:String(r[6]??'').trim().toUpperCase(), quantity:Number(r[7]??0), lot:String(r[8]??'').trim(), expiry:excelDate(r[9]), row:i+2 }));
  const seen=new Set<string>(); for(const r of input){ if(!r.sku||!r.name||!Number.isFinite(r.minimum)||r.minimum<0||!Number.isFinite(r.quantity)||r.quantity<0||seen.has(r.sku)) throw new Error(`INVALID_ROW_${r.row}`); seen.add(r.sku); if(r.expiry && Number.isNaN(Date.parse(`${r.expiry}T00:00:00`))) throw new Error(`INVALID_ROW_${r.row}`); }
  validateImportBarcodes(state,input);
  let next: MiniState={...state,products:[...state.products],categories:[...state.categories],locations:[...state.locations]}; const now=new Date().toISOString();
  for(const r of input){ let category=next.categories.find(c=>c.name.toLocaleLowerCase()===r.category.toLocaleLowerCase()); if(r.category&&!category){category={id:createId(),name:r.category,createdAt:now};next.categories.push(category);} let location=next.locations.find(l=>l.code===r.location); if(r.location&&!location){location={id:createId(),code:r.location,name:r.location,createdAt:now};next.locations.push(location);} let product=next.products.find(p=>p.sku===r.sku); if(product){product={...product,name:r.name,barcode:r.barcode,unit:r.unit,minimumStock:r.minimum,categoryId:category?.id??null,updatedAt:now};next.products=next.products.map(p=>p.id===product!.id?product!:p);}else{product={id:createId(),sku:r.sku,name:r.name,barcode:r.barcode,unit:r.unit,minimumStock:r.minimum,categoryId:category?.id??null,createdAt:now,updatedAt:now};next.products.push(product);} if(r.quantity>0){if(!location)throw new Error(`LOCATION_REQUIRED_${r.row}`);next=applyMovement(next,{type:'RECEIPT',productId:product.id,toLocationId:location.id,quantity:r.quantity,lotNumber:r.lot,expiryDate:r.expiry,note:'Import CSV/Excel'});} }
  return {...next,updatedAt:now};
}

function validateImportBarcodes(state: MiniState, input: Array<{sku:string;barcode:string;row:number}>): void {
  const productBySku=new Map(state.products.map(product=>[product.sku.toUpperCase(),product]));
  const updatedExistingIds=new Set(input.map(row=>productBySku.get(row.sku)?.id).filter((id):id is string=>Boolean(id)));
  const barcodeOwners=new Map<string,string>();
  for(const product of state.products){if(product.barcode&&!updatedExistingIds.has(product.id))barcodeOwners.set(product.barcode,product.id);}
  for(const row of input){
    if(!row.barcode)continue;
    const existing=productBySku.get(row.sku);
    const ownerToken=existing?.id??`import:${row.sku}`;
    const owner=barcodeOwners.get(row.barcode);
    if(owner&&owner!==ownerToken)throw new Error(`INVALID_ROW_${row.row}`);
    barcodeOwners.set(row.barcode,ownerToken);
  }
}

export async function exportReportCsv(state:MiniState,from:string,to:string):Promise<void>{ const sections:unknown[][]=[['MOVEMENTS'],['Date','Type','SKU','Product','Quantity','Note'],...reportRows(state,from,to),[],['CURRENT STOCK'],['SKU','Product','Quantity','Minimum'],...state.products.map(p=>[p.sku,p.name,totalStock(state,p.id),p.minimumStock]),[],['BELOW MINIMUM'],['SKU','Product','Quantity','Minimum'],...state.products.filter(p=>totalStock(state,p.id)<p.minimumStock).map(p=>[p.sku,p.name,totalStock(state,p.id),p.minimumStock])];const csv=sections.map(r=>r.map(csvCell).join(',')).join('\r\n'); await downloadFile(new TextEncoder().encode('\ufeff'+csv),`wms-mini-report-${today()}.csv`,'text/csv','CSV report'); }
export async function exportReportPdf(state:MiniState,from:string,to:string):Promise<void>{const doc=new jsPDF();let y=18;const line=(value:string,bold=false)=>{if(y>280){doc.addPage();y=18;}doc.setFont('helvetica',bold?'bold':'normal');doc.text(value.slice(0,100),14,y);y+=7;};doc.setFontSize(18);line('Aardvarkland WMS-Mini',true);doc.setFontSize(11);line(`${state.warehouseName||'Warehouse'} | ${from} - ${to}`);y+=4;line('MOVEMENTS',true);for(const r of reportRows(state,from,to))line(`${String(r[0]).slice(0,10)}  ${r[1]}  ${r[2]}  ${r[4]}`);y+=4;line('CURRENT STOCK',true);for(const p of state.products)line(`${p.sku}  ${p.name}  ${totalStock(state,p.id)} / min ${p.minimumStock}`);y+=4;line('BELOW MINIMUM',true);for(const p of state.products.filter(p=>totalStock(state,p.id)<p.minimumStock))line(`${p.sku}  ${p.name}  ${totalStock(state,p.id)} / min ${p.minimumStock}`);const bytes=new Uint8Array(doc.output('arraybuffer'));await downloadFile(bytes,`wms-mini-report-${today()}.pdf`,'application/pdf','PDF report');}
export function reportRows(state:MiniState,from:string,to:string):unknown[][]{return state.movements.filter(m=>m.createdAt.slice(0,10)>=from&&m.createdAt.slice(0,10)<=to).map(m=>[m.createdAt,m.type,state.products.find(p=>p.id===m.productId)?.sku??'',state.products.find(p=>p.id===m.productId)?.name??'',m.quantity,m.note]);}
function addSheet(book:ExcelJS.Workbook,name:string,columns:string[],rows:unknown[][]){const s=book.addWorksheet(name);s.addRow(columns);rows.forEach(r=>s.addRow(r));s.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};s.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF171717'}};s.columns.forEach(c=>c.width=18);s.autoFilter={from:'A1',to:`${String.fromCharCode(64+Math.min(columns.length,26))}1`};}
function parseCsv(text:string):string[][]{const out:string[][]=[];let row:string[]=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'&&quoted&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=!quoted;else if((c===','||c===';'||c==='\t')&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);out.push(row);row=[];cell='';}else cell+=c;}if(cell||row.length){row.push(cell);out.push(row);}return out;}
function csvCell(v:unknown){const s=String(v??'');return `"${s.replaceAll('"','""')}"`;}
function excelDate(v:unknown):string{if(v instanceof Date)return v.toISOString().slice(0,10);if(typeof v==='number'){const d=new Date(Date.UTC(1899,11,30)+v*86400000);return d.toISOString().slice(0,10);}return String(v??'').trim();}
function today(){return new Date().toISOString().slice(0,10);}
