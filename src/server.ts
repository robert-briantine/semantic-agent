import express, { Request, Response, NextFunction } from 'express';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { ScriptStore } from './scripts';
import { Runtime } from './runtime';
import { buildAgentPrompt } from './agent-prompt';
import { AgentCallStore } from './agent-calls';
const root=resolve(__dirname,'..');
const app=express();app.use(express.json({limit:'128kb'}));
const db=resolve(process.env.MEMORY_DB||resolve(root,'data/memory.sqlite'));mkdirSync(resolve(db,'..'),{recursive:true});
const scripts=new ScriptStore(db);
const agentCalls=new AgentCallStore(db);
let busy=false;
// Toutes les tables sont consultables dès le démarrage, même sur une base vide.
new Runtime(db).close();
app.use('/assets',express.static(resolve(root,'dist/web')));
app.get('/editor/structure-langage.ts',(_req,res)=>res.type('text/plain').sendFile(resolve(root,'src/structure-langage.ts')));
app.get('/editor/structure-langage-pour-ia.ts',(_req,res)=>res.type('text/plain').sendFile(resolve(root,'src/structure-langage-pour-ia.ts')));
app.get('/editor/structure-langage.d.ts',(_req,res)=>res.type('text/plain').sendFile(resolve(root,'dist/editor/structure-langage.d.ts')));
app.use(express.static(resolve(root,'public'), {index:'index.html'}));
app.get('/api/library',(_req,res)=>res.type('text/plain').sendFile(resolve(root,'src/structure-langage-pour-ia.ts')));
app.get('/api/examples',(_req,res)=>res.type('text/plain').sendFile(resolve(root,'src/lg-exemple executable.ts')));
app.get('/api/prompt',async(req,res)=>{
    const base=process.env.PUBLIC_URL||`${req.protocol}://${req.get('host')}/`;
    const executeUrl=new URL('api/agent/execute',base.replace(/\/?$/,'/')).href;
    const prompt=await buildAgentPrompt(root,executeUrl);
    res.set('Cache-Control','no-store').type('text/plain').send(prompt);
});
app.get('/health',(_req,res)=>res.json({ok:true}));
function databaseRequest(res:Response, request:object, onFinish?:()=>void) {
    const child=spawn(process.execPath,['--max-old-space-size=256',resolve(__dirname,'database.js')],
        {env:{...process.env,MEMORY_DB:db},stdio:['pipe','pipe','pipe']});
    child.stdin.on('error',()=>{});
    child.stdin.end(JSON.stringify(request));
    let output='',done=false;
    const finish=(status:number,body:unknown)=>{if(done)return;done=true;clearTimeout(timer);res.status(status).json(body);};
    const timer=setTimeout(()=>{child.kill('SIGKILL');finish(408,{ok:false,error:'L’opération SQLite dépasse le délai de 5 secondes.'});},5000);
    child.stdout.on('data',chunk=>{
        output+=chunk;
        if(output.length>4000000){child.kill('SIGKILL');finish(413,{ok:false,error:'Résultat trop volumineux. Réduisez le nombre de lignes ou de colonnes.'});}
    });
    child.stderr.resume();
    child.on('error',()=>finish(500,{ok:false,error:'Impossible de démarrer la consultation SQLite.'}));
    child.on('close',()=>{
        onFinish?.();
        try {const result=JSON.parse(output);finish(result.ok?200:400,result);}
        catch {finish(500,{ok:false,error:'Consultation SQLite interrompue.'});}
    });
}
app.get('/api/database/tables',(_req,res)=>databaseRequest(res,{action:'tables'}));
app.get('/api/agent/calls',(req,res)=>{
    const limit=Number(req.query.limit??50),offset=Number(req.query.offset??0);
    if(!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0) {
        res.status(400).json({ok:false,error:'Limite de 1 à 100 et décalage positif ou nul requis.'});return;
    }
    databaseRequest(res,{action:'agent-calls',limit,offset});
});
app.get('/api/agent/calls/:id',(req,res)=>databaseRequest(res,{action:'agent-call',id:req.params.id}));
app.post('/api/database/reset',(req,res)=>{
    if(req.body?.confirm!=='RAZ'){res.status(400).json({ok:false,error:'Confirmez la remise à zéro avec confirm: RAZ.'});return;}
    if(busy){res.status(429).json({ok:false,error:'Une modification ou une exécution est déjà en cours.'});return;}
    busy=true;
    databaseRequest(res,{action:'reset'},()=>{busy=false;});
});
function referenceSelection(req:Request,res:Response):string[]|undefined {
    const ids=req.body?.refIds;
    if(!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=='string'||!id.length)) {
        res.status(400).json({ok:false,error:'Sélectionnez au moins une référence (refIds : tableau de chaînes non vides).'});return;
    }
    return [...new Set(ids)] as string[];
}
app.post('/api/refs/preview',(req,res)=>{
    const refIds=referenceSelection(req,res);
    if(refIds) databaseRequest(res,{action:'references',refIds});
});
app.post('/api/refs/delete',(req,res)=>{
    if(req.body?.mode!=='write'){res.status(403).json({ok:false,error:'La suppression exige le mode écriture (mode: write).'});return;}
    const refIds=referenceSelection(req,res);
    if(!refIds)return;
    if(busy){res.status(429).json({ok:false,error:'Une modification ou une exécution est déjà en cours.'});return;}
    busy=true;
    databaseRequest(res,{action:'delete-references',refIds},()=>{busy=false;});
});
app.get('/api/refs/:id',(req,res)=>databaseRequest(res,{action:'reference',refId:req.params.id}));
app.delete('/api/refs/:id',(req,res)=>{
    if(req.body?.mode!=='write'){res.status(403).json({ok:false,error:'La suppression exige le mode écriture (mode: write).'});return;}
    if(busy){res.status(429).json({ok:false,error:'Une modification ou une exécution est déjà en cours.'});return;}
    busy=true;
    databaseRequest(res,{action:'delete-reference',refId:req.params.id},()=>{busy=false;});
});
app.post('/api/database/query',(req,res)=>{
    const {sql,limit=100,offset=0}=req.body??{};
    if(typeof sql!=='string'||!sql.trim()||sql.length>60000||!Number.isSafeInteger(limit)||limit<1||limit>1000||!Number.isSafeInteger(offset)||offset<0) {
        res.status(400).json({ok:false,error:'Requête SQL requise (60000 caractères maximum), limite de 1 à 1000 lignes et décalage positif ou nul.'});return;
    }
    databaseRequest(res,{action:'query',sql,limit,offset});
});
app.get('/api/scripts',(_req,res)=>res.json(scripts.list()));
app.get('/api/scripts/:id',(req,res)=>{
    const script=scripts.get(req.params.id);
    if(!script){res.status(404).json({error:'Script introuvable'});return;}
    res.json(script);
});
function saveScript(req:Request,res:Response,next:NextFunction,id?:string,clone=false) {
    if(busy){res.status(429).json({error:'Une modification ou une exécution est déjà en cours.'});return;}
    const {name,code,mode='read'}=req.body??{};
    if(typeof name!=='string'||!name.trim()||name.trim().length>120||typeof code!=='string'||code.length>60000||(mode!=='read'&&mode!=='write')) {
        res.status(400).json({error:'Nom requis (120 caractères maximum), code limité à 60000 caractères et mode read ou write.'});return;
    }
    try {
        const input={name:name.trim(),code,mode};
        const script=id?scripts.update(id,input):clone?scripts.clone(input):scripts.create(input);
        if(!script){res.status(404).json({error:'Script introuvable'});return;}
        res.status(id?200:201).json(script);
    } catch(error) {
        if(error instanceof Error&&error.message.includes('UNIQUE constraint failed: saved_scripts.name')) {
            res.status(409).json({error:'Un script porte déjà ce nom. Chargez-le pour le modifier ou choisissez un autre nom.'});return;
        }
        next(error);
    }
}
app.post('/api/scripts',(req,res,next)=>saveScript(req,res,next));
app.post('/api/scripts/clone',(req,res,next)=>saveScript(req,res,next,undefined,true));
app.put('/api/scripts/:id',(req,res,next)=>saveScript(req,res,next,req.params.id));
function execute(req:Request,res:Response,trace:boolean) {
    const {code,mode='read',source}=req.body??{};
    if(typeof code!=='string'||code.length>60000||!['read','write'].includes(mode)){res.status(400).json({ok:false,error:'code ou mode invalide'});return;}
    if(trace&&(typeof source!=='string'||!source.trim()||source.length>60000)) {
        res.status(400).json({ok:false,error:'source requise : texte en langage naturel, de 1 à 60000 caractères.'});return;
    }
    if(busy){res.status(429).json({ok:false,error:'Une exécution est déjà en cours'});return;}
    const callId=trace?agentCalls.start(source,code,mode):undefined;
    busy=true;
    const start=performance.now();
    const child=spawn(process.execPath,['--max-old-space-size=256',resolve(__dirname,'execute.js'),Buffer.from(code).toString('base64'),mode],{env:{...process.env,MEMORY_DB:db},stdio:['ignore','pipe','pipe']});
    let out='',failure:{status:number;body:Record<string,unknown>}|undefined;
    const stop=(status:number,error:string)=>{
        if(failure)return;
        failure={status,body:{ok:false,error}};
        child.kill('SIGKILL');
    };
    const timer=setTimeout(()=>stop(408,'Temps maximum dépassé'),10000);
    child.stdout.on('data',b=>{if(failure)return;out+=b.toString();if(out.length>1000000)stop(413,'Résultat trop volumineux');});
    child.stderr.resume();
    child.on('error',()=>{failure={status:500,body:{ok:false,error:'Impossible de démarrer le runtime'}};});
    child.on('close',()=>{
        clearTimeout(timer);
        let status:number,body:Record<string,unknown>;
        if(failure) ({status,body}=failure);
        else {
            try {body=JSON.parse(out);status=body.ok?200:400;}
            catch {status=500;body={ok:false,error:'Runtime interrompu'};}
        }
        if(callId) {
            body={...body,callId};
            try {agentCalls.finish(callId,status,body,Math.round(performance.now()-start));}
            catch {status=500;body={ok:false,error:'Impossible de finaliser l’historique de cet appel.',callId};}
        }
        // Le processus a quitté et libéré SQLite avant de permettre une autre écriture ou une RAZ.
        busy=false;
        res.status(status).json(body);
    });
}
app.post('/api/execute',(req,res)=>execute(req,res,false));
app.post('/api/agent/execute',(req,res)=>execute(req,res,true));
const host=process.env.HOST||'127.0.0.1';
const server=app.listen(Number(process.env.PORT||3000),host,()=>{
    const address=server.address();
    if(!address||typeof address==='string')return;
    const browserHost=host==='0.0.0.0'?'127.0.0.1':host==='::'?'::1':host;
    const urlHost=browserHost.includes(':')?`[${browserHost}]`:browserHost;
    console.log('API sémantique prête');
    console.log(`Web app : http://${urlHost}:${address.port}/`);
});
server.on('close',()=>{scripts.close();agentCalls.close();});
