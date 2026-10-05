const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const express=require('../hotspot/node_modules/express');
const {installWorkspaceBackup,decrypt}=require('../hotspot/workspace-backup');
async function main(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ea-scheduled-'));
 const env={DATA_FILE:path.join(dir,'manager.json'),ADMIN_ACCOUNT_FILE:path.join(dir,'account.json')};
 fs.writeFileSync(env.ADMIN_ACCOUNT_FILE,JSON.stringify({email:'owner@example.test',passwordHash:'a'.repeat(32)+':'+ 'b'.repeat(128)}));
 const data={plans:[],vouchers:[],sales:[],paymentAttempts:[],deletedVoucherIds:[],agentPayments:[],reportActions:[],dataUsage:{startedAt:Date.now(),days:[]},operations:{expenses:[],requests:[],audit:[]}};
 const app=express();app.use(express.json());
 const svc=installWorkspaceBackup(app,{env,towns:[{id:'default',name:'Main'}],instances:new Map([['default',{readManagerData:()=>data}]]),requireAdmin:(req,res,next)=>req.headers.authorization==='Bearer owner'?next():res.sendStatus(401),stopJobs(){}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const url=`http://127.0.0.1:${server.address().port}/api/admin/backup`;
 const req=(route,body,auth=true)=>fetch(url+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer owner'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 try{
  assert.equal((await req('/schedule',null,false)).status,401);
  assert.equal((await req('/schedule',{enabled:true,hours:24,retention:2,password:'short'})).status,400);
  const password='LongBackupPassword123!';
  const configured=await(await req('/schedule',{enabled:true,hours:24,retention:2,password})).json();
  assert.equal(JSON.stringify(configured).includes(password),false);
  for(let i=0;i<3;i++){
   const file=path.join(dir,'backups','schedule-settings.json');const config=JSON.parse(fs.readFileSync(file));config.nextAt=0;fs.writeFileSync(file,JSON.stringify(config));
   await svc.scheduledBackup();
  }
  const list=await(await req('/safety')).json();assert.equal(list.backups.length,2);
  const downloaded=await(await req('/safety/'+list.backups[0].name)).json();
  assert.equal((await decrypt(downloaded.backup,password)).towns[0].data.operations.audit.length,0);
  const status=await(await req('/schedule')).json();assert.ok(status.schedule.lastSuccessAt);assert.equal(status.schedule.error,'');
  await req('/schedule',{enabled:false,hours:24,retention:2});await svc.scheduledBackup();
  assert.equal((await(await req('/safety')).json()).backups.length,2);
  console.log('Scheduled backup checks passed: authorization, password validation, encryption, retention, status, downloading and disabling.');
 }finally{svc.stopJobs();server.close();fs.rmSync(dir,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
