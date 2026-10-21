import React from 'react';
import {createRoot} from 'react-dom/client';
import CloudWorkspace from './cloud-workspace';
createRoot(document.getElementById('root')!).render(<CloudWorkspace/>);
if('serviceWorker' in navigator && location.protocol!=='file:'){
 window.addEventListener('load',()=>{
  navigator.serviceWorker.register('./sw.js').then(()=>navigator.serviceWorker.ready).then(()=>{
   const node=document.getElementById('offline-state');if(node)node.textContent='Ready offline · Changes save on this device';
  }).catch(()=>{const node=document.getElementById('offline-state');if(node)node.textContent='Offline installation incomplete — reconnect and reopen once.';});
 });
}
