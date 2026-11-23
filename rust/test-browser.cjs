// Browser smoke test against an already-running local Triancle server.
// Uses an isolated, temporary Edge profile; it does not touch the user's profile.
const {spawn} = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const assert = require("node:assert/strict");

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const edge = process.env.TRIANCLE_TEST_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
  const baseUrl = new URL(process.env.TRIANCLE_TEST_BASE_URL || "http://localhost:3000/");
  assert.ok(fs.existsSync(edge), "Set TRIANCLE_TEST_BROWSER to the Edge executable.");
  const response = await fetch(new URL("/healthz", baseUrl));
  assert.equal(response.status, 200, "Start the local server before running this test.");
  const tempRoot = path.resolve(os.tmpdir());
  const profile = fs.mkdtempSync(path.join(tempRoot, "triancle-browser-test-"));
  const port = await freePort();
  let browser, socket;
  try {
    browser = spawn(edge, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "about:blank"], {windowsHide:true, stdio:"ignore"});
    let version;
    for (let i=0; i<100; i++) {
      try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch (_) { await wait(100); }
    }
    assert.ok(version && version.webSocketDebuggerUrl, "Browser debugging endpoint did not start.");
    socket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve,reject) => { socket.addEventListener("open",resolve,{once:true}); socket.addEventListener("error",reject,{once:true}); });
    let id = 0; const pending = new Map(), errors = [];
    socket.addEventListener("message", event => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) { const p=pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); }
      if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.text);
    });
    const send = (method, params={}, sessionId) => new Promise((resolve,reject) => {
      const request = {id:++id,method,params}; if (sessionId) request.sessionId=sessionId;
      pending.set(request.id,{resolve,reject}); socket.send(JSON.stringify(request));
    });
    const target = await send("Target.createTarget", {url:"about:blank"});
    const attached = await send("Target.attachToTarget", {targetId:target.targetId, flatten:true});
    const session = attached.sessionId;
    await send("Runtime.enable",{},session); await send("Page.enable",{},session);
    await send("Page.navigate",{url:baseUrl.href},session);
    async function evaluate(expression) {
      const result = await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true},session);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result.value;
    }
    let loaded = false;
    for (let i=0;i<100;i++) { try { if (await evaluate(`location.origin === ${JSON.stringify(baseUrl.origin)} && document.readyState === 'complete'`)) {loaded=true;break;} } catch (_) {} await wait(100); }
    assert.ok(loaded,"The page did not finish loading.");
    await evaluate("localStorage.setItem('triancleRustPhysics','1')");
    await send("Page.reload",{},session);
    let ready = false;
    for (let i=0;i<100;i++) { try { if (await evaluate("window.TriancleRust && window.TriancleRust.status === 'ready'")) {ready=true;break;} } catch (_) {} await wait(100); }
    assert.ok(ready,"Rust bridge did not become ready in Edge.");
    const checks = await evaluate(`JSON.stringify({status:window.TriancleRust.status, username:validUsername('Player_123'), badUsername:validUsername('bad!'), chat:cleanChat(' <Hello> '), item:validItemId('01234567-89ab-cdef-0123-456789abcdef'), hue:nameColor('Player')})`);
    const result = JSON.parse(checks);
    assert.deepEqual(result,{status:"ready",username:true,badUsername:false,chat:"Hello",item:true,hue:result.hue});
    assert.match(result.hue,/^hsl\(\d+,78%,68%\)$/);
    // Run the real baseplate physics in the isolated page without logging in or
    // connecting to multiplayer. Track that the WebAssembly path is exercised.
    const gameplay = JSON.parse(await evaluate(`JSON.stringify((() => {
      const seen = {input:0,velocity:0,collision:0,builtStep:0,builtSolid:0,camera:0};
      for (const [method,key] of [['moveDirection','input'],['approach','velocity'],['boxOverlap','collision'],['stepBuiltPart','builtStep'],['builtSolid','builtSolid'],['cameraFrame','camera']]) {
        const original = window.TriancleRust[method];
        window.TriancleRust[method] = (...args) => { seen[key]++; return original(...args); };
      }
      buildWorld({id:'baseplate'});
      keys.KeyW = true;
      for (let i=0;i<120;i++) physicsStep(1/240);
      keys.KeyW = false;
      spawnPart(new THREE.Vector3(5,10,5));
      const built = userParts[userParts.length-1]; built.anchored = false;
      for (let i=0;i<120;i++) stepUserParts(1/240);
      last = performance.now(); inGame = true; frame(last+16); inGame = false;
      return {seen,position:[player.pos.x,player.pos.y,player.pos.z],alive:player.alive,builtY:built.pos.y,builtVy:built.vy};
    })())`));
    assert.ok(gameplay.alive && gameplay.position.every(Number.isFinite));
    assert.ok(gameplay.seen.input > 0 && gameplay.seen.velocity > 0 && gameplay.seen.collision > 0, JSON.stringify(gameplay));
    assert.ok(gameplay.seen.builtStep > 0 && gameplay.seen.builtSolid > 0 && Number.isFinite(gameplay.builtY) && gameplay.builtVy === 0, JSON.stringify(gameplay));
    assert.ok(gameplay.seen.camera > 0,JSON.stringify(gameplay));
    const debrisComparison = JSON.parse(await evaluate(`JSON.stringify((() => {
      const oldParts=debris.slice(), oldSolids=solids.slice(), original=window.TriancleRust.stepDebris;
      let largest=0, used=0;
      const make=(index) => ({
        g:{position:new THREE.Vector3(Math.sin(index)*2,0.5+index%5,Math.cos(index)*2),
          quaternion:new THREE.Quaternion().setFromEuler(new THREE.Euler(index*0.1,index*0.17,index*0.07))},
        v:new THREE.Vector3(Math.sin(index)*3,-index%6,Math.cos(index)*2),
        w:new THREE.Vector3(index%3,index%5*0.2,index%7*0.1),
        half:new THREE.Vector3(0.5,0.8,0.4), iinv:new THREE.Vector3(4,3,5)
      });
      const snapshot=d=>[d.g.position.x,d.g.position.y,d.g.position.z,d.g.quaternion.x,d.g.quaternion.y,d.g.quaternion.z,d.g.quaternion.w,d.v.x,d.v.y,d.v.z,d.w.x,d.w.y,d.w.z];
      try {
        solids.length=0;
        solids.push({minX:-5,minY:-1,minZ:-5,maxX:5,maxY:0,maxZ:5});
        for(let index=0;index<120;index++) {
          const run=(rust)=>{
            debris.length=0; const part=make(index); debris.push(part);
            window.TriancleRust.stepDebris=rust?((...args)=>{const result=original(...args);if(result)used++;return result;}):null;
            for(let frame=0;frame<12;frame++) stepDebris(1/120);
            return snapshot(part);
          };
          const expected=run(false), actual=run(true);
          for(let k=0;k<13;k++) largest=Math.max(largest,Math.abs(actual[k]-expected[k]));
        }
        return {largest,used};
      } finally {
        window.TriancleRust.stepDebris=original;
        debris.length=0; debris.push(...oldParts);
        solids.length=0; solids.push(...oldSolids);
      }
    })())`));
    assert.ok(debrisComparison.used > 0 && debrisComparison.largest < 1e-6,JSON.stringify(debrisComparison));
    const catalog = JSON.parse(await evaluate(`JSON.stringify((() => {
      const originalFilter = window.TriancleRust.catalogFilter, originalThumbs = fillThumbs; let calls = 0;
      window.TriancleRust.catalogFilter = (...args) => { const result = originalFilter(...args); if (result) calls++; return result; };
      fillThumbs = () => {};
      SHOP.rows = [{id:'one',name:'Red Hat',attach:'Head',creator:'a',price:10,published_at:'2026-01-01'},
                   {id:'two',name:'Blue Shirt',attach:'Shirt',creator:'a',price:5,published_at:'2026-01-01'}];
      SOC.cache.set('a',{username:'Alice'}); INV.owned = new Set();
      $('shSearch').value='red'; $('shType').value='all'; $('shAuthor').value=''; $('shMin').value=''; $('shMax').value='';
      $('shFree').checked=false; $('shOwned').checked=false; paintShop();
      const ids = [...$('shopList').querySelectorAll('.itCard')].map(el => el.dataset.id);
      fillThumbs = originalThumbs; return {calls,ids};
    })())`));
    assert.ok(catalog.calls > 0); assert.deepEqual(catalog.ids,["one"]);
    assert.deepEqual(errors,[],`Browser JavaScript exceptions: ${errors.join(", ")}`);
    console.log("Edge smoke test passed: site loaded, Rust bridge ready, helpers executed, and baseplate physics ran through Rust.");
  } finally {
    if (socket) socket.close();
    if (browser) { browser.kill(); await Promise.race([new Promise(resolve=>browser.once("exit",resolve)),wait(3000)]); }
    const resolved = path.resolve(profile);
    if (path.dirname(resolved) === tempRoot && path.basename(resolved).startsWith("triancle-browser-test-")) {
      try { fs.rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:100}); } catch (_) {}
    }
  }
})().catch(error => { console.error(error); process.exitCode=1; });
