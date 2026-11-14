import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {adaptBackendSite} from '../src/backend.ts';
import {decodePng16} from '../src/png16.ts';
const base='https://backend.lightlink.club', root=process.cwd();
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const hash=v=>createHash('sha256').update(v).digest('hex');
async function get(path){const r=await fetch(base+path,{headers:{Origin:'http://localhost:5173'},signal:AbortSignal.timeout(20000)});const text=await r.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {path,status:r.status,cors:r.headers.get('access-control-allow-origin'),data};}
process.chdir(resolve(root,'backend'));
const {buildApp}=await import('../backend/src/app.ts');
const app=await buildApp();
const report={checkedAt:new Date().toISOString(),base,comparison:'Current remote responses versus bundled local backend (not a previous remote deployment snapshot)',discovery:[],catalog:null,sites:[],features:[]};
try {
 const catalog=await get('/sites');report.catalog=catalog;
 report.discovery=await Promise.all(['/health','/openapi.json','/documentation/json','/docs'].map(get));
 for(const item of catalog.data) {
  for(const height of item.observer_heights_m??[2]) {
   const path='/sites/'+encodeURIComponent(item.site_id)+'?observer_height_m='+height;
   const remote=await get(path), local=(await app.inject(path)).json();
   const changedKeys=[...new Set([...Object.keys(remote.data),...Object.keys(local)])].filter(k=>JSON.stringify(stable(remote.data[k]))!==JSON.stringify(stable(local[k])));
   let compatibility='ok';try{adaptBackendSite(remote.data,base);}catch(e){compatibility=e.message;}
   const entry={id:item.site_id,height,status:remote.status,compatibility,keys:Object.keys(remote.data),addedKeys:Object.keys(remote.data).filter(k=>!(k in local)),removedKeys:Object.keys(local).filter(k=>!(k in remote.data)),changedKeys,frames:remote.data.ephemeris_timeline?.length,horizon:remote.data.horizon_mask?.length,metrics:remote.data.metrics,resolution:remote.data.resolution};
   if(height===2&&remote.data.heightmap_url){
    const url=remote.data.heightmap_url;
    if(!/^\/assets\/heightmaps\/[A-Za-z0-9_.-]+\.png$/.test(url))throw new Error('Unexpected asset path');
    const response=await fetch(base+url,{signal:AbortSignal.timeout(20000)}),bytes=new Uint8Array(await response.arrayBuffer()),field=decodePng16(bytes);
    const old=await readFile(resolve(root,'backend/public/heightmaps',url.split('/').at(-1)));
    entry.png={status:response.status,width:field.width,height:field.height,bytes:bytes.length,sha256:hash(bytes),sameAsLocal:hash(bytes)===hash(old)};
   }
   report.sites.push(entry);console.log(JSON.stringify(entry));
  }
 }
 report.features=await Promise.all(['/sites/Site04/metadata','/sites/Site04?observer_height_m=10','/sites/Site04?start_utc=2026-11-14T00:00:00Z&end_utc=2026-11-15T00:00:00Z&step_hours=3','/sites/Site04/export?format=csv&start_utc=2026-11-14T00:00:00Z&end_utc=2026-11-15T00:00:00Z'].map(get));
 report.features=report.features.map(r=>({...r,data:r.data?.ephemeris_timeline?{keys:Object.keys(r.data),frames:r.data.ephemeris_timeline.length,windows:r.data.windows,metrics:r.data.metrics,resolution:r.data.resolution}:r.data}));
 await writeFile(resolve(root,'backend-audit.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({discovery:report.discovery.map(r=>({...r,data:typeof r.data==='string'?r.data.slice(0,500):r.data})),features:report.features}));
}finally{await app.close();process.chdir(root);}
