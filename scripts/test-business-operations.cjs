const assert = require('node:assert/strict');
const express = require('../hotspot/node_modules/express');
const { installBusinessOperations } = require('../hotspot/business-operations');
const { schedulerTime, parseWallTime, firstLoginEvidence } = require('../hotspot/router-time');

async function main() {
  const first = Date.parse('2026-09-29T15:11:57Z');
  assert.equal(parseWallTime('2026-09-29 11:11:57','America/New_York'),first);
  assert.equal(parseWallTime('2026-11-01 01:30:00','America/New_York'),null);
  assert.equal(parseWallTime('2026-03-08 02:30:00','America/New_York'),null);
  assert.equal(parseWallTime('11:11:57','America/New_York'),null);
  assert.deepEqual(schedulerTime(first+3*86400000, {'time-zone-name':'America/New_York',date:'2026-09-30'}),{date:'2026-10-02',time:'11:11:57'});
  let data={plans:[],vouchers:[{id:'v1',username:'199',password:'secret',phone:'+233241234567',source:'online-payment',createdAt:first-6000,activatedAt:null,expiresAt:null,durationMs:259200000,dataLimit:17,dataConsumedBytes:1000,provisioning:'ready',status:'active'}],sales:[{id:'s1',voucherId:'v1',amount:10}],paymentAttempts:[]};
  const logs=[{time:'2026-09-29 11:11:52',topics:'system,info',message:'hotspot user 199 added by api:ea-rest'}, {time:'2026-09-29 11:11:57',topics:'hotspot,account',message:'199 (192.168.20.116): logged in'}];
  assert.equal(firstLoginEvidence(data.vouchers[0],logs,'America/New_York',first+1000),first);
  assert.equal(firstLoginEvidence(data.vouchers[0],logs.slice(1),'America/New_York',first+1000),null);
  let outage=false, verified=0, sent=0; const commands=[];
  const app=express(); app.use(express.json());
  const ops=installBusinessOperations(app,{requireAdmin:(req,res,next)=>{if(req.headers.authorization!=='Bearer owner')return res.sendStatus(401);req.staff={id:'owner'};next();},
    read:()=>structuredClone(data),save:next=>{data=structuredClone(next);},shared:false,duration:v=>v.durationMs,
    schedule:async()=>{}, fulfill:async ref=>{assert.equal(ref,'paid-reference');verified++;},sms:async()=>{sent++;return {success:true};},
    router:async(command,args)=>{if(outage)throw Error('Offline');commands.push([command,args]);
      if(command==='/ip/hotspot/active/print')return [];
      if(command==='/system/clock/print')return [{'time-zone-name':'America/New_York'}];
      if(command==='/system/resource/print')return [{'cpu-load':'10'}];
      if(command==='/log/print')return logs;
      if(command==='/ip/hotspot/user/print')return [{'.id':'*1',name:'199'}];
      return [];
    }});
  const server=app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
  const url=`http://127.0.0.1:${server.address().port}`;
  const request=async(route,body,auth=true)=>{const r=await fetch(url+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer owner'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.text().then(t=>{try{return JSON.parse(t);}catch{return t;}})};};
  let counter=0; const action=(action,extra={})=>({action,requestId:'request-000000000'+(++counter),reason:'Customer support',...extra});
  try {
    assert.equal((await request('/api/admin/operations',null,false)).status,401);
    await ops.refresh(); assert.equal(data.vouchers[0].activatedAt,first);assert.equal(data.vouchers[0].expiresAt,first+259200000);
    const state=(await request('/api/admin/operations?q=199')).body;
    assert.equal(state.customers.length,1);assert.equal(JSON.stringify(state).includes('secret'),false);
    assert.equal((await request('/api/admin/operations?q=missing')).body.customers.length,0);
    const expense=action('expense',{amount:3.25,category:'Electricity'});
    assert.equal((await request('/api/admin/operations',expense)).status,200);
    await request('/api/admin/operations',expense);
    assert.equal(data.operations.expenses.length,1);
    assert.equal((await request('/api/admin/operations',{...expense,amount:6})).status,400);
    assert.equal((await request('/api/admin/operations')).body.profit.net,6.75);
    await request('/api/admin/operations',action('void-expense',{expenseId:expense.requestId}));
    assert.equal((await request('/api/admin/operations')).body.profit.net,10);
    const extra=action('add-data',{voucherId:'v1',value:2});
    await request('/api/admin/operations',extra); await request('/api/admin/operations',extra);
    assert.equal(data.vouchers[0].dataLimit,19); assert.equal(data.operations.requests.at(-1).state,'pending');
    outage=true; await ops.refresh(); assert.equal(data.operations.requests.at(-1).state,'pending');
    outage=false; await ops.refresh(); assert.equal(data.operations.requests.at(-1).state,'done');
    assert.ok(commands.some(([c,a])=>c.endsWith('/user/set')&&a.includes('=limit-bytes-total='+19*1024**3)));
    await request('/api/admin/operations',action('suspend',{voucherId:'v1'})); await ops.refresh();
    assert.equal(data.vouchers[0].suspended,true);
    await request('/api/admin/operations',action('reconcile',{reference:'paid-reference'}));assert.equal(verified,1);
    await request('/api/admin/operations',action('resend',{voucherId:'v1'}));assert.equal(sent,1);
    const customer=await request('/api/public/customer',{username:'199',password:'secret'},false);
    assert.equal(customer.status,200);assert.equal(customer.body.customer.status,'suspended');
    assert.equal('phone' in customer.body.customer,false);assert.equal('paymentReference' in customer.body.customer,false);
    for(let i=0;i<9;i++) assert.equal((await request('/api/public/customer',{username:'199',password:'wrong'},false)).status,401);
    assert.equal((await request('/api/public/customer',{username:'199',password:'secret'},false)).status,429);
    console.log('Business operations passed: timezone/DST, evidence recovery, access controls, expense profit, idempotency, outage retries, suspension, payment verification, SMS and customer privacy/rate limits.');
  } finally { server.close(); }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
