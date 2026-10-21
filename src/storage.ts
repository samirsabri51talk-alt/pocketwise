import { Budget, budgetSchema } from './model';
export type SyncCursor={remoteVersion:number;syncedRevision:number};
type RecordValue={data:Budget;revision:number;savedAt:string;sync?:SyncCursor};
const keyFor=(scope:string)=>scope==='local'?'current':`user:${scope}`;
let connection:Promise<IDBDatabase>|null=null;
function openDB(){
 if(!connection)connection=new Promise<IDBDatabase>((resolve,reject)=>{
  const r=indexedDB.open('pocketwise-offline-v1',1);
  r.onupgradeneeded=()=>r.result.createObjectStore('budgets');
  r.onsuccess=()=>{r.result.onversionchange=()=>{r.result.close();connection=null;};resolve(r.result);};
  r.onerror=()=>{connection=null;reject(new Error('Device storage is unavailable. Use a normal browser window, not private browsing.'));};
  r.onblocked=()=>reject(new Error('Close other Pocketwise windows and retry.'));
 });return connection;
}
export async function readBudget(scope='local'):Promise<{data:Budget|null;revision:number;sync:SyncCursor}>{
 const db=await openDB();return new Promise((resolve,reject)=>{
  const tx=db.transaction('budgets','readonly'),r=tx.objectStore('budgets').get(keyFor(scope));
  tx.oncomplete=()=>{try{const v=r.result as RecordValue|undefined;resolve(v?{data:budgetSchema.parse(v.data),revision:v.revision,sync:v.sync||{remoteVersion:0,syncedRevision:0}}:{data:null,revision:0,sync:{remoteVersion:0,syncedRevision:0}});}catch{reject(new Error('Stored data could not be read. Restore a JSON backup.'));}};
  tx.onerror=()=>reject(new Error('Could not read device storage.'));
 });
}
export async function writeBudget(data:Budget,expected:number,scope='local',cleanInitial=false):Promise<number>{
 const validated=budgetSchema.parse(data),db=await openDB();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('budgets','readwrite'),store=tx.objectStore('budgets'),r=store.get(keyFor(scope));let conflict=false;
  r.onsuccess=()=>{const old=r.result as RecordValue|undefined;if((old?.revision||0)!==expected){conflict=true;tx.abort();return;}if(old)store.put(old,`${keyFor(scope)}:previous`);store.put({data:validated,revision:expected+1,savedAt:new Date().toISOString(),sync:old?.sync||{remoteVersion:0,syncedRevision:cleanInitial?1:0}},keyFor(scope));};
  tx.oncomplete=()=>resolve(expected+1);
  tx.onabort=()=>reject(new Error(conflict?'This budget changed in another window. Reload before editing.':'Save failed. Device storage may be full. Export a backup and retry.'));
  tx.onerror=()=>{};
 });
}
export async function markSynced(scope:string,uploadedRevision:number,remoteVersion:number){
 const db=await openDB();return new Promise<void>((resolve,reject)=>{
  const tx=db.transaction('budgets','readwrite'),store=tx.objectStore('budgets'),r=store.get(keyFor(scope));
  r.onsuccess=()=>{const v=r.result as RecordValue|undefined;if(!v){tx.abort();return;}v.sync={remoteVersion,syncedRevision:Math.max(v.sync?.syncedRevision||0,uploadedRevision)};store.put(v,keyFor(scope));};
  tx.oncomplete=()=>resolve();tx.onabort=()=>reject(new Error('Could not save sync state.'));
 });
}
export async function replaceFromCloud(scope:string,data:Budget,expectedRevision:number,remoteVersion:number){
 const validated=budgetSchema.parse(data),db=await openDB();return new Promise<number>((resolve,reject)=>{
  const tx=db.transaction('budgets','readwrite'),store=tx.objectStore('budgets'),r=store.get(keyFor(scope));let conflict=false;
  r.onsuccess=()=>{const old=r.result as RecordValue|undefined;if((old?.revision||0)!==expectedRevision){conflict=true;tx.abort();return;}if(old)store.put(old,`${keyFor(scope)}:previous`);const revision=expectedRevision+1;store.put({data:validated,revision,savedAt:new Date().toISOString(),sync:{remoteVersion,syncedRevision:revision}},keyFor(scope));};
  tx.oncomplete=()=>resolve(expectedRevision+1);tx.onabort=()=>reject(new Error(conflict?'Local changes appeared during cloud download. Retry sync.':'Could not store cloud data on this device.'));
 });
}
export async function requestPersistence(){
 if(!navigator.storage?.persist)return false;
 return navigator.storage.persist();
}
