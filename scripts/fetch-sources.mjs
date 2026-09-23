import { mkdir, readFile, writeFile } from 'node:fs/promises';
const base = 'https://home.toppingaudio.com/autoeq/headphone-library';
async function json(url) {
  for(let attempt=0;attempt<4;attempt++) {
    try { const response=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error(`${response.status} ${url}`);return await response.json(); }
    catch(error) { if(attempt===3)throw error; }
  }
}
const catalog=await json(`${base}/models.json`);
await mkdir('public/curves/sources',{recursive:true});
await mkdir('src/data',{recursive:true});
let next=0, completed=0;
const models=new Array(catalog.models.length);
await Promise.all(Array.from({length:6},async()=>{
  while(next<catalog.models.length){
    const index=next++, model=catalog.models[index];
    const file=`${model.id}.json`, sourceUrl=`${base}/curves/${encodeURIComponent(model.id)}.json`;
    let data;
    try{data=JSON.parse(await readFile(`public/curves/sources/${file}`,'utf8'));}catch{data=await json(sourceUrl);}
    const points=data.points.filter(p=>p.length===2&&p.every(Number.isFinite)&&p[0]>=20&&p[0]<=20000).sort((a,b)=>a[0]-b[0]);
    if(points.length<2)throw Error(`Invalid curve: ${model.name}`);
    await writeFile(`public/curves/sources/${file}`,JSON.stringify({points}));
    models[index]={...model,name:`${model.brand} ${model.name}`.trim(),model:model.name,id:`builtin-source:${model.id}`,upstreamId:model.id,kind:'source',builtin:true,responseFile:file,pointCount:points.length,sourceUrl};
    completed++;if(completed%75===0)console.log(`${completed}/${catalog.models.length} responses bundled`);
  }
}));
await writeFile('src/data/builtin-sources.json',JSON.stringify({sourceUrl:`${base}/models.json`,dataset:catalog.dataset,version:catalog.version,license:catalog.license,models}));
console.log(`Bundled ${models.length} source responses. Each loads from a local file when selected.`);
