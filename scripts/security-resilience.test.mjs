import assert from 'node:assert/strict';
import test from 'node:test';
import { setPin, verifyPin, readLock, disablePin } from '../src/security.ts';
const values = new Map();
globalThis.localStorage = { getItem:key=>values.get(key)??null, setItem:(key,value)=>values.set(key,String(value)), removeItem:key=>values.delete(key) };
const lockKey='aardvarkland-mini-lock-v1';
test('PIN verifier is versioned and repeated guesses enter a cooldown',async()=>{
  await setPin('123456');
  assert.equal(readLock().version,2);
  for(let i=0;i<5;i++)assert.equal(await verifyPin('654321'),false);
  assert.equal(await verifyPin('123456'),false);
  disablePin();await setPin('123456');assert.equal(await verifyPin('123456'),true);disablePin();
});
test('legacy PBKDF2 verifier remains readable without lowering new PIN parameters',async()=>{
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const material=await crypto.subtle.importKey('raw',new TextEncoder().encode('1234'),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:150000,hash:'SHA-256'},material,256);
  values.set(lockKey,JSON.stringify({salt:Buffer.from(salt).toString('hex'),hash:Buffer.from(bits).toString('hex')}));
  assert.equal(await verifyPin('1234'),true);disablePin();
});
test('damaged and inaccessible PIN storage never silently unlock the interface',async()=>{
  for(const data of ['{','{}','null','{"salt":"00","hash":"00"}']){values.set(lockKey,data);assert.equal(readLock().invalid,true);assert.equal(await verifyPin('1234'),false);}
  const get=localStorage.getItem;localStorage.getItem=()=>{throw new Error('blocked');};
  assert.equal(readLock().invalid,true);assert.equal(await verifyPin('1234'),false);localStorage.getItem=get;disablePin();
});
