const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const server = fs.readFileSync('hotspot/server.js', 'utf8');
const createSource = server.slice(server.indexOf('async function createMikroTikUser('), server.indexOf('// async function createMikroTikUser('));
async function routerCheck(mode) {
  let connections = 0, additions = 0;
  class Router {
    async connect() { connections++; if (mode === 'offline') throw Error('Time out after 10 seconds'); }
    async close() {}
    async write(command) {
      if (command.endsWith('/add')) { additions++; throw Error('Time out after 10 seconds'); }
      if (mode === 'unreachable') throw Error('Time out after 10 seconds');
      return [{name:'199', password:'456',profile:'DAILY','limit-bytes-total':'1000',comment:mode==='mismatch'?'someone-else':'EA-MANAGER-request-1234567890'}];
    }
  }
  const context = vm.createContext({RouterOSAPI:Router,getMikroTikApiOptions:()=>({}),console:{log(){}}});
  vm.runInContext(createSource,context);
  const result=vm.runInContext("createMikroTikUser('199','456','DAILY',1000,'request-1234567890')",context);
  if(mode==='confirmed') assert.equal((await result).length,1);
  else await assert.rejects(result,mode==='offline'?/No voucher-add command was sent/:/could not be verified/);
  assert.equal(additions,mode==='offline'?0:1);
  assert.equal(connections,mode==='offline'?1:2);
}
async function routeCheck() {
  let handler, adds=0;
  let data={plans:[{id:'daily',price:5,name:'Daily',dataLimit:1}],vouchers:[],sales:[]};
  const ctx=vm.createContext({crypto,console:{error(){}},app:{post:(_path,_guard,fn)=>{handler=fn;}},requireAdminToken(){},
    sharedVouchers:null,initializingVoucherUsernames:new Set(),readManagerData:()=>structuredClone(data),
    chooseProfile:()=> 'DAILY',profileNameForPlan:()=> 'DAILY',chooseQuotaBytes:()=>1000,planDurationMs:()=>86400000,
    createMikroTikUser:async()=>{adds++;data.vouchers.push({id:'imported',username:'199',source:'mikrotik',activatedAt:100,expiresAt:200});},
    writeManagerData:next=>{data=structuredClone(next);}
  });
  const start=server.indexOf("app.post('/api/admin/vouchers',");
  vm.runInContext(server.slice(start,server.indexOf("app.put('/api/admin/vouchers/:id'",start)),ctx);
  const body={username:'199',password:'456',planId:'daily',amount:5,phone:'',requestId:'request-1234567890'};
  const response=()=>({code:200,status(code){this.code=code;return this;},json(value){this.value=value;}});
  let res=response();await handler({body},res);assert.equal(res.code,201);assert.equal(data.vouchers.length,1);
  assert.equal(data.vouchers[0].id,'imported');assert.equal(data.vouchers[0].activatedAt,100);
  res=response();await handler({body},res);assert.equal(res.code,200);assert.equal(adds,1);
  res=response();await handler({body:{...body,amount:10}},res);assert.equal(res.code,409);assert.equal(adds,1);
}
async function uiCheck() {
  const source=fs.readFileSync('src/main.js','utf8');
  const requests=[],alerts=[];
  let fail=true;
  const form={querySelectorAll:()=>[],querySelector:()=>({textContent:''})};
  const context=vm.createContext({crypto,bulkCreating:false,selectedTown:'default',pendingBulkVouchers:new Map(),
    FormData:class{*[Symbol.iterator](){yield ['planId','daily'];yield ['quantity','1'];yield ['amount','0'];yield ['phone',''];}},
    getPlan:()=>({id:'daily',name:'Daily',period:'days',duration:1}),hasRemoteApi:()=>true,
    generateShortVoucherCredentials:()=>({username:'199',password:'456'}),state:{users:[],sales:[]},persist(){},render(){},alert:m=>alerts.push(m),
    apiRequest:async(_path,opts)=>{const body=JSON.parse(opts.body);requests.push(body);if(fail)throw Error('Router timeout');return {user:{id:'voucher',...body},sales:[]};}
  });
  vm.runInContext(source.slice(source.indexOf('async function saveBulkUsers('),source.indexOf('async function deleteVoucher(')),context);
  context.event={preventDefault(){},target:form};
  await vm.runInContext('saveBulkUsers(event)',context);assert.match(alerts[0],/Confirmed 0 of 1/);assert.equal(context.pendingBulkVouchers.size,1);
  fail=false;await vm.runInContext('saveBulkUsers(event)',context);
  assert.deepEqual(requests[0],requests[1]);assert.equal(context.pendingBulkVouchers.size,0);assert.equal(context.state.users.length,1);
}
(async()=>{for(const mode of ['offline','confirmed','mismatch','unreachable'])await routerCheck(mode);await routeCheck();await uiCheck();console.log('Bulk timeout checks passed: connection failure, lost acknowledgements, mismatched verification, idempotent route, imported-user merge and retained UI retry.');})().catch(e=>{console.error(e);process.exitCode=1;});
