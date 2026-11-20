// Start an isolated Node-RED instance; no hardware, external Cloud or email is contacted.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const net = require('node:net');
const project = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parking-runtime-'));
async function main() {
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  fs.copyFileSync(path.join(project, 'node-red/flows.json'), path.join(root, 'flows.json'));
  const settings = `const base=require(${JSON.stringify(path.join(project,'node-red/settings.js'))});
  const service=require(${JSON.stringify(path.join(project,'lib/supabase-service.cjs'))}).createService({root:__dirname,env:{NODE_RED_CREDENTIAL_SECRET:'isolated-test-secret-only'}});
  module.exports={...base,uiPort:${port},functionGlobalContext:{...base.functionGlobalContext,projectRoot:__dirname,supabase:service,verifySession:req=>service.verifySession(req)}};`;
  fs.writeFileSync(path.join(root, 'settings.cjs'), settings);
  const env = { ...process.env, PORT: String(port), MQTT_HOST: '127.0.0.1', MQTT_PORT: '65534', SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '', SUPABASE_ANON_KEY: '', SUPABASE_SECRET_KEY: '', SMTP_USER: '', SMTP_PASS: '' };
  const child = spawn(process.execPath, [path.join(project,'node_modules/node-red/red.js'),'--userDir',root,'--settings',path.join(root,'settings.cjs')], {env,cwd:project,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
  try {
    const url='http://127.0.0.1:'+port;
    let ready=false;
    for(let i=0;i<100;i++){
      if(child.exitCode!==null)throw new Error('Node-RED stopped: '+log.slice(-2000));
      try{const r=await fetch(url+'/auth/login');if(r.status===200){ready=true;break;}}catch{}
      await new Promise(r=>setTimeout(r,200));
    }
    assert.ok(ready,'Node-RED routes ready');
    const page=await fetch(url+'/auth/login');assert.match(await page.text(),/confirmationRequired/);
    const dashboard=await fetch(url+'/dashboard/parking',{redirect:'manual'});assert.equal(dashboard.status,302);assert.equal(dashboard.headers.get('location'),'/auth/login');
    let response=await fetch(url+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:url},body:JSON.stringify({email:'a@example.com',password:'test-password'})});
    assert.equal(response.status,503);assert.match((await response.json()).error,/Supabase/);
    response=await fetch(url+'/auth/chat',{method:'POST',headers:{'Content-Type':'application/json',Origin:url},body:JSON.stringify({question:'Còn chỗ không?'})});assert.equal(response.status,401);
    response=await fetch(url+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://foreign.invalid'},body:'{}'});assert.equal(response.status,403);
    response=await fetch(url+'/auth/logout',{method:'POST',headers:{'Content-Type':'application/json',Origin:url},body:'{}'});assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/Max-Age=0/);
    const enginePath=url+'/dashboard/socket.io/?EIO=4&transport=polling';
    response=await fetch(enginePath);assert.equal(response.status,200);
    const handshake=await response.text();assert.ok(handshake.startsWith('0'));
    const sid=JSON.parse(handshake.slice(1)).sid;
    await fetch(enginePath+'&sid='+encodeURIComponent(sid),{method:'POST',headers:{'Content-Type':'text/plain'},body:'40'});
    response=await fetch(enginePath+'&sid='+encodeURIComponent(sid));
    assert.match(await response.text(),/Authentication required/,'Socket.IO rejects unauthenticated connections');
    assert.ok(!/Error loading|SyntaxError|Missing node types/.test(log),log.slice(-2000));
    console.log('PASS real Node-RED boot, login HTML, Dashboard HTTP/Socket.IO guards, chatbot guard, origin checks, logout, missing-config response');
  } finally {
    const done = new Promise(resolve=>child.once('exit',resolve));child.kill();await done;
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>fs.rmSync(root,{recursive:true,force:true}));
