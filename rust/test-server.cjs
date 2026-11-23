const assert = require("node:assert/strict");
const {spawn} = require("node:child_process");
const net = require("node:net");
const path = require("node:path");

const root = path.join(__dirname,"..");
const exe = path.join(__dirname,"triancle-server","target","debug","triancle-server.exe");
const wait = ms => new Promise(resolve => setTimeout(resolve,ms));
async function freePort() {
  const server=net.createServer();
  await new Promise((resolve,reject)=>server.once("error",reject).listen(0,"127.0.0.1",resolve));
  const port=server.address().port;
  await new Promise(resolve=>server.close(resolve));
  return port;
}
function open(url) {
  return new Promise((resolve,reject)=>{
    const ws=new WebSocket(url), messages=[];
    ws.addEventListener("message",event=>messages.push(JSON.parse(event.data)));
    ws.addEventListener("open",()=>resolve({ws,messages}));
    ws.addEventListener("error",reject,{once:true});
  });
}
async function next(client,predicate) {
  for(let attempt=0;attempt<100;attempt++) {
    const found=client.messages.find(predicate);
    if(found)return found;
    await wait(20);
  }
  throw new Error("WebSocket message did not arrive");
}

(async()=>{
  const port=await freePort();
  const child=spawn(exe,[],{cwd:root,env:{...process.env,PORT:String(port),HOST:"127.0.0.1"},windowsHide:true,stdio:["ignore","pipe","pipe"]});
  try {
    let health;
    for(let attempt=0;attempt<100;attempt++) {
      try { health=await fetch(`http://127.0.0.1:${port}/healthz`); break; } catch (_) { await wait(25); }
    }
    assert.equal(await health.text(),"ok");
    const rootResponse=await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(rootResponse.status,200);
    assert.match(rootResponse.headers.get("content-type"),/^text\/html/);
    assert.match(await rootResponse.text(),/Triancle/i);
    const etag=rootResponse.headers.get("etag");
    assert.match(etag,/^"[0-9a-f]{20}"$/);
    assert.equal(rootResponse.headers.get("cache-control"),"no-cache");
    assert.equal((await fetch(`http://127.0.0.1:${port}/`,{headers:{"If-None-Match":etag}})).status,304);
    const head=await fetch(`http://127.0.0.1:${port}/`,{method:"HEAD"});
    assert.equal(head.status,200);
    assert.equal(await head.text(),"");
    const wasm=await fetch(`http://127.0.0.1:${port}/js/core/triancle_core.wasm`);
    assert.equal(wasm.headers.get("content-type"),"application/wasm");
    assert.equal(wasm.headers.get("cache-control"),"public, max-age=3600");
    assert.equal((await fetch(`http://127.0.0.1:${port}/server.js`)).status,404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/%2e%2e/server.js`)).status,404);

    const one=await open(`ws://127.0.0.1:${port}`);
    const two=await open(`ws://127.0.0.1:${port}`);
    one.ws.send(JSON.stringify({t:"join",name:"Alice",colors:{Head:"#fff"},items:["hat"]}));
    const welcomeOne=await next(one,m=>m.t==="welcome");
    assert.equal(welcomeOne.players.length,0);
    two.ws.send(JSON.stringify({t:"join",name:"Bob",colors:{Head:"#000"},items:[]}));
    const welcomeTwo=await next(two,m=>m.t==="welcome");
    assert.equal(welcomeTwo.players[0].name,"Alice");
    const join=await next(one,m=>m.t==="join");
    assert.equal(join.name,"Bob");
    two.ws.send(JSON.stringify({t:"s",id:"forged",x:1,y:2,z:3}));
    const state=await next(one,m=>m.t==="s");
    assert.equal(state.id,welcomeTwo.id);
    const three=await open(`ws://127.0.0.1:${port}`);
    three.ws.send(JSON.stringify({t:"join",name:""}));
    const welcomeThree=await next(three,m=>m.t==="welcome");
    const bob=welcomeThree.players.find(player=>player.id===welcomeTwo.id);
    assert.equal(bob.s.id,welcomeTwo.id);
    const joinThree=await next(one,m=>m.t==="join"&&m.id===welcomeThree.id);
    assert.equal(joinThree.name,"Player");
    assert.equal(Object.hasOwn(joinThree,"colors"),false);
    assert.equal(Object.hasOwn(joinThree,"items"),false);
    one.ws.send(JSON.stringify({t:"chat",text:"hello",id:"forged"}));
    const chat=await next(two,m=>m.t==="chat");
    assert.equal(chat.id,welcomeOne.id);
    assert.equal(chat.text,"hello");
    three.ws.close();
    assert.equal((await next(one,m=>m.t==="leave"&&m.id===welcomeThree.id)).id,welcomeThree.id);
    two.ws.close();
    assert.equal((await next(one,m=>m.t==="leave"&&m.id===welcomeTwo.id)).id,welcomeTwo.id);
    one.ws.close();
    console.log("Rust server compatibility test passed: HTTP/HEAD, caching, public paths, WASM MIME, and WebSocket relay state.");
  } finally {
    child.kill();
    await Promise.race([new Promise(resolve=>child.once("exit",resolve)),wait(3000)]);
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
