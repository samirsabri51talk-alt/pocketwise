import assert from 'node:assert/strict';
import {build} from 'esbuild';
import 'fake-indexeddb/auto';
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
await build({entryPoints:[new URL('./src/cloud.ts',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')],bundle:true,platform:'node',format:'esm',outfile:new URL('./sync-test-bundle.mjs',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),define:{__SUPABASE_URL__:'""',__SUPABASE_KEY__:'""'}});
const {syncBudget}=await import('./sync-test-bundle.mjs');
const {readBudget,writeBudget}=await import('./test-storage.mjs');
const userId='test-user',scope='sync-test';
const blank={entries:[],opening:0,openingSavings:0,adjustments:[],openingDate:'2026-10-21',target:30000,caps:{}};
const remote=new Map([[userId,{version:2,data:{...blank,opening:100}}]]);
const client={from:()=>new Table()};
class Table{
 filters={};mode='select';payload=null;
 select(){return this;}
 update(payload){this.mode='update';this.payload=payload;return this;}
 insert(payload){this.mode='insert';this.payload=payload;return this;}
 eq(key,value){this.filters[key]=value;return this;}
 async maybeSingle(){const row=remote.get(this.filters.user_id)||null;if(this.mode==='update'){if(!row||row.version!==this.filters.version)return {data:null,error:null};const next={...row,...this.payload};remote.set(this.filters.user_id,next);return {data:next,error:null};}return {data:row,error:null};}
 async single(){if(remote.has(this.payload.user_id))return {data:null,error:{code:'23505',message:'duplicate'}};remote.set(this.payload.user_id,this.payload);return {data:this.payload,error:null};}
}
await writeBudget(blank,0,scope,true);
assert.equal(await syncBudget(client,userId,scope),'downloaded','Fresh device receives cloud budget');
assert.equal((await readBudget(scope)).data.opening,100);
await writeBudget({...blank,opening:150},2,scope);
assert.equal(await syncBudget(client,userId,scope),'uploaded','Offline edit uploads when cloud version is unchanged');
assert.equal(remote.get(userId).data.opening,150);
remote.set(userId,{version:4,data:{...blank,opening:200}});
await writeBudget({...blank,opening:180},3,scope);
assert.equal(await syncBudget(client,userId,scope),'conflict','Both sides changing prevents silent overwrite');
assert.equal((await readBudget(scope)).data.opening,180);
assert.equal(await syncBudget(client,userId,scope,'download'),'downloaded');
assert.equal((await readBudget(scope)).data.opening,200);
await writeBudget({...blank,opening:220},5,scope);
assert.equal(await syncBudget(client,userId,scope,'upload'),'uploaded');
assert.equal(remote.get(userId).data.opening,220);
globalThis.navigator.onLine=false;
await writeBudget({...blank,opening:230},6,scope);
assert.equal(await syncBudget(client,userId,scope),'offline');
assert.equal(remote.get(userId).data.opening,220);
console.log('PASS: cloud download, upload, conflict detection, explicit resolution, offline queue.');
