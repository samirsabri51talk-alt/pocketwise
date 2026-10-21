import {useEffect,useState} from 'react';
import Dashboard from './dashboard';
import {cloudClient,cloudConfigured,saveCloudConfig} from './cloud';

export default function CloudWorkspace(){
 const [userId,setUserId]=useState<string|null>(null),[mode,setMode]=useState<'loading'|'choose'|'local'|'account'|'setup'>(cloudConfigured?'loading':'local');
 useEffect(()=>{
  if(!cloudClient)return;
  let active=true;
  void cloudClient.auth.getSession().then(({data})=>{if(!active)return;if(data.session?.user){setUserId(data.session.user.id);setMode('account');}else setMode('choose');}).catch(()=>{if(active)setMode('choose');});
  const {data:{subscription}}=cloudClient.auth.onAuthStateChange((_event,session)=>{if(!active)return;if(session?.user){setUserId(session.user.id);setMode('account');}else{setUserId(null);setMode(current=>current==='account'?'choose':current);}});
  return()=>{active=false;subscription.unsubscribe();};
 },[]);
 if(mode==='loading')return <main className="loading"><div className="brandmark">p.</div><p>Opening Pocketwise…</p></main>;
 if(mode==='setup')return <CloudSetup onCancel={()=>setMode('local')}/>;
 if(mode==='choose'&&cloudClient)return <AuthScreen onLocal={()=>setMode('local')} onAuthenticated={id=>{setUserId(id);setMode('account');}}/>;
 return <Dashboard key={mode==='account'?userId||'account':'local'} scope={mode==='account'?userId||'local':'local'} cloud={mode==='account'?cloudClient:null} userId={mode==='account'?userId:null} onSignOut={mode==='account'?()=>{void cloudClient?.auth.signOut().then(()=>{setUserId(null);setMode('choose');});}:undefined} onConfigureCloud={mode==='local'?()=>setMode(cloudConfigured?'choose':'setup'):undefined}/>;
}

function CloudSetup({onCancel}:{onCancel:()=>void}){
 const [url,setUrl]=useState(''),[key,setKey]=useState(''),[error,setError]=useState('');
 return <main className="auth-screen"><div className="auth-card"><div className="brand"><span className="brandmark">p.</span>Pocketwise</div><h1>Connect your Supabase project</h1><p>First run the included <strong>Supabase-schema.sql</strong> in your project's SQL Editor. Then enter its Project URL and publishable key here. This public key identifies the project; each person's records remain protected by their account and database policies.</p><form onSubmit={e=>{e.preventDefault();try{saveCloudConfig(url,key);location.reload();}catch(err){setError((err as Error).message);}}}><label>Project URL<input type="url" required placeholder="https://your-project.supabase.co" value={url} onChange={e=>setUrl(e.target.value)}/></label><label>Publishable (anon) key<input required autoComplete="off" value={key} onChange={e=>setKey(e.target.value)}/></label>{error&&<p className="negative" role="alert">{error}</p>}<button className="primary">Connect project</button></form><button className="textbutton" onClick={onCancel}>Back to local budget</button><small>Never enter a secret or service_role key. You can keep using the local budget before connecting.</small></div></main>;
}

function AuthScreen({onLocal,onAuthenticated}:{onLocal:()=>void;onAuthenticated:(id:string)=>void}){
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[creating,setCreating]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 async function submit(e:React.FormEvent){e.preventDefault();if(!cloudClient)return;setBusy(true);setError('');setMessage('');try{
  if(creating){const {data,error}=await cloudClient.auth.signUp({email,password});if(error)throw error;if(data.session?.user)onAuthenticated(data.session.user.id);else setMessage('Check your email to confirm your account, then sign in.');}
  else{const {data,error}=await cloudClient.auth.signInWithPassword({email,password});if(error)throw error;if(data.user)onAuthenticated(data.user.id);}
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <main className="auth-screen"><div className="auth-card"><div className="brand"><span className="brandmark">p.</span>Pocketwise</div><h1>Your money, in focus.</h1><p>Sign in to sync securely between devices. Your entries also save on this device while offline.</p><form onSubmit={submit}><label>Email<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Password<input type="password" minLength={6} autoComplete={creating?'new-password':'current-password'} required value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<p className="negative" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}<button className="primary" disabled={busy}>{busy?'Please wait…':creating?'Create account':'Sign in'}</button></form><button className="textbutton" onClick={()=>{setCreating(!creating);setError('');setMessage('');}}>{creating?'Already have an account? Sign in':'New here? Create an account'}</button><button className="secondary full" onClick={onLocal}>Continue on this device</button><small>Device-only records remain separate until you export and import a backup into your account workspace.</small></div></main>;
}
