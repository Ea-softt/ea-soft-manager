const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('src/main.js','utf8');
async function main(){
 const context=vm.createContext({crypto:require('node:crypto').webcrypto,URL,console,setInterval(){},setTimeout(){},
  window:{location:{protocol:'https:',host:'example.test',hostname:'example.test'}},
  document:{hidden:false,querySelector:s=>s==='#app'?{}:s==='#admin-login-form'?{elements:{email:{}},addEventListener(){}}:s==='#login-mode'?{}:null,querySelectorAll:()=>[],addEventListener(){}},
  localStorage:{getItem:()=>null,setItem(){}},Capacitor:{isNativePlatform:()=>false},registerPlugin:()=>({}),createIcons(){}});
 for(const name of source.match(/import \{ (.*?) \} from 'lucide'/)[1].split(', '))if(name!=='createIcons')context[name]={};
 vm.runInContext(source.replace(/^import .*;\r?\n/gm,''),context);
 vm.runInContext("render=()=>{};authenticated=true;selectedTown='north';activeView='operations';performApiRequest=async(path)=>({path});",context);
 const routed=await vm.runInContext("apiRequest('/api/admin/operations?q=199')",context);
 assert.equal(routed.path,'/api/towns/north/admin/operations?q=199');
 context.fixture={router:{resources:{},clock:{},sessions:0},alerts:[{message:'<script>unsafe</script>'}],customers:[{id:'v',username:'199',phone:'0241234567',status:'active',connected:false,dataConsumedBytes:0,dataLimit:17,events:[],sales:[]}],payments:[],expenses:[],requests:[],audit:[],profit:{revenue:10,expenses:2,net:8},localActions:true};
 vm.runInContext('operationsData=fixture;',context);
 const html=vm.runInContext('renderOperations()',context);
 assert.ok(html.includes('&lt;script&gt;unsafe&lt;/script&gt;'));assert.ok(!html.includes('<script>unsafe'));
 assert.ok(html.includes('Customer troubleshooting'));assert.ok(html.includes('Expenses &amp; profit')||html.includes('Expenses & profit'));
 vm.runInContext("operationCustomer='v';",context);
 assert.ok(vm.runInContext('renderOperations()',context).includes('replace-credentials'));
 let release;
 context.delayed=()=>new Promise(resolve=>{release=resolve;});
 vm.runInContext("operationsData=null;apiRequest=delayed;",context);
 const loading=vm.runInContext('loadOperations()',context);
 vm.runInContext('authGeneration++;authenticated=false;operationsData=null;',context);
 release(context.fixture);await loading;
 assert.equal(vm.runInContext('operationsData',context),null);
 console.log('Operations UI passed: selected-town query routing, output escaping, lifecycle controls and late-response privacy.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
