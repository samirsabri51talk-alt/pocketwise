import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import {budgetSchema} from './model';
import {markSynced, readBudget, replaceFromCloud} from './storage';

declare const __SUPABASE_URL__: string;
declare const __SUPABASE_KEY__: string;

const localConfigKey='pocketwise-public-supabase-config';
export function validateCloudConfig(url:string,key:string){
 const cleanUrl=url.trim().replace(/\/$/,'');
 const cleanKey=key.trim();
 if(!/^https:\/\/[a-z0-9.-]+$/i.test(cleanUrl))throw new Error('Enter a valid HTTPS Supabase Project URL.');
 if(!/^(sb_publishable_|eyJ)[A-Za-z0-9._-]+$/.test(cleanKey))throw new Error('Use only a publishable or legacy anon key. Never enter a secret/service_role key.');
 return {url:cleanUrl,key:cleanKey};
}
function getCloudConfig(){
 if(__SUPABASE_URL__&&__SUPABASE_KEY__)return validateCloudConfig(__SUPABASE_URL__,__SUPABASE_KEY__);
 try{const stored=JSON.parse(localStorage.getItem(localConfigKey)||'null');if(stored?.url&&stored?.key)return validateCloudConfig(stored.url,stored.key);}catch{}
 return null;
}
export function saveCloudConfig(url:string,key:string){
 const config=validateCloudConfig(url,key);
 localStorage.setItem(localConfigKey,JSON.stringify(config));
}
const config=getCloudConfig();
export const cloudConfigured=Boolean(config);
export const cloudClient:SupabaseClient|null=config?createClient(config.url,config.key,{
 auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true},
}):null;

export type SyncResult='synced'|'downloaded'|'uploaded'|'conflict'|'offline';
export async function syncBudget(client:SupabaseClient,userId:string,scope:string,strategy:'normal'|'upload'|'download'='normal'):Promise<SyncResult>{
 if(!navigator.onLine)return 'offline';
 const local=await readBudget(scope);
 if(!local.data)throw new Error('Local budget is not ready.');
 const {data:remote,error:readError}=await client.from('pocketwise_budgets').select('version,data').eq('user_id',userId).maybeSingle();
 if(readError)throw new Error(readError.message);
 const dirty=local.revision>local.sync.syncedRevision;
 if(remote){
  const remoteVersion=Number(remote.version);
  if(strategy==='download'||(strategy==='normal'&&!dirty&&local.sync.remoteVersion!==remoteVersion)){
   await replaceFromCloud(scope,budgetSchema.parse(remote.data),local.revision,remoteVersion);
   return 'downloaded';
  }
  if(strategy==='normal'&&local.sync.remoteVersion!==remoteVersion)return 'conflict';
  if(strategy==='normal'&&!dirty)return 'synced';
  const {data:written,error:writeError}=await client.from('pocketwise_budgets').update({data:local.data,version:remoteVersion+1}).eq('user_id',userId).eq('version',remoteVersion).select('version').maybeSingle();
  if(writeError)throw new Error(writeError.message);
  if(!written)return 'conflict';
  await markSynced(scope,local.revision,Number(written.version));
  return 'uploaded';
 }
 if(strategy==='download')return 'conflict';
 const {data:written,error:writeError}=await client.from('pocketwise_budgets').insert({user_id:userId,data:local.data,version:1}).select('version').single();
 if(writeError){if(writeError.code==='23505')return 'conflict';throw new Error(writeError.message);}
 await markSynced(scope,local.revision,Number(written.version));
 return 'uploaded';
}
