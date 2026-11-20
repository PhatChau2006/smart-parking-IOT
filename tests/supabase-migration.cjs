const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createService } = require('../lib/supabase-service.cjs');
const { createEmailAlarm } = require('../lib/email-alarm.cjs');
const flows = require('../node-red/flows.json');
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parking-supabase-test-'));
const vars = { SUPABASE_URL: 'https://mock.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SECRET_KEY: 'sb_secret_test', NODE_RED_CREDENTIAL_SECRET: 'local-test-encryption-secret-only', COOKIE_SECURE: 'false' };
let clock = Date.now(), failDatabase = false, failAuth = false, refreshes = 0;
const records = new Map(), requests = [];
const fetchImpl = async (url, options) => {
  requests.push({ url, options });
  const u = new URL(url), body = options.body ? JSON.parse(options.body) : null;
  const reply = (value, status=200) => ({ ok: status < 400, status, text: async () => value === null ? '' : JSON.stringify(value) });
  if (u.pathname.startsWith('/rest/')) {
    assert.equal(options.headers.apikey, vars.SUPABASE_SECRET_KEY);
    assert.equal(options.headers.Authorization, undefined, 'new secret keys are not JWT bearer tokens');
    if (failDatabase) return reply({code:'offline'},503);
    if (options.method === 'POST') { if (!records.has(body.id)) records.set(body.id, body); return reply(null,201); }
    let rows=[...records.values()];
    const kind=u.searchParams.get('kind');if(kind)rows=rows.filter(x=>'eq.'+x.kind===kind);
    for(const clause of u.searchParams.getAll('received_at')){const [op,v]=clause.split('.');rows=rows.filter(x=>op==='gte'?x.received_at>=Number(v):x.received_at<=Number(v));}
    rows.sort((a,b)=>a.received_at-b.received_at||a.id.localeCompare(b.id));
    if(u.searchParams.get('order').includes('desc'))rows.reverse();
    const offset=Number(u.searchParams.get('offset')||0),limit=Number(u.searchParams.get('limit'));
    return reply(rows.slice(offset,offset+limit).map(x=>({id:x.id,payload:x.payload})));
  }
  if (u.pathname.endsWith('/signup')) return reply({ user: {id:'user-1'} });
  if (u.pathname.endsWith('/token')) {
    if(u.searchParams.get('grant_type')==='refresh_token')refreshes++;
    if(failAuth)return reply({error_code:'invalid_credentials'},400);
    return reply({access_token:'private-access-'+refreshes,refresh_token:'private-refresh-'+refreshes,expires_in:3600,user:{id:'user-1',email:'a@example.com'}});
  }
  if (u.pathname.endsWith('/user')) return failAuth?reply({},401):reply({id:'user-1',email:'a@example.com'});
  if (u.pathname.endsWith('/logout')) return reply(null,204);
  throw new Error('Unexpected request '+url);
};
const db = createService({root,env:vars,fetchImpl,now:()=>clock});
const globals = new Map([['supabase',db],['fs',fs],['path',path],['crypto',crypto],['projectRoot',root]]);
const contexts = new Map(), scope = new Map();
const store = m => ({get:k=>m.get(k),set:(k,v)=>m.set(k,v)});
async function run(id,msg={}){
  const n=flows.find(x=>x.id===id);assert.ok(n,id);
  if(!contexts.has(id))contexts.set(id,new Map());
  return new AsyncFunction('msg','node','context','flow','global','env',n.func)(msg,{status(){},warn(){},error(e){throw new Error(e);}},store(contexts.get(id)),store(scope),store(globals),{get:k=>vars[k]});
}
async function main(){
  const ids=new Set(flows.map(x=>x.id));assert.equal(ids.size,flows.length);
  for(const n of flows){
    if(n.type==='function')new AsyncFunction('msg','node','context','flow','global','env',n.func);
    for(const w of n.wires||[])for(const id of w)assert.ok(ids.has(id),'wire '+n.id+' '+id);
    for(const id of n.links||[])assert.ok(ids.has(id),'link '+id);
    for(const key of ['z','group','page','ui','theme','tls'])if(n[key])assert.ok(ids.has(n[key]),key+' '+n.id);
  }
  const {parse,compileScript,compileTemplate}=require('@vue/compiler-sfc');
  for(const n of flows.filter(x=>x.type==='ui-template'&&x.templateScope==='local')){
    const {descriptor,errors}=parse(n.format);assert.deepEqual(errors,[]);
    if(descriptor.script)compileScript(descriptor,{id:n.id});
    assert.deepEqual(compileTemplate({source:descriptor.template.content,id:n.id,filename:n.id+'.vue'}).errors,[]);
  }
  assert.ok(!JSON.stringify(flows).includes('api.telegram.org'));
  assert.ok(!flows.some(x=>x.type==='ui-gauge'));
  console.log('PASS flow wiring, Function syntax, Dashboard Vue, no Telegram/gauge');

  assert.equal(await run('sensor-validate',{payload:{slots:[1,0,0,0]}}),null);
  assert.equal(await run('sensor-validate',{retain:true,payload:{slots:[1,0,0]}}),null);
  let result=await run('sensor-validate',{payload:{slots:[1,0,-1]}});assert.equal(result[0].payload.free,1);
  result=await run('sensor-validate',{payload:{slots:[1,0,-1]}});assert.equal(result[1],null);
  globals.set('parkingState',{receivedAt:Date.now()-16000});assert.equal((await run('barrier-command',{payload:'open'}))[0],null);
  globals.set('parkingState',{slots:[1,0,0],free:2,receivedAt:Date.now()});
  assert.equal((await run('barrier-command',{payload:'open'}))[0].payload,'open');
  assert.equal(await run('temperature-validate',{payload:{temperatureC:NaN}}),null);
  assert.equal(await run('temperature-validate',{retain:true,payload:{temperatureC:50}}),null);
  result=await run('temperature-validate',{payload:{temperatureC:50,alarm:true,buzzer:true}});assert.equal(result[0].payload.alarm,true);assert.equal(result[0].payload.lcd,undefined);
  await run('temperature-validate',{payload:{sensorValid:false}});assert.equal(globals.get('temperatureState'),null);
  console.log('PASS 3 slots, invalid/retained telemetry, stale servo gating, DHT errors');

  const sample={kind:'occupancy',receivedAt:Date.now(),slots:[1,0,0]};
  await run('outbox-write',{payload:sample});failDatabase=true;await run('outbox-flush');
  const dir=path.join(root,'data/outbox');assert.equal(fs.readdirSync(dir).length,1);
  failDatabase=false;await run('outbox-flush');assert.equal(fs.readdirSync(dir).length,0);
  const first=[...records.values()][0];await db.writeEvent({id:first.id,state:sample});assert.equal(records.size,1,'retry idempotent');
  await db.writeEvent({id:'command',state:{kind:'barrier-command',receivedAt:Date.now()+1,action:'open'}});
  await db.writeEvent({id:'temp',state:{kind:'temperature',receivedAt:Date.now()+2,temperatureC:32}});
  assert.equal((await run('chart-read'))[0].payload[0].occupied,1);
  assert.equal((await run('temperature-read'))[0].payload[0].temperature,32);
  records.clear();
  const midnight=Date.UTC(2026,10,20)-7*3600000;
  await db.writeEvent({id:'baseline',state:{kind:'occupancy',receivedAt:midnight-1,slots:[0,0,0]}});
  for(let i=0;i<1001;i++)await db.writeEvent({id:'r'+String(i).padStart(4,'0'),state:{kind:'occupancy',receivedAt:midnight+i,slots:[i%2===0?1:0,0,0]}});
  const day=await db.dayHistory(midnight,midnight+2000);assert.equal(day.rows.length,1001);assert.ok(day.baseline);
  result=await run('slot-count-calculate',{payload:{...day,date:'20/11/2026'}});
  assert.equal(result[0].payload.find(x=>x.slot==='A1'&&x.direction==='Vào').count,501);
  result=await run('slot-count-calculate',{payload:{rows:[{slots:[1,0,0],receivedAt:1}],baseline:null}});assert.ok(result[0].payload.every(x=>x.count===0));
  failDatabase=true;assert.equal((await run('chart-read'))[0],null);failDatabase=false;
  result=await run('chat-cloud',{question:'Còn chỗ không?'});
  assert.equal(result[0].parkingData.recentHistory.length,30);
  vars.GEMINI_API_KEY='fake-gemini-key';
  const prompt=await run('chat-prompt',result[0]);
  assert.ok(!JSON.stringify(prompt.payload).includes(vars.SUPABASE_SECRET_KEY));
  assert.ok(!JSON.stringify(prompt.payload).includes('private-refresh'));
  assert.match(prompt.payload.systemInstruction.parts[0].text,/A1–A3/);
  console.log('PASS disk outbox retries, idempotence, typed charts, >1000/day pagination and baseline');

  assert.equal((await run('auth-prepare',{payload:{email:'bad',password:'123'}}))[1].statusCode,400);
  const signup=await db.authenticate('register','a@example.com','password');
  result=await run('auth-session',{statusCode:200,payload:signup});assert.equal(result.payload.confirmationRequired,true);assert.equal(result.headers['Set-Cookie'],undefined);
  const tokens=await db.authenticate('login','a@example.com','password');
  result=await run('auth-session',{statusCode:200,payload:tokens});assert.equal(result.payload.ok,true);assert.ok(result.headers['Set-Cookie'].includes('HttpOnly'));
  assert.ok(!JSON.stringify(result.payload).includes('private-'));
  const cookie=result.headers['Set-Cookie'].split(';')[0];const req={headers:{cookie}};
  assert.equal((await db.verifySession(req)).uid,'user-1');
  const files=fs.readdirSync(path.join(root,'data/sessions'));assert.ok(!fs.readFileSync(path.join(root,'data/sessions',files[0]),'utf8').includes('private-access'));
  clock+=3550000;await Promise.all([db.verifySession(req),db.verifySession(req)]);assert.equal(refreshes,1,'concurrent refresh serialized');
  await db.logout(req);await assert.rejects(()=>db.verifySession(req));
  await assert.rejects(()=>db.verifySession({headers:{}}));
  const session=db.createSession(tokens);clock+=8*3600000+1;await assert.rejects(()=>db.verifySession({headers:{cookie:'parking_session='+session.id}}));
  globals.set('verifySession',req=>db.verifySession(req));
  result=await run('chat-session',{req:{headers:{}},payload:{question:'Còn chỗ?'}});assert.equal(result[1].statusCode,401);
  console.log('PASS signup confirmation, HttpOnly encrypted persistent sessions, refresh, expiry, logout, chatbot auth');

  let sends=0,failMail=true;
  const mailEnv={SMTP_USER:'a@example.com',SMTP_PASS:'app-password',ALERT_TO:'b@example.com'};
  const mailer={createTransport:()=>({sendMail:async m=>{sends++;assert.match(m.text,/50/);if(failMail)throw new Error('offline');return {accepted:['b@example.com'],rejected:[]};},close(){}})};
  const email=()=>createEmailAlarm({root,env:mailEnv,mailer,now:()=>clock});let alarm=email();
  const high=()=>({temperatureC:50,alarm:true,receivedAt:clock});
  alarm.observe(high());assert.equal((await alarm.deliver(high())).ok,false);
  assert.equal(await alarm.deliver(high()),null);clock+=30001;failMail=false;assert.equal((await alarm.deliver(high())).ok,true);
  alarm=email();alarm.observe(high());assert.equal(await alarm.deliver(high()),null,'restart keeps duplicate suppression');
  alarm.observe({alarm:false});alarm.observe(high());clock+=30001;
  assert.equal(await alarm.deliver({...high(),receivedAt:clock-16000}),null,'no stale alarms');
  await alarm.deliver(high());assert.equal(sends,3);
  console.log('PASS Gmail retry, cooldown, no duplicate per episode across restart, rearm, stale suppression');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>fs.rmSync(root,{recursive:true,force:true}));
