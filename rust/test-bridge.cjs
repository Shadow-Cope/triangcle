// Exercise the real bridge and WASM in Node without relying on a live backend.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "js/core/rust-bridge.js"), "utf8");
const bytes = fs.readFileSync(path.join(root, "js/core/triancle_core.wasm"));

async function load(enabled, fail = false) {
  const context = {
    window: {}, localStorage: { getItem: () => enabled ? "1" : null },
    fetch: async () => fail ? { ok: false, status: 404 } : { ok: true, arrayBuffer: async () => bytes },
    WebAssembly, Uint8Array, TextEncoder, TextDecoder, Object, Map, Set, console: { warn() {} },
  };
  vm.runInNewContext(source, context);
  for (let i = 0; i < 100 && context.window.TriancleRust.status === "loading"; i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  return context.window.TriancleRust;
}

function reference(v, tx, tz, delta) {
  const dx = tx - v.x, dz = tz - v.z, length = Math.hypot(dx, dz);
  if (length <= delta || length === 0) return { x: tx, z: tz };
  return { x: v.x + dx / length * delta, z: v.z + dz / length * delta };
}

(async () => {
  assert.equal((await load(false)).status, "disabled");
  const unavailable = await load(true, true);
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.approach, null);
  const bridge = await load(true);
  assert.equal(bridge.status, "ready");
  const bundle = fs.readFileSync(path.join(root, "js/game.bundle.js"), "utf8");
  assert.equal(bridge.itemAction(false,false,false),0);
  assert.equal(bridge.itemAction(true,false,false),1);
  assert.equal(bridge.itemAction(true,true,false),2);
  assert.equal(bridge.itemAction(true,true,true),3);
  for (const [message,code,inventory,catalog] of [
    ["insufficient_funds",1,false,false],
    ["already_owned",2,true,false],
    ["price_changed",3,false,true],
    ["not_for_sale",4,false,true],
    ["own_item",5,false,false],
    ["not_logged_in",6,false,false],
    ["unknown",0,false,false],
    ["already_owned price_changed",2,true,true]
  ]) assert.equal(JSON.stringify(bridge.purchaseError(message)),JSON.stringify({code,inventory,catalog}));
  assert.equal(bridge.itemEditCheck(0,50,true,50),1);
  assert.equal(bridge.itemEditCheck(4,NaN,true,50),2);
  assert.equal(bridge.itemEditCheck(4,4,true,50),3);
  assert.equal(bridge.itemEditCheck(4,50,true,50),0);
  const acceptedFriends = [
    {requester:"me",addressee:"a"},
    {requester:"b",addressee:"me"},
    {requester:"me",addressee:"a"}
  ];
  const groupedFriends = bridge.socialLists("me",acceptedFriends.map(row => ({...row,status:"accepted"})));
  assert.deepEqual(Array.from(groupedFriends.friends),acceptedFriends.map(row => row.requester === "me" ? row.addressee : row.requester));
  const goodId = "12345678-1234-abcd-ABCD-1234567890ab";
  assert.deepEqual(Array.from(bridge.wornIds(["invalid",goodId,goodId],1)),[goodId]);
  assert.deepEqual(Array.from(bridge.wornIds(["invalid"],5)),[]);
  assert.equal(bridge.wornIds([{}],5),null);
  const gameCodeStart=bundle.indexOf("const okImg = v =>");
  const gameCodeEnd=bundle.indexOf("function renderGames()",gameCodeStart);
  assert.ok(gameCodeStart > 0 && gameCodeEnd > gameCodeStart);
  const gameCode=bundle.slice(gameCodeStart,gameCodeEnd)+"\napplyGameRow";
  function gameFixture(rust,row) {
    const game={id:"baseplate",ovr:{},def:{}};
    const apply=vm.runInNewContext(gameCode,{window:rust?{TriancleRust:bridge}:{},GAMES:[game]});
    apply("baseplate",row);
    return JSON.stringify({override:game.ovr,mode:game.btools || null});
  }
  for (const row of [
    {},{name:"Hello",by:"Alice",about:"Text",btools:"staff"},
    {name:" <Hat> ",by:"A\u0001B",about:"  About  ",btools:"off"},
    {name:"x".repeat(80),by:"y".repeat(50),about:"z".repeat(620),btools:"bad"},
    {name:"Étoile",by:"Zed",thumb:"data:image/png;base64,AA=="},
    {name:"Map",thumb:"data:image/png;base64,AA==",icon:"data:image/webp;base64,ABCD"},
    {name:"Map",thumb:"javascript:alert(1)",icon:"data:image/png;base64,"},
  ]) assert.deepEqual(JSON.parse(gameFixture(true,row)),JSON.parse(gameFixture(false,row)),JSON.stringify(row));
  for (const mode of ["all","staff","off"]) for (const signedIn of [false,true]) for (const owner of [false,true]) for (const admin of [false,true]) {
    const expected=mode==="off"?false:mode==="staff"?signedIn&&(owner||admin):true;
    assert.equal(bridge.canBuild(mode,signedIn,owner,admin),expected);
  }
  const badgePermissions={owner:{can_ugc:true,can_edit_items:true},ugc:{can_ugc:true},custom:{can_edit_items:true}};
  for (const email of ["owen@example.org","user@example.org"]) for (const badges of [[],["ugc"],["custom"],["owner"]]) for (const mode of ["owner","can_ugc","can_edit_items"]) {
    const owner=email.toLowerCase()==="owen@example.org" || badges.includes("owner");
    const expected=mode==="owner" ? owner : owner || badges.some(name=>mode==="can_ugc" && name==="ugc" || !!badgePermissions[name]?.[mode]);
    assert.equal(bridge.accountPermission(email,"example.org",badges,badgePermissions,mode),expected);
  }
  for (const [kind,valid,invalid] of [
    ["glb",[0x67,0x6c,0x54,0x46],[0x67,0x6c,0x54,0]],
    ["png",[0x89,0x50,0x4e,0x47],[0x89,0x50,0x4e,0]]
  ]) {
    assert.equal(bridge.assetSignature(Uint8Array.from(valid).buffer,kind),true);
    assert.equal(bridge.assetSignature(Uint8Array.from(invalid).buffer,kind),false);
    assert.equal(bridge.assetSignature(new ArrayBuffer(0),kind),false);
  }
  // Include stationary, exact-target, reversal, diagonal and many fractional inputs.
  const cases = [[0, 0, 0, 0, 0], [0, 0, 3, 4, 5], [2, 0, -2, 0, 1]];
  for (let i = 0; i < 1000; i++) cases.push([Math.sin(i)*9, Math.cos(i)*7, Math.cos(i/3)*8, Math.sin(i/5)*6, (i%20)/7]);
  for (const [x, z, tx, tz, delta] of cases) {
    const actual = { x, z }, expected = reference(actual, tx, tz, delta);
    bridge.approach(actual, tx, tz, delta);
    assert.ok(Math.abs(actual.x - expected.x) < 1e-12 && Math.abs(actual.z - expected.z) < 1e-12);
  }
  for (let yawStep = -30; yawStep <= 30; yawStep++) {
    const yaw = yawStep * 0.23;
    for (let forward = -1; forward <= 1; forward++) for (let right = -1; right <= 1; right++) {
      let x = -Math.sin(yaw) * forward + Math.cos(yaw) * right;
      let z = -Math.cos(yaw) * forward - Math.sin(yaw) * right;
      const length = Math.hypot(x, z);
      if (length > 1) { x /= length; z /= length; }
      const actual = bridge.moveDirection(yaw, forward, right);
      assert.ok(Math.abs(actual[0] - x) < 1e-12 && Math.abs(actual[1] - z) < 1e-12);
    }
  }
  // Evaluate the actual live overlap function with and without the Rust bridge.
  const start = bundle.indexOf("function overlaps(p, b) {");
  const end = bundle.indexOf("/* push the player", start);
  assert.ok(start >= 0 && end > start);
  const physics = vm.runInNewContext(bundle.slice(start, end) + "\n({ overlaps })", {
    window: { TriancleRust: bridge }, CFG: { CHAR_HALF_XZ: 1, CHAR_HEIGHT: 5 },
  });
  const original = vm.runInNewContext(bundle.slice(start, end) + "\n({ overlaps })", {
    window: {}, CFG: { CHAR_HALF_XZ: 1, CHAR_HEIGHT: 5 },
  });
  const solids = [
    { minX: -1, maxX: 1, minY: 0, maxY: 2, minZ: -1, maxZ: 1 },
    { minX: -2, maxX: 2, minY: -2, maxY: 2, minZ: -2, maxZ: 2, ball: { cx: 0, cy: 0, cz: 0, r: 2 } },
  ];
  const points = [{x: 2, y: 0, z: 0}, {x: 1.999, y: 0, z: 0}, {x: 0, y: 2, z: 0}, {x: 0, y: -5, z: 0}];
  for (let i = 0; i < 2000; i++) points.push({x: Math.sin(i * 1.3)*4, y: Math.cos(i * 0.7)*8, z: Math.sin(i * 0.3)*4});
  for (const p of points) for (const b of solids) {
    assert.equal(physics.overlaps(p, b), original.overlaps(p, b), JSON.stringify({p, b}));
  }
  // Compare the live collision response as well, including stationary contact.
  const responseEnd = bundle.indexOf("function exitClimb(", start);
  assert.ok(responseEnd > start);
  function responseContext(rust, p, b) {
    const player = { pos: {...p}, vel: {x: 1, y: 0, z: 1}, climb: {}, onGround: true,
      groundT: 0, moveX: 0, moveZ: 0, stepOff: 0 };
    const context = { window: rust ? {TriancleRust: bridge} : {}, player, solids: [b],
      CFG: { CHAR_HALF_XZ: 1, CHAR_HEIGHT: 5, STEP_HEIGHT: -1, CLIMB_MAX_SIZE: 3, AUTOJUMP_MAX: 5 } };
    const api = vm.runInNewContext(bundle.slice(start, responseEnd) + "\n({ resolveHorizontal })", context);
    return {player, api};
  }
  let responses = 0;
  for (const p of points) for (const b of solids) for (const axis of ["x", "z"]) for (const delta of [-1, 0, 1]) {
    if (!original.overlaps(p, b)) continue;
    const expected = responseContext(false, p, b), actual = responseContext(true, p, b);
    expected.api.resolveHorizontal(axis, delta);
    actual.api.resolveHorizontal(axis, delta);
    for (const key of ["x", "y", "z"]) {
      assert.ok(Math.abs(actual.player.pos[key] - expected.player.pos[key]) < 1e-12);
      assert.equal(actual.player.vel[key], expected.player.vel[key]);
    }
    responses++;
  }
  let verticals = 0;
  const nearest = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  for (const p of points) for (const vy of [-5, 0, 5]) {
    const q = solids[1].ball;
    const dx = nearest(q.cx, p.x - 1, p.x + 1) - q.cx;
    const dz = nearest(q.cz, p.z - 1, p.z + 1) - q.cz;
    const ry = Math.sqrt(Math.max(0, q.r*q.r - dx*dx - dz*dz));
    const expected = vy <= 0 ? q.cy + ry : q.cy - ry - 5;
    assert.ok(Math.abs(bridge.sphereVertical(p.x, p.z, 1, 5, q.cx, q.cy, q.cz, q.r, vy) - expected) < 1e-12);
    assert.equal(bridge.boxVertical(-2, 2, 5, vy), vy <= 0 ? 2 : -7);
    verticals += 2;
  }
  const colors = [null, 42, "", "#ABCDEF", "#123456", "#abcdef\n", "#000000\r\n", "#12345g", "#１２３４５６", "#fffff"];
  for (let i = 0; i < 512; i++) colors.push("#" + i.toString(16).padStart(6, "0"));
  for (let code = 0; code < 256; code++) colors.push("#00000" + String.fromCharCode(code));
  for (const color of colors) assert.equal(bridge.validColor(color), typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color), JSON.stringify(color));
  const sanitizeStart = bundle.indexOf("function sanitizeColors(o) {");
  const sanitizeEnd = bundle.indexOf("const colorSig",sanitizeStart);
  assert.ok(sanitizeStart >= 0 && sanitizeEnd > sanitizeStart);
  const sanitizeCode = bundle.slice(sanitizeStart,sanitizeEnd) + "\nsanitizeColors";
  const partNames = ["Head","Torso","LeftArm","RightArm","LeftLeg","RightLeg"];
  const defaults = Object.fromEntries(partNames.map((name,i)=>[name,"#"+(i*12345).toString(16).padStart(6,"0")]));
  const sanitizeJs = vm.runInNewContext(sanitizeCode,{window:{},PART_ORDER:partNames,DEFAULT_COLORS:defaults,HEX_RE:/^#[0-9a-f]{6}$/i});
  let sanitizeRuns = 0;
  const sanitizeBridge = {...bridge,sanitizeColors:(...args)=>{const v=bridge.sanitizeColors(...args);if(v)sanitizeRuns++;return v;}};
  const sanitizeRust = vm.runInNewContext(sanitizeCode,{window:{TriancleRust:sanitizeBridge},PART_ORDER:partNames,DEFAULT_COLORS:defaults,HEX_RE:/^#[0-9a-f]{6}$/i});
  const avatarCases = [null,undefined,{}, {Head:"#ABCDEF",Torso:"#12345g",face:42,body:"female"}, {face:-0}, {face:100000,body:"FEMALE"}, {Head:null,face:NaN}, []];
  for (let i=0;i<1000;i++) avatarCases.push({Head:"#"+(i*17011%0xffffff).toString(16).padStart(6,"0"),face:i%100001,body:i%2?"female":"male"});
  for (const value of avatarCases) assert.equal(JSON.stringify(sanitizeRust(value)),JSON.stringify(sanitizeJs(value)));
  assert.ok(sanitizeRuns >= 1000);
  let climbs = 0;
  for (let i = -1000; i <= 1000; i++) {
    const t = i / 1000, yaw = i / 137;
    assert.ok(Math.abs(bridge.climbEase(t) - t*t*(3-2*t)) < 1e-12);
    for (const right of [-1, 0, 1]) for (const [tx, tz] of [[1, 0], [0, 1]]) {
      const expected = right ? Math.cos(yaw)*right*tx - Math.sin(yaw)*right*tz : 0;
      assert.ok(Math.abs(bridge.climbShimmy(yaw, right, tx, tz) - expected) < 1e-12);
      climbs++;
    }
  }
  for (const up of [false, true]) for (const down of [false, true]) {
    assert.equal(bridge.climbDelta(up, down, 1/240), ((up ? 1 : 0) - (down ? 1 : 0))*12/240);
  }
  const hsvStart = bundle.indexOf("function hsv2rgb(h, s, v) {");
  const hsvEnd = bundle.indexOf("function hsvToHex", hsvStart);
  assert.ok(hsvStart >= 0 && hsvEnd > hsvStart);
  const hsvOriginal = vm.runInNewContext(bundle.slice(hsvStart, hsvEnd) + "\nhsv2rgb", {window: {}});
  const hsvRust = vm.runInNewContext(bundle.slice(hsvStart, hsvEnd) + "\nhsv2rgb", {window: {TriancleRust: bridge}});
  let hsvCases = 0;
  for (let hue = 0; hue <= 360; hue += 2) for (let sat = 0; sat <= 10; sat++) for (let value = 0; value <= 10; value++) {
    const args = [hue, sat / 10, value / 10];
    assert.deepEqual(Array.from(hsvRust(...args)), Array.from(hsvOriginal(...args)), JSON.stringify(args));
    hsvCases++;
  }
  for (const args of [[-1,1,1], [361,1,1], [0,2,1], [NaN,1,1]]) {
    assert.deepEqual(Array.from(hsvRust(...args)), Array.from(hsvOriginal(...args)));
  }
  const hexStart = bundle.indexOf("function hexToHsv(hex) {");
  const hexEnd = bundle.indexOf("function drawWheel()", hexStart);
  assert.ok(hexStart >= 0 && hexEnd > hexStart);
  const hexCode = bundle.slice(hexStart, hexEnd) + "\nhexToHsv";
  const hsvFromJs = vm.runInNewContext(hexCode, {window: {}});
  const hsvFromRust = vm.runInNewContext(hexCode, {window: {TriancleRust: bridge}});
  for (let r = 0; r < 256; r += 17) for (let g = 0; g < 256; g += 17) for (let b = 0; b < 256; b += 17) {
    const color = "#" + [r, g, b].map(x => x.toString(16).padStart(2, "0")).join("");
    const expected = hsvFromJs(color), actual = hsvFromRust(color);
    for (const k of ["h", "s", "v"]) assert.ok(Math.abs(actual[k] - expected[k]) < 1e-12, color);
  }
  const feeStart = bundle.indexOf("function kindOfItem(a)");
  const feeEnd = bundle.indexOf("function fmtN(", feeStart);
  assert.ok(feeStart >= 0 && feeEnd > feeStart);
  const feeCode = bundle.slice(feeStart, feeEnd) + "\n({kindOfItem, uploadFee, minPrice, listFee, creatorShare})";
  const jsFees = vm.runInNewContext(feeCode, {window: {}});
  const rustFees = vm.runInNewContext(feeCode, {window: {TriancleRust: bridge}});
  for (let i = -100; i <= 10000; i++) for (const type of ["Face", "Shirt", "Hat"]) {
    const price = i * 99.99;
    assert.ok(Object.is(rustFees.listFee(price, type), jsFees.listFee(price, type)));
    assert.ok(Object.is(rustFees.creatorShare(price), jsFees.creatorShare(price)));
  }
  for (const price of [0, -0, NaN, Infinity, -Infinity, "12.5", "abc", null]) {
    assert.ok(Object.is(rustFees.listFee(price, "Hat"), jsFees.listFee(price, "Hat")));
  }
  for (const item of ["Shirt", "Pants", "Face", "Hat", "shirt", "", null, undefined, 42, "😺", new String("Shirt")]) {
    assert.equal(rustFees.kindOfItem(item), jsFees.kindOfItem(item));
    assert.equal(rustFees.uploadFee(item), jsFees.uploadFee(item));
    assert.equal(rustFees.minPrice(item), jsFees.minPrice(item));
  }
  const uploadStart = bundle.indexOf("async function ugUpload() {");
  const uploadEnd = bundle.indexOf("async function renderUgcList()",uploadStart);
  assert.ok(uploadStart >= 0 && uploadEnd > uploadStart);
  const uploadCode = bundle.slice(uploadStart,uploadEnd) + "\nugUpload";
  async function uploadFixture(rust, overrides) {
    const events=[], UG={busy:false,name:"Test",attach:"Head",cloth:null,holder:{},sale:true,editId:null,published:false,livePrice:0,path:null,file:null,pos:[0,0,0],rot:[0,0,0],scale:1,...overrides.ug};
    const WAL={bal:overrides.balance === undefined ? 1000 : overrides.balance};
    let basics=0,prices=0,funds=0,changes=0,plans=0;
    const custom={...bridge,
      ugcUploadPlan:(...a)=>{plans++;return bridge.ugcUploadPlan(...a);},
      ugcBasics:(...a)=>{basics++;return bridge.ugcBasics(...a);},
      ugcPriceInvalid:(...a)=>{prices++;return bridge.ugcPriceInvalid(...a);},
      ugcInsufficient:(...a)=>{funds++;return bridge.ugcInsufficient(...a);},
      ugcSaleChanged:(...a)=>{changes++;return bridge.ugcSaleChanged(...a);}};
    const sb={
      storage:{from:()=>({upload:async()=>{events.push("upload");return {error:null};},remove:async()=>{events.push("remove");return {error:null};}})},
      from:()=>({insert:async()=>{events.push("insert");return {error:null};},update:()=>({eq:async()=>{events.push("update");return {error:null};}})}),
      rpc:async(_name,args)=>{events.push(["sale",args.p_price,args.p_published]);return {error:overrides.saleError?{message:"not_allowed"}:null};},
    };
    const fn=vm.runInNewContext(uploadCode,{window:rust?{TriancleRust:custom}:{},UG,WAL,TAX_MAX:1000000,acct:{user:{id:"user"}},getSB:()=>sb,canUgc:()=>true,
      isCloth:a=>a==="Shirt"||a==="Pants",ugMsg:(...args)=>events.push(["message",...args]),ugClamp:(v,a,b)=>Math.max(a,Math.min(b,v)),
      $:()=>({value:String(overrides.price === undefined ? 50 : overrides.price)}),minPrice:a=>a==="Shirt"?5:50,fmtT:String,
      kindOfItem:a=>a==="Shirt"?"cloth":"acc",uploadFee:a=>a==="Shirt"?5:150,
      ugCost:()=>{const price=overrides.price === undefined ? 50 : overrides.price;const fee=UG.sale && (!UG.published || price !== UG.livePrice) ? Math.ceil(price*0.15):0;return (UG.editId?0:UG.attach==="Shirt"?5:150)+fee;},
      ugFeeNote:()=>events.push("fee"),crypto:{randomUUID:()=>"new-id"},renderUgcList:()=>events.push("render"),loadWallet:()=>events.push("wallet"),loadNotifs:()=>events.push("notifs"),
      ugSync:()=>events.push("sync"),ugClear:()=>events.push("clear"),refreshWorn:()=>events.push("refresh"),feeErr:()=>"fee error",console:{error:()=>{}}});
    await fn(); return {events,busy:UG.busy,price:UG.price,editId:UG.editId,published:UG.published,livePrice:UG.livePrice,basics,prices,funds,changes,plans};
  }
  const uploadCases=[
    {ug:{holder:null}},{ug:{name:" "}},{price:1},{balance:0,total:20},
    {price:50,total:20},{ug:{sale:false},price:50,total:0},
    {ug:{editId:"existing",published:true,livePrice:50},price:50,total:0},
    {ug:{editId:"existing",published:true,livePrice:50,sale:false},price:50,total:0},
    {ug:{attach:"Shirt",cloth:{},holder:null},price:5,total:5},
    {price:50,total:20,saleError:true},
  ];
  for (const opts of uploadCases) {
    const old=await uploadFixture(false,opts), modern=await uploadFixture(true,opts);
    assert.equal(modern.plans,1);
    for (const field of ["basics","prices","funds","changes","plans"]) {delete old[field];delete modern[field];}
    assert.equal(JSON.stringify(modern),JSON.stringify(old));
  }
  // Exercise the actual equip flow, including RPC order and a changing inventory.
  const equipStart = bundle.indexOf("async function equipItem(id, on) {");
  const equipEnd = bundle.indexOf("/* ---- js/items/shop.js ---- */", equipStart);
  assert.ok(equipStart >= 0 && equipEnd > equipStart);
  const equipCode = bundle.slice(equipStart,equipEnd) + "\nequipItem";
  async function equipFixture(rust, target, on, fail) {
    const calls=[], rows=new Map([["new",{attach:"Shirt"}],["old",{attach:"Shirt"}],["pants",{attach:"Pants"}]]), owned=new Set();
    const sb={rpc:async (_name,args)=>{ calls.push([args.p_item,args.p_on]); return {error:args.p_item === fail ? {message:"not_owned"}:null,data:["new"]}; }};
    let runs=0, worn=null;
    const api={...bridge,equipConflicts:(...args)=>{runs++;return bridge.equipConflicts(...args);}};
    const fn=vm.runInNewContext(equipCode,{window:rust?{TriancleRust:api}:{},getSB:()=>sb,acct:{user:{id:"me"}},ITM:{rows},WEAR:{mine:["old","pants","new"]},INV:{owned},isCloth:x=>x === "Shirt" || x === "Pants",setMyItems:x=>{worn=x;},MAX_WORN:5,SQL_HINT:"SQL"});
    const result=await fn(target,on); return {calls,worn,result,owned:[...owned],runs};
  }
  for (const [target,on,fail] of [["new",true,null],["new",false,null],["pants",true,null],["new",true,"old"],["unknown",true,null]]) {
    const old=await equipFixture(false,target,on,fail), modern=await equipFixture(true,target,on,fail);
    if (on && target === "new") assert.ok(modern.runs > 0);
    delete old.runs; delete modern.runs; assert.equal(JSON.stringify(modern),JSON.stringify(old));
  }
  const badgeLoadStart = bundle.indexOf("async function getBadges(ids) {");
  const badgeLoadEnd = bundle.indexOf("const badgeList",badgeLoadStart);
  assert.ok(badgeLoadStart >= 0 && badgeLoadEnd > badgeLoadStart);
  const badgeLoadCode = bundle.slice(badgeLoadStart,badgeLoadEnd) + "\ngetBadges";
  async function badgeLoadFixture(rust, rows, fail) {
    const SOC={badges:new Map([["old",["mod"]],["me",["old"]]]),badgeOK:false}; let calls=0;
    const sb={from:()=>({select:()=>({in:async()=>({data:rows,error:fail?{}:null})})})};
    const api={...bridge,groupBadges:(...args)=>{calls++;return bridge.groupBadges(...args);}};
    const fn=vm.runInNewContext(badgeLoadCode,{window:rust?{TriancleRust:api}:{},getSB:()=>sb,SOC,BADGES:{owner:"Owner",mod:"Moderator"}});
    await fn(["me","friend","me"]); return {badges:[...SOC.badges],ok:SOC.badgeOK,calls};
  }
  for (const [rows,fail] of [
    [[{user_id:"me",badge:"owner"},{user_id:"friend",badge:"mod"},{user_id:"me",badge:"owner"},{user_id:"old",badge:"mod"},{user_id:"unknown",badge:"owner"},{user_id:"me",badge:"missing"}],false],
    [[],false], [[{user_id:"me",badge:"owner"}],true]
  ]) {
    const old=await badgeLoadFixture(false,rows,fail), modern=await badgeLoadFixture(true,rows,fail);
    if (!fail) assert.equal(modern.calls,1);
    delete old.calls; delete modern.calls; assert.equal(JSON.stringify(modern),JSON.stringify(old));
  }
  const renameStart = bundle.indexOf("async function saveUsername() {");
  const renameEnd = bundle.indexOf("/* ---- js/ui/menu.js ---- */",renameStart);
  assert.ok(renameStart >= 0 && renameEnd > renameStart);
  const renameCode = bundle.slice(renameStart,renameEnd) + "\nsaveUsername";
  async function renameFixture(rust, opts) {
    const nodes={sUserMsg:{textContent:""},sUserSave:{disabled:false},sUser:{value:opts.value}};
    const acct={username:opts.current,user:{id:"me"}}, cache=new Map([["me",{username:opts.current}]]), calls=[];
    const sb={rpc:async (_name,args)=>{calls.push(args.p_new);return opts.error ? {error:{message:opts.error}} : {data:{username:args.p_new}};}};
    let checks=0;
    const api={...bridge,renameCheck:(...args)=>{checks++;return bridge.renameCheck(...args);}};
    const fn=vm.runInNewContext(renameCode,{window:rust?{TriancleRust:api}:{},$:id=>nodes[id],getSB:()=>sb,acct,WAL:{bal:opts.balance},USERNAME_COST:100,RENAME_ERR:{invalid:"invalid",same:"same",not_enough:"not_enough",taken:"taken"},
      validUsername:v=>/^[A-Za-z0-9_]{3,20}$/.test(v),uiConfirm:async()=>opts.confirm !== false,setPlayerName:()=>{},acctUI:()=>{},SOC:{cache},renderSettings:async()=>{}});
    await fn(); return {calls,message:nodes.sUserMsg.textContent,disabled:nodes.sUserSave.disabled,username:acct.username,profile:cache.get("me").username,checks};
  }
  for (const opts of [
    {value:"x",current:"Alice",balance:0},{value:" ALICE ",current:"alice",balance:0},
    {value:"Bob",current:"Alice",balance:99},{value:"Bob",current:"Alice",balance:100},
    {value:"Bob",current:"Alice",balance:null,confirm:false},{value:"Bob",current:"Alice",balance:100,error:"taken"},
    {value:"Bob",current:"K",balance:100},{value:"Bób",current:"Alice",balance:100}
  ]) {
    const old=await renameFixture(false,opts), modern=await renameFixture(true,opts);
    assert.equal(modern.checks,1); delete old.checks; delete modern.checks; assert.equal(JSON.stringify(modern),JSON.stringify(old));
  }
  const feePlanStart=bundle.indexOf("function ugRustFeePlan(price) {"), feePlanEnd=bundle.indexOf('if ($("ugPrice"))',feePlanStart);
  assert.ok(feePlanStart >= 0 && feePlanEnd > feePlanStart);
  const feePlanCode=bundle.slice(feePlanStart,feePlanEnd)+"\n({ugCost,ugFeeNote})";
  function feePlanFixture(rust,opts) {
    const UG={attach:opts.attach,livePrice:opts.live,published:opts.published,sale:opts.sale,editId:opts.edit?"id":null,busy:false,cloth:{},holder:{},name:"Name"};
    const nodes={ugPrice:{value:String(opts.price)},ugFeeNote:{innerHTML:""},ugGo:{textContent:"",disabled:false}};
    const ctx={window:rust?{TriancleRust:bridge}:{},UG,$:id=>nodes[id],TAX_MAX:1000000,ugClamp:(v,a,b)=>Math.max(a,Math.min(b,v)),
      kindOfItem:a=>a==="Face"?"face":a==="Shirt"||a==="Pants"?"cloth":"acc",uploadFee:a=>a==="Face"?0:a==="Shirt"||a==="Pants"?5:150,
      listFee:(p,a)=>a==="Face"?0:Math.ceil(Math.max(0,+p||0)*0.15),creatorShare:p=>Math.floor(p*0.8),fmtN:String,isCloth:a=>a==="Shirt"||a==="Pants"};
    const api=vm.runInNewContext(feePlanCode,ctx); const cost=api.ugCost(); api.ugFeeNote();
    return {cost,html:nodes.ugFeeNote.innerHTML,text:nodes.ugGo.textContent,disabled:nodes.ugGo.disabled};
  }
  for (const attach of ["Hat","Shirt","Face"]) for (const price of [0,1,5,50,999999,1000000]) for (const edit of [false,true]) for (const sale of [false,true]) for (const published of [false,true]) for (const live of [0,price,42]) {
    const opts={attach,price,edit,sale,published,live};
    assert.deepEqual(feePlanFixture(true,opts),feePlanFixture(false,opts),JSON.stringify(opts));
  }
  const catalogRows = Array.from({length:120},(_,i)=>({id:"id"+i,creator:"user"+(i%9),name:["Red Hat","Blue Shirt","Étoile","帽子"][i%4],attach:["Hat","Shirt","Pants","Face"][i%4],price:[0,5,50,"75","bad",null][i%6]}));
  const profiles = new Map(Array.from({length:9},(_,i)=>["user"+i,{username:i%2?"Alice":"BÓB"}]));
  const owned = new Set(catalogRows.filter((_,i)=>i%3===0).map(r=>r.id));
  let catalogCases = 0;
  for (const q of ["","hat","é","帽"]) for (const category of ["all","acc","Shirt","Face"]) for (const author of ["","alice","bób"]) for (const free of [false,true]) for (const hide of [false,true]) {
    const min = catalogCases%2 ? 5 : null, max = catalogCases%3 ? 75 : null;
    const actual = bridge.catalogFilter(catalogRows,q,category,author,min,max,free,hide,profiles,owned);
    assert.ok(actual);
    const expected = catalogRows.map((it,i)=>({it,i})).filter(({it})=> (!q || String(it.name).toLowerCase().includes(q)) && (category === "all" || (category === "acc" ? it.attach !== "Shirt" && it.attach !== "Pants" && it.attach !== "Face" : it.attach === category))
      && (!author || String((profiles.get(it.creator) || {}).username || "").toLowerCase().includes(author))
      && (min === null || (+it.price || 0) >= min) && (max === null || (+it.price || 0) <= max)
      && (!free || !(+it.price)) && (!hide || !owned.has(it.id))).map(x=>x.i);
    assert.deepEqual(Array.from(actual),expected); catalogCases++;
  }
  assert.equal(bridge.catalogFilter([{name:"x",attach:"Hat",price:Infinity}],"","all","",null,null,false,false,profiles,owned),null);
  const shopStart = bundle.indexOf("function paintShop() {");
  const shopEnd = bundle.indexOf('$("shSearch").addEventListener',shopStart);
  assert.ok(shopStart >= 0 && shopEnd > shopStart);
  const shopCode = bundle.slice(shopStart,shopEnd) + "\npaintShop";
  function shopFixture(rust, opts) {
    const elements = {
      shSearch:{value:opts.q}, shSort:{value:opts.sort}, shType:{value:opts.category}, shAuthor:{value:opts.author},
      shMin:{value:opts.min}, shMax:{value:opts.max}, shFree:{checked:opts.free}, shOwned:{checked:opts.hide},
      shFiltN:{textContent:"",hidden:false}, shopBox:{hidden:false,lastChild:{textContent:""}}, shopList:{innerHTML:""},
    };
    let runs=0;
    const custom={...bridge,catalogFilter:(...args)=>{const v=bridge.catalogFilter(...args);if(v)runs++;return v;}};
    const fn=vm.runInNewContext(shopCode,{window:rust?{TriancleRust:custom}:{}, SHOP:{rows:catalogRows}, SOC:{cache:profiles}, INV:{owned}, acct:{user:{id:"user0"}},
      $:id=>elements[id],document:{querySelectorAll:()=>[]},isCloth:a=>a==="Shirt"||a==="Pants",isFace:a=>a==="Face",fmtT:String,TRI_SVG:"$",slotName:String,esc:String,fillThumbs:()=>{}});
    fn();return {html:elements.shopList.innerHTML,empty:elements.shopBox.hidden,message:elements.shopBox.lastChild.textContent,filter:elements.shFiltN.textContent,runs};
  }
  for (let i=0;i<80;i++) {
    const opts={q:["","hat","É"][i%3],sort:["low","high","top","new"][i%4],category:["all","acc","Face","Shirt"][i%4],author:["","Alice","BÓB"][i%3],min:i%2?"5":"",max:i%3?"75":"",free:i%2===0,hide:i%3===0};
    const old=shopFixture(false,opts), modern=shopFixture(true,opts);
    assert.equal(modern.runs,1); delete old.runs; delete modern.runs;
    assert.deepEqual(modern,old);
  }
  const inventoryStart = bundle.indexOf("async function loadInventory() {");
  const inventoryEnd = bundle.indexOf("async function equipItem(",inventoryStart);
  assert.ok(inventoryStart >= 0 && inventoryEnd > inventoryStart);
  const inventoryCode = bundle.slice(inventoryStart,inventoryEnd) + "\nloadInventory";
  async function inventoryFixture(rust,rows,error) {
    const INV={ok:true,loaded:false,owned:new Set()}, events=[];
    let calls=0;
    const custom={...bridge,inventoryRows:r=>{const v=bridge.inventoryRows(r);if(v)calls++;return v;}};
    const sb={from:()=>({select:()=>({eq:()=>({order:async()=>({data:rows,error})})})})};
    const fn=vm.runInNewContext(inventoryCode,{window:rust?{TriancleRust:custom}:{},getSB:()=>sb,acct:{user:{id:"me"}},INV,
      setMyItems:ids=>events.push(["wear",Array.from(ids)]),renderAvItems:()=>events.push(["render"])});
    await fn();return {state:{ok:INV.ok,loaded:INV.loaded,owned:Array.from(INV.owned)},events,calls};
  }
  for (let n=0;n<100;n++) {
    const rows=Array.from({length:n},(_,i)=>({item_id:"item"+(i%13),equipped:i%3===0}));
    const old=await inventoryFixture(false,rows,null), modern=await inventoryFixture(true,rows,null);
    assert.equal(modern.calls,1); delete old.calls; delete modern.calls;
    assert.equal(JSON.stringify(modern),JSON.stringify(old));
  }
  const unusualRows=[{item_id:"x",equipped:1}];
  const invOld=await inventoryFixture(false,unusualRows,null), invRust=await inventoryFixture(true,unusualRows,null);
  assert.equal(invRust.calls,0); delete invOld.calls; delete invRust.calls;
  assert.equal(JSON.stringify(invRust),JSON.stringify(invOld));
  for (let i=0;i<500;i++) {
    const values=Array.from({length:i%23},(_,j)=>"id"+((i+j)%11)), present=Array.from({length:i%9},(_,j)=>"id"+j);
    const expected=values.map((v,j)=>({v,j})).filter(x=>!present.includes(x.v)).map(x=>x.j);
    assert.deepEqual(Array.from(bridge.missingIndices(values,present)),expected);
  }
  assert.equal(bridge.missingIndices([null],[]),null);
  const outfitStart=bundle.indexOf("async function applyItemsToAvatar(av, ids) {");
  const outfitEnd=bundle.indexOf("function syncAvatarItems(",outfitStart);
  assert.ok(outfitStart>=0 && outfitEnd>outfitStart);
  const outfitCode=bundle.slice(outfitStart,outfitEnd)+"\napplyItemsToAvatar";
  async function outfitFixture(rust, ids, stale) {
    const events=[]; let calls=0;
    const parent={remove:h=>events.push(["remove",h.id])};
    const av={itemHolders:new Map([["a",{id:"a",parent}],["b",{id:"b",parent}]]),clothItems:new Map([["shirtOld",{attach:"Shirt",cv:"old"}]]),itemSig:ids.join(",")};
    const custom={...bridge,missingIndices:(...args)=>{const v=bridge.missingIndices(...args);if(v)calls++;return v;}};
    const rows=new Map([["newHat",{attach:"Head",file_path:"hat"}],["newShirt",{attach:"Shirt",file_path:"shirt"}]]);
    const fn=vm.runInNewContext(outfitCode,{window:rust?{TriancleRust:custom}:{},Map,
      fetchItemRows:async need=>{events.push(["fetch",Array.from(need)]);return rows;},
      isCloth:a=>a==="Shirt"||a==="Pants",loadClothImg:async p=>{events.push(["cloth",p]);if(stale)av.itemSig="newer";return "canvas";},
      loadItemModel:async p=>{events.push(["model",p]);if(stale)av.itemSig="newer";return {};},
      buildHolder:(_av,it)=>({id:it.file_path,parent}),paintClothFor:(_av,items)=>events.push(["paint",Array.from(items)])});
    await fn(av,ids);
    return {events,holders:Array.from(av.itemHolders.keys()),clothes:Array.from(av.clothItems.keys()),calls};
  }
  for (const ids of [[],["a","shirtOld"],["b","newHat","newShirt"],["newShirt","newShirt"],["missing"],["a","b","shirtOld"]]) for (const stale of [false,true]) {
    const old=await outfitFixture(false,ids,stale), modern=await outfitFixture(true,ids,stale);
    assert.equal(modern.calls,3); delete old.calls; delete modern.calls;
    assert.equal(JSON.stringify(modern),JSON.stringify(old));
  }
  const lzStart = bundle.indexOf("function lz4Block(src, n) {");
  const lzEnd = bundle.indexOf("function loadZstd()", lzStart);
  assert.ok(lzStart >= 0 && lzEnd > lzStart);
  const lzOriginal = vm.runInNewContext(bundle.slice(lzStart, lzEnd) + "\nlz4Block", {window: {}, Uint8Array});
  const lzRust = vm.runInNewContext(bundle.slice(lzStart, lzEnd) + "\nlz4Block", {window: {TriancleRust: bridge}, Uint8Array});
  const blocks = [
    [new Uint8Array([0x50, 104, 101, 108, 108, 111, 5, 0]), 9],
    [new Uint8Array([0x1f, 65, 1, 0, 5]), 25],
    [new Uint8Array([0xf0, 5, ...Array.from({length: 20}, (_, i) => i)]), 20],
    [new Uint8Array([0x30, 1, 2, 3]), 3],
  ];
  for (let repeat = 0; repeat < 100; repeat++) for (const [src, n] of blocks) {
    assert.deepEqual(Array.from(lzRust(src, n)), Array.from(lzOriginal(src, n)));
  }
  assert.equal(bridge.lz4(new Uint8Array([0, 0, 0]), 4), null);
  assert.equal(bridge.lz4(new Uint8Array([0x50, 1]), 5), null);
  let deinterleaveCases = 0;
  for (let count = 1; count <= 128; count++) {
    const input = new Uint8Array(count * 4 + 7);
    for (let i = 0; i < input.length; i++) input[i] = (i * 137 + count * 31) & 255;
    const expected = new Array(count);
    for (let i = 0; i < count; i++) expected[i] = ((input[3+i]*16777216) + (input[3+count+i]<<16) + (input[3+2*count+i]<<8) + input[3+3*count+i]) >>> 0;
    assert.deepEqual(Array.from(bridge.deinterleave(input, 3, count)), expected);
    deinterleaveCases += count;
  }
  assert.equal(bridge.deinterleave(new Uint8Array(3), 0, 1), null);
  assert.equal(bridge.deinterleave(new Uint8Array(4), -1, 1), null);
  const words = [0, 1, 2, 0xffffffff, 0x7fffffff, 0xff000001, 0xfe000001];
  let seed = 0x13579bdf;
  for (let i = 0; i < 10000; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; words.push(seed); }
  const bits = new DataView(new ArrayBuffer(4));
  for (const value of words) {
    assert.equal(bridge.zigzag(value), (value >>> 1) ^ -(value & 1));
    bits.setUint32(0, ((value >>> 1) | (value << 31)) >>> 0);
    assert.ok(Object.is(bridge.rbxlFloat(value), bits.getFloat32(0)));
  }
  for (const refs of [[0, 2, 3, 0xffffffff, 0xfffffffe], words, Array(1000).fill(0xfffffffe)]) {
    let position = 0;
    const expected = refs.map(v => position += (v >>> 1) ^ -(v & 1));
    assert.deepEqual(Array.from(bridge.references(refs)), expected);
  }
  assert.equal(bridge.references([]), null);
  assert.equal(bridge.references([-1]), null);

  // Build a minimal binary map with a workspace, one part, properties and a
  // parent relationship. Exercise the actual importer, not only helper copies.
  const le32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  const be32 = v => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const str = s => [...le32(s.length), ...Buffer.from(s, "utf8")];
  const float = v => { bits.setFloat32(0, v); const w = bits.getUint32(0); return be32(((w << 1) | (w >>> 31)) >>> 0); };
  function chunk(name, data, compress = false) {
    let raw = data;
    if (compress) {
      assert.ok(data.length >= 15 && data.length < 270);
      raw = [0xf0, data.length - 15, ...data];
    }
    return [...Buffer.from(name.padEnd(4, "\0")), ...le32(compress ? raw.length : 0), ...le32(data.length), 0,0,0,0, ...raw];
  }
  const inst = (id, name, ref) => [...le32(id), ...str(name), 0, ...le32(1), ...be32(ref * 2)];
  const prop = (id, name, type, value) => [...le32(id), ...str(name), type, ...value];
  const data = new Uint8Array([
    ...Buffer.from("<roblox!"), ...new Uint8Array(24),
    ...chunk("INST", inst(1, "Workspace", 0), true),
    ...chunk("INST", inst(2, "Part", 1)),
    ...chunk("PROP", prop(2, "size", 14, [...float(4), ...float(1), ...float(4)])),
    ...chunk("PROP", prop(2, "CFrame", 16, [2, ...float(0), ...float(0), ...float(0)])),
    ...chunk("PROP", prop(2, "Name", 1, str("Test part"))),
    ...chunk("PROP", prop(2, "CanCollide", 2, [1])),
    ...chunk("PROP", prop(2, "Transparency", 4, float(0.25))),
    ...chunk("PROP", prop(2, "Shape", 18, be32(1))),
    ...chunk("PROP", prop(2, "Color3uint8", 26, [10,20,30])),
    ...chunk("PRNT", [0, ...le32(1), ...be32(2), ...be32(0)]),
    ...chunk("END", []),
  ]);
  const importStart = bundle.indexOf("const RBX_ROT = {");
  const importEnd = bundle.indexOf("function addCustomGame(", importStart);
  assert.ok(importStart >= 0 && importEnd > importStart);
  const importerCode = bundle.slice(importStart, importEnd) + "\nrbxToMap";
  function importer(rust) {
    return vm.runInNewContext(importerCode, {
      window: rust ? {TriancleRust: rust} : {}, Uint8Array, ArrayBuffer, DataView, TextDecoder,
    });
  }
  const calls = {lz4: 0, defaultSpawn: 0, rbxlIndex: 0, rbxlProperty: 0};
  const tracked = {...bridge};
  tracked.rbxlMap = null; // Exercise the incremental fallback separately.
  for (const key of Object.keys(calls)) tracked[key] = (...args) => { const result = bridge[key](...args); if (result !== null) calls[key]++; return result; };
  const expectedMap = await importer(null)(data.buffer);
  const actualMap = await importer(tracked)(data.buffer);
  assert.equal(JSON.stringify(actualMap), JSON.stringify(expectedMap));
  assert.equal(actualMap.parts.length, 1);
  for (const count of Object.values(calls)) assert.ok(count > 0);
  assert.equal(calls.rbxlProperty, 7);
  let fullMapCalls = 0;
  const fullMapBridge = {...bridge, rbxlMap: chunks => { const map = bridge.rbxlMap(chunks); if (map) fullMapCalls++; return map; }};
  const fullMap = await importer(fullMapBridge)(data.buffer);
  assert.equal(JSON.stringify(fullMap), JSON.stringify(expectedMap));
  assert.equal(fullMapCalls, 1);
  assert.equal(bridge.rbxlProperty(new Uint8Array([0]), 0, 1, 255), null);
  assert.equal(bridge.rbxlProperty(new Uint8Array([0]), 0, 2, 26), null);
  const plane = values => {
    const out = [];
    for (let j = 0; j < 4; j++) for (const value of values) out.push((value >>> (24 - j*8)) & 255);
    return out;
  };
  const encodedFloat = value => { bits.setFloat32(0, value); const v = bits.getUint32(0); return ((v << 1) | (v >>> 31)) >>> 0; };
  for (let n = 1; n <= 100; n++) {
    const nums = Array.from({length:n}, (_, i) => (Math.imul(i+1, 2654435761) ^ n) >>> 0);
    const bytes = new Uint8Array(plane(nums));
    assert.deepEqual(Array.from(bridge.rbxlProperty(bytes, 0, n, 18)), nums);
    const expectedFloats = nums.map(v => { bits.setUint32(0, ((v >>> 1) | (v << 31)) >>> 0); return bits.getFloat32(0); });
    const actualFloats = bridge.rbxlProperty(bytes, 0, n, 4);
    if (expectedFloats.every(Number.isFinite)) {
      assert.ok(actualFloats);
      for (let i = 0; i < n; i++) assert.ok(Object.is(actualFloats[i], expectedFloats[i]));
    } else assert.equal(actualFloats, null);
    const xyz = Array.from({length:n}, (_, i) => (i - n/2) * 0.25);
    const vecBytes = new Uint8Array([...plane(xyz.map(encodedFloat)), ...plane(xyz.map(v => encodedFloat(v+1))), ...plane(xyz.map(v => encodedFloat(v-1)))]);
    const vectors = bridge.rbxlProperty(vecBytes, 0, n, 14);
    for (let i = 0; i < n; i++) assert.deepEqual(Array.from(vectors[i]), [xyz[i],xyz[i]+1,xyz[i]-1]);
  }
  const rotationsSource = bundle.slice(importStart, bundle.indexOf("const RBX_PARTS", importStart)) + "\nRBX_ROT";
  const rotations = vm.runInNewContext(rotationsSource);
  for (let id = 1; id <= 40; id++) {
    const payload = new Uint8Array([id, ...float(2), ...float(3), ...float(4)]);
    const result = bridge.rbxlProperty(payload, 0, 1, 16);
    assert.deepEqual(Array.from(result[0].rot), Array.from(rotations[id] || rotations[2]));
    assert.deepEqual(Array.from(result[0].pos), [2,3,4]);
  }
  const matrix = [1,0,0,0,0,-1,0,1,0], matrixBytes = [];
  for (const v of matrix) { bits.setFloat32(0, v, true); for (let i = 0; i < 4; i++) matrixBytes.push(bits.getUint8(i)); }
  const explicit = bridge.rbxlProperty(new Uint8Array([0,...matrixBytes,...float(2),...float(3),...float(4)]), 0, 1, 16);
  assert.deepEqual(Array.from(explicit[0].rot), matrix);
  const encodedRefs = ids => { let previous = 0; return plane(ids.map(id => { const delta = id-previous; previous = id; return ((delta << 1) ^ (delta >> 31)) >>> 0; })); };
  const instMany = (id, name, ids) => [...le32(id), ...str(name), 0, ...le32(ids.length), ...encodedRefs(ids)];
  for (let test = 0; test < 30; test++) {
    const n = 1 + test % 12, ids = Array.from({length:n}, (_,i)=>i+1);
    const sizes = ids.map(i => 1+i/4), positions = ids.map(i => (i-5)*0.125);
    const parts = [
      ...chunk("INST", inst(1, "Workspace", 0)),
      ...chunk("INST", instMany(2, "Part", ids), true),
      ...chunk("PROP", prop(2, "size", 14, [...plane(sizes.map(encodedFloat)), ...plane(ids.map(()=>encodedFloat(1))), ...plane(sizes.map(encodedFloat))])),
      ...chunk("PROP", prop(2, "CFrame", 16, [...ids.map(()=>2), ...plane(positions.map(encodedFloat)), ...plane(ids.map(i=>encodedFloat(i/4))), ...plane(positions.map(encodedFloat))])),
      ...chunk("PROP", prop(2, "Color3uint8", 26, [...ids.map(i=>i), ...ids.map(i=>255-i), ...ids.map(i=>i*2)])),
      ...chunk("PROP", prop(2, "CanCollide", 2, ids.map(i=>i%2))),
      ...chunk("PROP", prop(2, "Shape", 18, plane(ids.map(i=>i%3)))),
      ...chunk("PRNT", [0, ...le32(n), ...encodedRefs(ids), ...encodedRefs(ids.map(()=>0))]),
    ];
    if (test % 2) {
      const id = n+1;
      parts.push(...chunk("INST", inst(3, "SpawnLocation", id)));
      parts.push(...chunk("PROP", prop(3, "size", 14, [...float(3),...float(2),...float(3)])));
      parts.push(...chunk("PROP", prop(3, "CFrame", 16, [2,...float(1),...float(2),...float(3)])));
      parts.push(...chunk("PRNT", [0,...le32(1),...be32(id*2),...be32(0)]));
    }
    const fixture = new Uint8Array([...Buffer.from("<roblox!"),...new Uint8Array(24),...parts,...chunk("END",[])]);
    const expected = await importer(null)(fixture.buffer);
    const before = fullMapCalls;
    const actual = await importer(fullMapBridge)(fixture.buffer);
    assert.equal(fullMapCalls, before + 1, `Rust map path ${test}`);
    assert.equal(JSON.stringify(actual), JSON.stringify(expected), `Map fixture ${test}`);
  }
  function referenceSpawn(rows) {
    let best = null;
    for (const r of rows) {
      const R=r[6], ex=Math.abs(R[0])*r[0]+Math.abs(R[1])*r[1]+Math.abs(R[2])*r[2], ey=Math.abs(R[3])*r[0]+Math.abs(R[4])*r[1]+Math.abs(R[5])*r[2], ez=Math.abs(R[6])*r[0]+Math.abs(R[7])*r[1]+Math.abs(R[8])*r[2];
      if (Math.abs(r[3]) <= ex/2 && Math.abs(r[5]) <= ez/2) { const top = r[4]+ey/2; if (!best || top > best) best = top; }
    }
    if (best !== null) return [0,best+3,0];
    const r = rows.reduce((p,q) => q[0]*q[2] > p[0]*p[2] ? q : p);
    return [r[3],r[4]+r[1]/2+3,r[5]];
  }
  for (let i = 0; i < 250; i++) {
    const rows = [];
    for (let j = 0; j < 10; j++) {
      const a = (i+j)*0.11, c = Math.cos(a), s = Math.sin(a);
      rows.push([1+j, 1+(j%3), 2+j/2, (i%3 ? j-5 : j+20), j-2, (i%3 ? 0 : j+20), [c,0,s,0,1,0,-s,0,c]]);
    }
    assert.deepEqual(Array.from(bridge.defaultSpawn(rows)), referenceSpawn(rows));
  }
  assert.equal(bridge.defaultSpawn([]), null);
  const wrapStart = bundle.indexOf("function wrapPi(a) {");
  const wrapEnd = bundle.indexOf("\n", wrapStart);
  assert.ok(wrapStart >= 0 && wrapEnd > wrapStart);
  const wrapCode = bundle.slice(wrapStart, wrapEnd) + "\nwrapPi";
  const originalWrap = vm.runInNewContext(wrapCode, {window: {}});
  const rustWrap = vm.runInNewContext(wrapCode, {window: {TriancleRust: bridge}});
  const angles = [0, -0, Math.PI, -Math.PI, 3*Math.PI, -3*Math.PI, NaN, 101, -101];
  for (let i = -5000; i <= 5000; i++) angles.push(i / 100);
  for (const angle of angles) assert.ok(Object.is(rustWrap(angle), originalWrap(angle)));
  const cameraComment = bundle.indexOf("/* Shift lock steers the camera");
  const cameraStart = bundle.lastIndexOf('window.addEventListener("mousemove", e => {',cameraComment);
  const cameraEnd = bundle.indexOf("/* ---- js/core/camera.js ---- */",cameraComment);
  assert.ok(cameraStart >= 0 && cameraEnd > cameraStart);
  const cameraCode = bundle.slice(cameraStart,cameraEnd);
  function cameraFixture(rust) {
    const handlers={},canvas={addEventListener:(type,fn)=>{handlers[type]=fn;}},cam={yaw:0,pitch:0.2,zoomTarget:12.5}; let aims=0,zooms=0;
    const custom={...bridge,cameraAim:(...a)=>{const v=bridge.cameraAim(...a);if(v)aims++;return v;},cameraZoom:(...a)=>{const v=bridge.cameraZoom(...a);if(v!==null)zooms++;return v;}};
    vm.runInNewContext(cameraCode,{window:{...(rust?{TriancleRust:custom}:{}),addEventListener:(type,fn)=>{handlers[type]=fn;}},canvas,cam,CFG:{CAM_SENS:0.0045,CAM_PITCH_LIMIT:80*Math.PI/180,CAM_ZOOM_MIN:0.5,CAM_ZOOM_MAX:128},rmbDown:true,shiftLock:false,firstPerson:false,inGame:true,hasLock:()=>false,uiOpen:()=>false});
    return {handlers,canvas,cam,counts:()=>[aims,zooms]};
  }
  const cameraJs=cameraFixture(false), cameraRust=cameraFixture(true);
  for(let i=0;i<1000;i++) {
    const dx=(i%85)-42,dy=(i%47)-23,delta=i%2?100:-100;
    cameraJs.handlers.mousemove({movementX:dx,movementY:dy,target:cameraJs.canvas});
    cameraRust.handlers.mousemove({movementX:dx,movementY:dy,target:cameraRust.canvas});
    cameraJs.handlers.wheel({deltaY:delta,preventDefault(){}}); cameraRust.handlers.wheel({deltaY:delta,preventDefault(){}});
    for(const key of ["yaw","pitch","zoomTarget"]) assert.ok(Math.abs(cameraRust.cam[key]-cameraJs.cam[key])<1e-12);
  }
  assert.deepEqual(cameraRust.counts(),[1000,1000]);
  assert.equal(bridge.cameraAim(0,0,1,2,0.1,0),null);
  let clipped=0;
  for(let i=0;i<5000;i++) {
    const cam={zoom:1+(i%40)/3,zoomTarget:2+(i%50)/4,shift:(i%10)/10,yaw:Math.sin(i/9)*3,pitch:Math.sin(i/7)*1.4};
    const f={x:Math.sin(i/11)*4,y:0.3+(i%30)/4,z:Math.cos(i/13)*4}, wanted=i%2===0,dt=(i%25)/1000,offset=1.75,half=30;
    const zoom=cam.zoom+(cam.zoomTarget-cam.zoom)*(1-Math.exp(-dt*20));
    const shift=cam.shift+((wanted?1:0)-cam.shift)*(1-Math.exp(-dt*15)), off=offset*shift;
    const focus=[f.x+Math.cos(cam.yaw)*off,f.y,f.z-Math.sin(cam.yaw)*off],cp=Math.cos(cam.pitch),sp=Math.sin(cam.pitch);
    const pos=[focus[0]+zoom*Math.sin(cam.yaw)*cp,focus[1]+zoom*sp,focus[2]+zoom*Math.cos(cam.yaw)*cp];
    if(pos[1]<0.25 && focus[1]>0.25 && Math.abs(pos[0])<half && Math.abs(pos[2])<half) {
      const scale=(focus[1]-0.25)/(focus[1]-pos[1]); for(let j=0;j<3;j++) pos[j]=(pos[j]-focus[j])*scale+focus[j]; clipped++;
    }
    const expected=[zoom,shift,...focus,...pos],actual=bridge.cameraFrame(cam,f,wanted,dt,offset,half);
    assert.ok(actual);
    for(let j=0;j<8;j++) assert.ok(Math.abs(actual[j]-expected[j])<1e-10,`camera frame ${i} ${j}`);
  }
  assert.ok(clipped>100);
  const networkValues = [0,-0,0.005,-0.005,1.005,-1.005,NaN,Infinity,-Infinity,Number.MAX_VALUE,Number.MIN_VALUE,2**45,-(2**45)];
  for (let i=-10000; i<=10000; i++) { const v=(i+0.5)/100; networkValues.push(v,v+Number.EPSILON,v-Number.EPSILON); }
  for (const v of networkValues) assert.ok(Object.is(bridge.networkRound(v), Math.round(v*100)/100), `network rounding ${v}`);
  for (let i = 0; i <= 1000; i++) for (const rate of [10, 16, 18, 22, 25, 35]) {
    const dt = i / 4000;
    assert.ok(Math.abs(bridge.animationBlend(dt, rate) - (1 - Math.exp(-dt * rate))) < 1e-12);
  }
  // Run real animation updates in both modes through idle, running, jumping,
  // falling and climbing, comparing accumulated state as well as each frame.
  const animStart = bundle.indexOf("let facing = Math.PI / 2;");
  const animEnd = bundle.indexOf("/* ---- js/game/btools.js ---- */", animStart);
  assert.ok(animStart >= 0 && animEnd > animStart);
  const animationCode = bundle.slice(animStart, animEnd) + `\n({ step: (mode, dt) => {
    player.alive = mode !== 7; player.onGround = mode === 0 || mode === 1; player.climb = mode >= 4 && mode <= 6 ? {mode: ['ladder','hang','over'][mode-4], t: 0.2, dur: 1, face: 0.4} : null;
    player.vel.x = mode === 1 ? 12 : 0; player.vel.y = mode === 2 ? 20 : mode === 3 ? -25 : 0;
    player.moveX = mode === 1 ? 1 : 0; keys.KeyW = mode === 4;
    animate(dt); return [facing, ang.LeftArm, ang.RightArm, ang.LeftLeg, ang.RightLeg, bodyY, lean, roll, animState];
  } })`;
  let animationRuns = 0;
  const animationBridge = {...bridge, animate: state => { const result = bridge.animate(state); if (result) animationRuns++; return result; }};
  function animation(rust) {
    return vm.runInNewContext(animationCode, {window: rust ? {TriancleRust: animationBridge} : {},
      player: {alive: true, onGround: true, climb: null, vel: {x:0,y:0,z:0}, moveX:0, moveZ:0},
      CFG: {TURN_SMOOTH: 11, SHIFTLOCK_TURN: 35, WALK_SPEED: 16}, shiftLock: false, firstPerson: false,
      cam: {yaw: 0}, keys: {}, rig: {LeftArm:{rotation:{}},RightArm:{rotation:{}},LeftLeg:{rotation:{}},RightLeg:{rotation:{}}}});
  }
  const animJs = animation(false), animRust = animation(true);
  for (let i = 0; i < 800; i++) {
    const mode = Math.floor(i / 100), dt = 1/60;
    const expected = animJs.step(mode, dt), actual = animRust.step(mode, dt);
    for (let j = 0; j < expected.length - 1; j++) assert.ok(Math.abs(actual[j] - expected[j]) < 1e-11);
    assert.equal(actual[expected.length - 1], expected[expected.length - 1]);
  }
  assert.equal(animationRuns, 800);
  const remoteStart = bundle.indexOf('const LIMBS = ["LeftArm", "RightArm", "LeftLeg", "RightLeg"];');
  const remoteEnd = bundle.indexOf("/* ---- js/core/input.js ---- */", remoteStart);
  assert.ok(remoteStart >= 0 && remoteEnd > remoteStart);
  const remoteCode = bundle.slice(remoteStart, remoteEnd) + "\nupdateRemotes";
  function remoteFixture(rust) {
    const group = {visible: true, position: {x:0,y:0,z:0}, rotation: {x:0,y:0,z:0}};
    const limbs = ["LeftArm", "RightArm", "LeftLeg", "RightLeg"];
    const avatar = {group, ln:0, rl:0, by:0, facing:0, ang: Object.fromEntries(limbs.map(n => [n,0])), rig: Object.fromEntries(limbs.map(n => [n,{rotation:{z:0}}]))};
    const player = {local:false, alive:true, name:"Player", avatar, target:{x:0,y:0,z:0,f:0,a:[0,0,0,0],l:0,r:0,b:0,ff:0}};
    let calls = 0;
    const wrapper = {...bridge, animateRemote: s => { const out = bridge.animateRemote(s); if (out) calls++; return out; }};
    const fn = vm.runInNewContext(remoteCode, {window: rust ? {TriancleRust: wrapper} : {}, players: new Map([["remote", player]]),
      animationBlend: (dt, rate) => 1 - Math.exp(-dt*rate), wrapPi: originalWrap, isBlocked: () => false, setFF: () => {}, CFG: {MODEL_FRONT_OFFSET: 0}});
    return {fn, player, calls: () => calls};
  }
  const remoteJs = remoteFixture(false), remoteRust = remoteFixture(true);
  for (let i = 0; i < 600; i++) {
    const target = {x:Math.sin(i/10)*12, y:3+Math.cos(i/7), z:i/40, f:Math.sin(i/9)*3, a:[Math.sin(i/5), 0.3, -0.4, Math.cos(i/6)], l:0.2, r:-0.1, b:0.4, ff:0};
    remoteJs.player.target = target; remoteRust.player.target = target;
    remoteJs.fn(1/60); remoteRust.fn(1/60);
    const a = remoteJs.player.avatar, b = remoteRust.player.avatar;
    for (const key of ["ln", "rl", "by", "facing"]) assert.ok(Math.abs(a[key]-b[key]) < 1e-11);
    for (const key of ["x", "y", "z"]) assert.ok(Math.abs(a.group.position[key]-b.group.position[key]) < 1e-11);
    for (const key of Object.keys(a.ang)) assert.ok(Math.abs(a.ang[key]-b.ang[key]) < 1e-11);
  }
  assert.equal(remoteRust.calls(), 600);
  const snapshotStart = bundle.indexOf("function remoteState(id, m) {");
  const snapshotEnd = bundle.indexOf("function remoteDied(",snapshotStart);
  assert.ok(snapshotStart >= 0 && snapshotEnd > snapshotStart);
  const snapshotCode = bundle.slice(snapshotStart,snapshotEnd) + "\nremoteState";
  function snapshotFixture(rust) {
    const events = [], position = {x:0,y:0,z:0,set(x,y,z){this.x=x;this.y=y;this.z=z;}};
    const player = {local:false,alive:true,target:null,avatar:{group:{position},facing:0}};
    let calls = 0;
    const custom = {...bridge,remoteSnapshot:m=>{const r=bridge.remoteSnapshot(m);if(r)calls++;return r;}};
    const fn = vm.runInNewContext(snapshotCode,{window:rust?{TriancleRust:custom}:{},players:new Map([["id",player]]),clearDebris:id=>events.push(id)});
    return {fn,player,events,calls:()=>calls};
  }
  const snapshotsJs = snapshotFixture(false), snapshotsRust = snapshotFixture(true);
  const snapshotCases = [
    {x:1,y:2,z:3,f:0.5,a:[1,2,3,4],ff:true,l:0.1,r:-0.2,b:0.3},
    {x:2,y:3,z:4, f:"bad", a:null, ff:0, l:NaN, r:Infinity, b:-Infinity, al:0},
    {x:3,y:4,z:5, f:-0, a:[1,"2",null], ff:1, l:-0, r:0, b:0, al:1},
    {x:NaN,y:2,z:3},{x:"4",y:2,z:3},{x:4,y:5,z:6,al:1},
  ];
  for (let i = 0; i < 300; i++) snapshotCases.push({x:i/3,y:i/7,z:-i/11,f:i/15,a:[0,1,2,3],ff:i%2,l:i/20,r:-i/30,b:i/50,al:1});
  for (const m of snapshotCases) {
    snapshotsJs.fn("id",m); snapshotsRust.fn("id",m);
    assert.equal(JSON.stringify(snapshotsRust.player),JSON.stringify(snapshotsJs.player));
    assert.deepEqual(snapshotsRust.events,snapshotsJs.events);
  }
  assert.ok(snapshotsRust.calls() >= 300);
  const ugcStart = bundle.indexOf("function ugApply() {");
  const ugcEnd = bundle.indexOf("function ugMove(", ugcStart);
  assert.ok(ugcStart >= 0 && ugcEnd > ugcStart);
  const ugcCode = bundle.slice(ugcStart, ugcEnd) + "\nugApply";
  function itemFixture(rust, slot, i) {
    const recorded = {};
    const pv = {add: () => {}};
    const holder = {parent: pv, position: {set: (...x) => recorded.position = x}, rotation: {set: (...x) => recorded.rotation = x}, scale: {setScalar: x => recorded.scale = x}};
    const ug = {attach: slot, holder, inner: {position: {set: (...x) => recorded.inner = x}}, c: {x: i/7, y:-i/9, z:i/11}, min: {y:-i/3}, k: 1.2/(i+1), pos:[0.2,-0.4,0.5], rot:[10,20,30], scale:1.1};
    const fn = vm.runInNewContext(ugcCode, {window: rust ? {TriancleRust: bridge} : {}, ugv: {clothOn:false,av:{rig:{[slot]:pv}}}, UG:ug,
      MODEL_PARTS: {[slot]:{pivot:[0,3,0]}}, UG_ANCHOR: {[slot]:[0,5.05,0]}, isCloth: () => false});
    fn(); return recorded;
  }
  for (let i = 0; i < 100; i++) for (const slot of ["Head", "Torso"]) {
    const expected = itemFixture(false, slot, i), actual = itemFixture(true, slot, i);
    assert.equal(JSON.stringify(actual), JSON.stringify(expected));
  }
  for (let i=0;i<3000;i++) {
    const a=i/83,c=Math.cos(a),s=Math.sin(a), e=[c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1];
    const pos=[Math.sin(i)*4,Math.cos(i)*4,(i%11)-5], delta={x:Math.sin(i/3),y:Math.cos(i/7),z:Math.sin(i/5)};
    const {x,y,z}=delta, w=1/(e[3]*x+e[7]*y+e[11]*z+e[15]);
    const d=[(e[0]*x+e[4]*y+e[8]*z+e[12])*w,(e[1]*x+e[5]*y+e[9]*z+e[13])*w,(e[2]*x+e[6]*y+e[10]*z+e[14])*w];
    const expected=pos.map((v,j)=>Math.max(-4,Math.min(4,v+d[j]))), actual=bridge.ugcDrag(pos,delta,e);
    assert.ok(actual);
    for(let j=0;j<3;j++) assert.ok(Math.abs(actual[j]-expected[j])<1e-12);
  }
  assert.equal(bridge.ugcDrag([0,0,0],{x:1,y:2,z:3},Array(16).fill(0)),null);
  const holderStart = bundle.indexOf("function buildHolder(av, it, m) {");
  const holderEnd = bundle.indexOf("async function fetchItemRows",holderStart);
  assert.ok(holderStart >= 0 && holderEnd > holderStart);
  const holderCode = bundle.slice(holderStart,holderEnd) + "\nbuildHolder";
  function holderFixture(rust, slot, i) {
    const parents=[];
    class Group {
      constructor() { this.children=[]; this.position={set:(...v)=>this.p=v}; this.rotation={set:(...v)=>this.r=v}; this.scale={setScalar:v=>this.s=v}; }
      add(v){this.children.push(v);}
    }
    const pv={add:h=>parents.push(h)}, model={traverse:fn=>fn({isMesh:true})};
    const m={scene:{clone:()=>model},k:1.2/(i+1),c:{x:i/7,y:-i/9,z:i/11},min:{y:-i/3}};
    const it={attach:slot,pos:[0.2,-0.4,0.5],rot:[10,20,30],scale:1.1};
    let calls=0;
    const custom={...bridge,itemPosition:(...args)=>{calls++;return bridge.itemPosition(...args);},itemCenter:(...args)=>{calls++;return bridge.itemCenter(...args);}};
    const fn=vm.runInNewContext(holderCode,{window:rust?{TriancleRust:custom}:{},THREE:{Group},UG_ANCHOR:{[slot]:[0,5.05,0]},MODEL_PARTS:{[slot]:{pivot:[0,3,0]}},arr3:a=>a});
    const h=fn({rig:{[slot]:pv}},it,m), inner=h.children[0];
    return {position:h.p,rotation:h.r,scale:h.s,inner:inner.p,innerScale:inner.s,attached:parents.length,calls};
  }
  for (let i=0;i<100;i++) for (const slot of ["Head","Torso"]) {
    const old=holderFixture(false,slot,i), modern=holderFixture(true,slot,i);
    assert.equal(modern.calls,6); delete old.calls; delete modern.calls;
    assert.equal(JSON.stringify(modern),JSON.stringify(old));
  }
  const nameStart = bundle.indexOf("function cleanName(s) {");
  const nameEnd = bundle.indexOf("\nlet myName", nameStart);
  assert.ok(nameStart >= 0 && nameEnd > nameStart);
  const nameCode = bundle.slice(nameStart, nameEnd) + "\ncleanName";
  const jsName = vm.runInNewContext(nameCode, {window: {}});
  let nameRuns = 0;
  const nameBridge = {...bridge, cleanName: s => { const result = bridge.cleanName(s); if (result !== null) nameRuns++; return result; }};
  const rustName = vm.runInNewContext(nameCode, {window: {TriancleRust: nameBridge}});
  const names = ["", "  <Alice>\n ", "\u00a0\ufefftest\u3000", "😺".repeat(11), "a".repeat(19)+"😺", "\ud800x\udfff", null, 123];
  for (let i = 0; i < 1000; i++) {
    let value = "";
    for (let j = 0; j < 25; j++) { seed = (Math.imul(seed,1664525)+1013904223) >>> 0; value += String.fromCharCode(seed & 65535); }
    names.push(value);
  }
  for (const value of names) assert.equal(rustName(value), jsName(value));
  assert.ok(nameRuns >= 1000);
  const chatStart = bundle.indexOf("function cleanChat(s)");
  const chatEnd = bundle.indexOf("/* name tag colour", chatStart);
  assert.ok(chatStart >= 0 && chatEnd > chatStart);
  const chatCode = bundle.slice(chatStart, chatEnd) + "\n({cleanChat,nameColor})";
  const chatJs = vm.runInNewContext(chatCode, {window:{}});
  let chatRuns = 0, hueRuns = 0;
  const chatBridge = {...bridge,
    cleanChat: s => { const r = bridge.cleanChat(s); if (r !== null) chatRuns++; return r; },
    nameHue: s => { const r = bridge.nameHue(s); if (r !== null) hueRuns++; return r; }};
  const chatRust = vm.runInNewContext(chatCode, {window:{TriancleRust:chatBridge}});
  for (const value of [...names, "😺".repeat(61), "a".repeat(119)+"😺", "\u2003hello\ufeff"]) {
    assert.equal(chatRust.cleanChat(value), chatJs.cleanChat(value));
    assert.equal(chatRust.nameColor(value), chatJs.nameColor(value));
  }
  assert.ok(chatRuns >= 1000 && hueRuns >= 1000);
  const badgeColorStart = bundle.indexOf("const badgeColor = k =>");
  const badgeColorEnd = bundle.indexOf("const BADGE_IMG",badgeColorStart);
  assert.ok(badgeColorStart >= 0 && badgeColorEnd > badgeColorStart);
  const badgeColorCode = bundle.slice(badgeColorStart,badgeColorEnd) + "\nbadgeColor";
  const badgeColorJs = vm.runInNewContext(badgeColorCode,{window:{},BADGE_COLOR:{owner:"#ffd23f"}});
  let badgeHueRuns = 0;
  const hueBridge = {...bridge,badgeHue:s=>{const v=bridge.badgeHue(s);if(v!==null)badgeHueRuns++;return v;}};
  const badgeColorRust = vm.runInNewContext(badgeColorCode,{window:{TriancleRust:hueBridge},BADGE_COLOR:{owner:"#ffd23f"}});
  for (const value of [...names,"owner","😺😺", "\ud800\udc00\ud800",null,123]) assert.equal(badgeColorRust(value),badgeColorJs(value));
  assert.ok(badgeHueRuns >= 1000);
  const userStart = bundle.indexOf("function validUsername(value)");
  const userEnd = bundle.indexOf("\n", userStart);
  assert.ok(userStart >= 0 && userEnd > userStart);
  const userCode = bundle.slice(userStart, userEnd) + "\nvalidUsername";
  const userJs = vm.runInNewContext(userCode, {window:{}});
  let userRuns = 0;
  const userBridge = {...bridge, validUsername: s => { const r = bridge.validUsername(s); if (r !== null) userRuns++; return r; }};
  const userRust = vm.runInNewContext(userCode, {window:{TriancleRust:userBridge}});
  const usernames = ["abc", "A_0", "ab", "x".repeat(20), "x".repeat(21), " abc", "abc\n", "ééé", "😺abc"];
  for (let c = 0; c < 65536; c += 17) usernames.push("ab" + String.fromCharCode(c));
  for (const value of usernames) assert.equal(userRust(value), userJs(value), JSON.stringify(value));
  assert.ok(userRuns >= 1000);
  const displayStart = bundle.indexOf("function validDisplayName(value)");
  const displayEnd = bundle.indexOf("\n",displayStart);
  assert.ok(displayStart >= 0 && displayEnd > displayStart);
  const displayCode = bundle.slice(displayStart,displayEnd) + "\nvalidDisplayName";
  const displayJs = vm.runInNewContext(displayCode,{window:{},DISPLAY_RE:/^[\p{L}\p{N}_.'\- ]{1,20}$/u});
  let displayRuns=0;
  const displayBridge={...bridge,validDisplayName:s=>{const r=bridge.validDisplayName(s);if(r!==null)displayRuns++;return r;}};
  const displayRust = vm.runInNewContext(displayCode,{window:{TriancleRust:displayBridge},DISPLAY_RE:/^[\p{L}\p{N}_.'\- ]{1,20}$/u});
  const displays=["","Alice", "O'Brien", "x".repeat(20), "x".repeat(21),"Élodie", "玩家", "😺", "\ud800", "a".repeat(19)+"😺"];
  for(let i=0;i<128;i++) displays.push("ab"+String.fromCharCode(i));
  for(const value of displays) assert.equal(displayRust(value),displayJs(value),JSON.stringify(value));
  assert.ok(displayRuns >= 128);
  const authStart = bundle.indexOf("function friendlyAuthError(e, mode) {");
  const authEnd = bundle.indexOf("function validUsername(",authStart);
  assert.ok(authStart >= 0 && authEnd > authStart);
  const authCode = bundle.slice(authStart,authEnd) + "\nfriendlyAuthError";
  const authJs = vm.runInNewContext(authCode,{window:{},Object});
  let authRuns=0;
  const authBridge={...bridge,authError:(...args)=>{const v=bridge.authError(...args);if(v!==null)authRuns++;return v;}};
  const authRust = vm.runInNewContext(authCode,{window:{TriancleRust:authBridge},Object});
  const authErrors = [
    {code:"user_already_exists"},{message:"ALREADY REGISTERED"},{code:"invalid_credentials"},{message:"Invalid Login"},
    {code:"email_not_confirmed"},{message:"not confirmed"},{code:"over_request_rate_limit"},{status:429},
    {code:"email_address_invalid"},{message:"Address x IS INVALID"},{message:"address \n is invalid"},
    {code:"weak_password",message:"too short"},{code:"weak_password"},{message:"unknown"},{},new Error("invalid login"),
  ];
  for(const error of authErrors) for(const mode of ["signup","login"]) assert.equal(authRust(error,mode),authJs(error,mode));
  assert.ok(authRuns >= 20);
  const submitStart = bundle.indexOf("async function submitAuth() {");
  const submitEnd = bundle.indexOf('authGo.addEventListener("click", submitAuth)',submitStart);
  assert.ok(submitStart >= 0 && submitEnd > submitStart);
  const submitCode = bundle.slice(submitStart,submitEnd) + "\nsubmitAuth";
  async function submitFixture(rust,opts) {
    const events=[],acct={busy:false,mode:opts.mode},authUser={value:opts.user},authPass={value:opts.password},authGo={disabled:false}; let emailRuns=0,passwordRuns=0;
    const custom={...bridge,loginEmail:(...a)=>{const v=bridge.loginEmail(...a);if(v!==null)emailRuns++;return v;},passwordLengthValid:n=>{const v=bridge.passwordLengthValid(n);if(v!==null)passwordRuns++;return v;}};
    const sb={rpc:async(name,args)=>{events.push(["rpc",name,args]);return {error:null,data:name==="username_available"?opts.available:opts.loginEmail};},auth:{
      signUp:async args=>{events.push(["signup",args]);return {error:opts.error||null,data:{user:{id:"uid"},session:{}}};},
      signInWithPassword:async args=>{events.push(["login",args]);return {error:opts.error||null,data:{user:{id:"uid"},session:{}}};}}};
    const fn=vm.runInNewContext(submitCode,{window:rust?{TriancleRust:custom}:{},acct,authUser,authPass,authGo,getSB:()=>sb,CFG:{AUTH_EMAIL_DOMAIN:"EXAMPLE.test"},
      validUsername:v=>/^[A-Za-z0-9_]{3,20}$/.test(v),authMsg:(...a)=>events.push(["message",...a]),friendlyAuthError:()=>"friendly",onSignedIn:async u=>events.push(["signed",u.id]),closeAuth:()=>events.push(["close"]),showTab:x=>events.push(["tab",x]),appRunPendingJoin:()=>events.push(["join"])});
    await fn();return {events,busy:acct.busy,disabled:authGo.disabled,password:authPass.value,emailRuns,passwordRuns};
  }
  for(const opts of [
    {mode:"signup",user:"Alice_1",password:"123456",available:true},
    {mode:"signup",user:"Alice_1",password:"123456",available:false},
    {mode:"login",user:"Alice_1",password:"123456",loginEmail:"other@example.test"},
    {mode:"login",user:"Alice_1",password:"123456",loginEmail:"!"},
    {mode:"login",user:"ab",password:"123456"},
    {mode:"login",user:"Alice_1",password:"12345"},
    {mode:"login",user:"Alice_1",password:"😺😺😺",error:{message:"bad"}},
  ]) {
    const old=await submitFixture(false,opts), modern=await submitFixture(true,opts);
    if (/^[A-Za-z0-9_]{3,20}$/.test(opts.user)) assert.equal(modern.passwordRuns,1);
    if (/^[A-Za-z0-9_]{3,20}$/.test(opts.user) && opts.password.length>=6) assert.equal(modern.emailRuns,1);
    delete old.emailRuns;delete old.passwordRuns;delete modern.emailRuns;delete modern.passwordRuns;
    assert.equal(JSON.stringify(modern),JSON.stringify(old));
  }
  const uuidStart = bundle.indexOf("const UUID_RE = ");
  const uuidEnd = bundle.indexOf("\nconst MAX_WORN", uuidStart);
  assert.ok(uuidStart >= 0 && uuidEnd > uuidStart);
  const uuidCode = bundle.slice(uuidStart, uuidEnd) + "\nvalidItemId";
  const uuidJs = vm.runInNewContext(uuidCode, {window:{}});
  let uuidRuns = 0;
  const uuidBridge = {...bridge, validItemId: s => { const r = bridge.validItemId(s); if (r !== null) uuidRuns++; return r; }};
  const uuidRust = vm.runInNewContext(uuidCode, {window:{TriancleRust:uuidBridge}});
  const baseId = "01234567-89ab-CDEF-0123-456789abcdef";
  const uuidCases = [baseId, baseId.toUpperCase(), "", null, 123, new String(baseId), baseId + "\n"];
  for (let i = 0; i < baseId.length; i++) for (let c = 0; c < 256; c++) uuidCases.push(baseId.slice(0,i) + String.fromCharCode(c) + baseId.slice(i+1));
  for (const value of uuidCases) assert.equal(uuidRust(value), uuidJs(value), JSON.stringify(value));
  assert.ok(uuidRuns >= 9000);
  const escStart = bundle.indexOf("const esc = s =>");
  const escEnd = bundle.indexOf("\n", escStart);
  assert.ok(escStart >= 0 && escEnd > escStart);
  const escCode = bundle.slice(escStart, escEnd) + "\nesc";
  const escJs = vm.runInNewContext(escCode, {window:{}});
  let escapeRuns = 0;
  const escapeBridge = {...bridge, escapeHtml: s => { const r = bridge.escapeHtml(s); if (r !== null) escapeRuns++; return r; }};
  const escRust = vm.runInNewContext(escCode, {window:{TriancleRust:escapeBridge}});
  for (const value of [...names, `&<>'\"`, "&".repeat(5000), "\ud800<script>\udfff", null, 123]) assert.equal(escRust(value), escJs(value));
  assert.ok(escapeRuns >= 1000);
  const socialStart = bundle.indexOf("async function loadSocial() {");
  const socialEnd = bundle.indexOf("const relation =", socialStart);
  assert.ok(socialStart >= 0 && socialEnd > socialStart);
  const socialCode = bundle.slice(socialStart,socialEnd) + "\nloadSocial";
  async function socialFixture(rust, rows, me) {
    const SOC = {friends:[],incoming:[],outgoing:[],ok:true}, badge = {textContent:""};
    let profiles = null, runs = 0;
    const socialBridge = {...bridge, socialLists:(...args)=>{const out=bridge.socialLists(...args); if(out) runs++; return out;}};
    const sb = {from:()=>({select:()=>({or:async()=>({data:rows,error:null})})})};
    const fn = vm.runInNewContext(socialCode,{window:rust?{TriancleRust:socialBridge}:{},SOC,acct:{user:{id:me}},FR_TABLE:"friendships",
      getSB:()=>sb,getProfiles:async ids=>{profiles=ids;},$:()=>badge,updateUgcBtn:()=>{}});
    await fn(); return {SOC,badge:badge.textContent,profiles,runs};
  }
  for (let i = 0; i < 100; i++) {
    const rows = Array.from({length:i},(_,j)=>({requester:j%3?"me":"other"+j,addressee:j%3?"other"+j:"me",status:j%4?"pending":"accepted"}));
    const expected = await socialFixture(false,rows,"me"), actual = await socialFixture(true,rows,"me");
    assert.equal(JSON.stringify(actual.SOC),JSON.stringify(expected.SOC));
    assert.equal(JSON.stringify(actual.profiles),JSON.stringify(expected.profiles));
    assert.equal(actual.badge,expected.badge); assert.equal(actual.runs,1);
  }
  assert.equal(bridge.socialLists("me",[{requester:"a",addressee:"me",status:null}]),null);
  const friendStart = bundle.indexOf("async function friendAct(kind, id) {");
  const friendEnd = bundle.indexOf("/* ---- js/social/badges.js ---- */",friendStart);
  assert.ok(friendStart >= 0 && friendEnd > friendStart);
  const friendCode = bundle.slice(friendStart,friendEnd) + "\nfriendAct";
  async function friendFixture(rust, kind, fail) {
    const events=[]; let calls=0;
    const actionBridge={...bridge,friendAction:k=>{const r=bridge.friendAction(k);if(r!==null)calls++;return r;}};
    const record = (...x) => { events.push(x); if (fail) throw new Error("mock failure"); };
    const sb={from:table=>({
      insert:async row=>record("insert",table,row),
      update:row=>({eq:(key,value)=>({eq:async(k,v)=>record("update",table,row,key,value,k,v)})}),
      delete:()=>({or:async filter=>record("delete",table,filter)}),
    })};
    const fn=vm.runInNewContext(friendCode,{window:rust?{TriancleRust:actionBridge}:{},getSB:()=>sb,acct:{user:{id:"me"}},FR_TABLE:"friendships",loadSocial:async()=>events.push(["reload"])});
    await fn(kind,"other"); return {events,calls};
  }
  for (const kind of ["add","accept","remove","",null,0]) for (const fail of [false,true]) {
    const old=await friendFixture(false,kind,fail), modern=await friendFixture(true,kind,fail);
    assert.equal(modern.calls,typeof kind === "string" && kind.length ? 1 : 0); delete old.calls;delete modern.calls;
    assert.equal(JSON.stringify(modern),JSON.stringify(old));
  }
  const relStart = bundle.indexOf("const relation = id =>");
  const relEnd = bundle.indexOf("\n",relStart);
  assert.ok(relStart >= 0 && relEnd > relStart);
  const relCode = bundle.slice(relStart,relEnd) + "\nrelation";
  for (let i = 0; i < 100; i++) {
    const SOC = {friends:["a", "f"+i],incoming:["b", "f"+i],outgoing:["c", "b"]};
    const old = vm.runInNewContext(relCode,{window:{},SOC});
    let count = 0;
    const relBridge = {...bridge,socialRelation:(...args)=>{const v=bridge.socialRelation(...args);if(v !== null) count++;return v;}};
    const modern = vm.runInNewContext(relCode,{window:{TriancleRust:relBridge},SOC});
    for (const id of ["a","b","c","f"+i,"none",null,NaN]) assert.equal(modern(id),old(id));
    assert.equal(count,5);
  }
  const badgeStart = bundle.indexOf("const badgeList = id =>");
  const badgeEnd = bundle.indexOf("\n",badgeStart);
  assert.ok(badgeStart >= 0 && badgeEnd > badgeStart);
  const badgeCode = bundle.slice(badgeStart,badgeEnd) + "\nbadgeList";
  for (let i = 0; i < 200; i++) {
    const order = ["owner","admin","mod","ugc","😺", "owner"];
    const badges = Array.from({length:i%23},(_,j)=>["ugc","unknown","owner","😺","admin","unknown2"][(i+j*3)%6]);
    const SOC = {badges:new Map([["x",badges]])};
    const old = vm.runInNewContext(badgeCode,{window:{},SOC,BADGE_ORDER:order});
    let runs = 0;
    const badgeBridge = {...bridge,orderedBadges:(...args)=>{const v=bridge.orderedBadges(...args);if(v !== null)runs++;return v;}};
    const modern = vm.runInNewContext(badgeCode,{window:{TriancleRust:badgeBridge},SOC,BADGE_ORDER:order});
    const original = badges.slice();
    assert.equal(JSON.stringify(modern("x")),JSON.stringify(old("x")));
    assert.equal(JSON.stringify(badges),JSON.stringify(original)); assert.equal(runs,1);
  }
  const partStart = bundle.indexOf("function stepUserParts(dt) {");
  const partEnd = bundle.indexOf("const partDirty", partStart);
  assert.ok(partStart >= 0 && partEnd > partStart);
  const partCode = bundle.slice(partStart, partEnd) + "\nstepUserParts";
  function partFixture(rust) {
    const floor = {minX:-100,maxX:100,minY:-4,maxY:0,minZ:-100,maxZ:100};
    const solids = [floor], userParts = [], events = [];
    function add(id, y, collide, anchored, vy) {
      const solid = {minX:-1,maxX:1,minY:y-1,maxY:y+1,minZ:-1,maxZ:1};
      const pt = {id, size:[2,2,2], pos:{x:0,y,z:0}, vy, collide, anchored, solid, mv:false,
        mesh:{position:{copy:p=>{pt.rendered = [p.x,p.y,p.z];}}}};
      userParts.push(pt); if (collide) solids.push(solid);
    }
    add("fall",10,true,false,0); add("noclip",8,false,false,0); add("fixed",-2,true,true,0);
    const update = pt => { const p=pt.pos,s=pt.solid; s.minX=p.x-1;s.maxX=p.x+1;s.minY=p.y-1;s.maxY=p.y+1;s.minZ=p.z-1;s.maxZ=p.z+1; };
    let calls = 0;
    const partBridge = {...bridge, stepBuiltPart: (...args) => { const r=bridge.stepBuiltPart(...args); if (r) calls++; return r; }};
    const fn = vm.runInNewContext(partCode, {window:rust ? {TriancleRust:partBridge} : {}, userParts, solids,
      CFG:{GRAVITY:196.2,FALL_DESTROY_Y:-100}, markPart:p=>events.push("settled:"+p.id), syncSolid:update,
      removePart:p=>{ events.push("removed:"+p.id); userParts.splice(userParts.indexOf(p),1); const i=solids.indexOf(p.solid); if(i>=0) solids.splice(i,1); }});
    return {fn,userParts,events,calls:()=>calls};
  }
  const partJs = partFixture(false), partRust = partFixture(true);
  for (let i = 0; i < 600; i++) { partJs.fn(1/240); partRust.fn(1/240); }
  assert.deepEqual(partRust.events, partJs.events);
  assert.deepEqual(partRust.userParts.map(p=>[p.id,p.pos.y,p.vy,p.mv]), partJs.userParts.map(p=>[p.id,p.pos.y,p.vy,p.mv]));
  assert.ok(partRust.calls() > 600);
  const axisStart = bundle.indexOf("function axisParam(origin, dir) {");
  const axisEnd = bundle.indexOf('canvas.addEventListener("mousedown"',axisStart);
  assert.ok(axisStart >= 0 && axisEnd > axisStart);
  const axisCode = bundle.slice(axisStart,axisEnd) + "\naxisParam";
  class V3 {
    constructor(x,y,z){this.x=x;this.y=y;this.z=z;}
    dot(v){return this.x*v.x+this.y*v.y+this.z*v.z;}
    clone(){return new V3(this.x,this.y,this.z);}
    sub(v){this.x-=v.x;this.y-=v.y;this.z-=v.z;return this;}
  }
  let axisRuns=0;
  const axisBridge={...bridge,axisParam:(...args)=>{const v=bridge.axisParam(...args);if(v)axisRuns++;return v;}};
  for (let i=0;i<1500;i++) {
    const angle=i/137, origin=new V3(i/20,-i/30,i/50), dir=new V3(1,0,0);
    const ray={origin:new V3(2,-3,4),direction:new V3(Math.cos(angle),Math.sin(angle),0)};
    const old=vm.runInNewContext(axisCode,{window:{},_ray:{ray}}), modern=vm.runInNewContext(axisCode,{window:{TriancleRust:axisBridge},_ray:{ray}});
    const a=old(origin,dir), b=modern(origin,dir);
    if (a === null) assert.equal(b,null); else assert.ok(Math.abs(a-b) < 1e-8);
  }
  assert.equal(axisRuns,1500);
  const remotePartStart=bundle.indexOf("function applyRemotePart(d, owner) {");
  const remotePartEnd=bundle.indexOf("function onPartMsg(",remotePartStart);
  assert.ok(remotePartStart>=0 && remotePartEnd>remotePartStart);
  const remotePartCode="let partId=0;\n"+bundle.slice(remotePartStart,remotePartEnd)+"\napplyRemotePart";
  function remotePartFixture(rust) {
    const userParts=[],events=[]; let runs=0;
    class Vector3 {constructor(){this.x=0;this.y=0;this.z=0;} set(x,y,z){this.x=x;this.y=y;this.z=z;}}
    const custom={...bridge,remotePart:d=>{const v=bridge.remotePart(d);if(v)runs++;return v;}};
    const fn=vm.runInNewContext(remotePartCode,{window:rust?{TriancleRust:custom}:{},userParts,THREE:{Mesh:class{},Vector3},
      scene:{add:()=>events.push("add")},BT_GEO:{Block:1,Ball:1,Cylinder:1},rebuildPart:p=>events.push([p.gid,p.shape,p.size.slice(),p.color,p.transp,p.anchored,p.collide,p.vy,p.pos.x,p.pos.y,p.pos.z])});
    return {fn,events,userParts,runs:()=>runs};
  }
  const builtJs=remotePartFixture(false),builtRust=remotePartFixture(true);
  const colorsToTest=[0,-1,16777215,4294967297,Infinity,-Infinity,NaN,1e100,-1e100,"127.9",null];
  for(let i=0;i<500;i++) {
    const data={g:"piece",sh:["Ball","Block","invalid"][i%3],sz:[-10+i/3, i%7?2:1000, 1+i/10],p:[i/9,-i/11,i/13],c:colorsToTest[i%colorsToTest.length],t:[-1,0,0.25,2,Infinity,NaN,"0.6"][i%7],an:i%2,co:i%3};
    builtJs.fn(data,"owner");builtRust.fn(data,"owner");
    if(i%20===0){builtJs.fn(data,"other");builtRust.fn(data,"other");}
  }
  assert.equal(JSON.stringify(builtRust.events),JSON.stringify(builtJs.events));
  assert.equal(builtRust.runs(),500);
  const solidStart = bundle.indexOf("function syncSolid(pt) {");
  const solidEnd = bundle.indexOf("function rebuildPart(", solidStart);
  assert.ok(solidStart >= 0 && solidEnd > solidStart);
  const solidCode = bundle.slice(solidStart,solidEnd) + "\nsyncSolid";
  function solidFixture(rust, shape, size, collide, initiallyPresent) {
    const pt = {shape, size, pos:{x:2.5,y:-4,z:7}, solid:{}, collide};
    const solids = initiallyPresent ? [pt.solid] : [];
    let calls = 0;
    const custom = {...bridge, builtSolid:p=>{const out=bridge.builtSolid(p);if(out) calls++;return out;}};
    const fn = vm.runInNewContext(solidCode,{window:rust?{TriancleRust:custom}:{},solids});
    fn(pt); return {solid:pt.solid, count:solids.length, calls};
  }
  for (let i = 1; i <= 500; i++) for (const shape of ["Ball","Block"]) for (const collide of [false,true]) {
    const size = [1+i/25,1+i/25,(1+i/25)*(i%3===0?0.95:i%3===1?0.951:1)];
    const expected = solidFixture(false,shape,size,collide,i%2===0), actual = solidFixture(true,shape,size,collide,i%2===0);
    assert.equal(JSON.stringify(actual.solid), JSON.stringify(expected.solid));
    assert.equal(actual.count,expected.count);
    assert.equal(actual.calls,1);
  }
  const geomStart = bundle.indexOf("function addRotatedCollision(");
  const geomEnd = bundle.indexOf("/* one builder for every map", geomStart);
  assert.ok(geomStart >= 0 && geomEnd > geomStart);
  const geomCode = bundle.slice(geomStart, geomEnd) + "\naddRotatedCollision";
  function geometry(rust, args) {
    const solids = [];
    const addSolid = (...p) => solids.push({ flat: p });
    const fn = vm.runInNewContext(geomCode, {window: rust ? {TriancleRust: bridge} : {}, solids, addSolid});
    fn(...args); return solids;
  }
  for (let i = 0; i < 120; i++) {
    const a = i * 0.037, c = Math.cos(a), s = Math.sin(a);
    const args = [2 + (i%9), 1 + (i%5), 3 + (i%7), i/5, i/7, -i/9, [1,0,0,0,c,-s,0,s,c]];
    const expected = geometry(false, args), actual = geometry(true, args);
    assert.equal(actual.length, expected.length, `geometry ${i}`);
    for (let j = 0; j < expected.length; j++) for (const key of Object.keys(expected[j])) {
      if (key === "flat") assert.deepEqual(actual[j][key], expected[j][key]);
      else assert.ok(Math.abs(actual[j][key] - expected[j][key]) < 1e-9, `geometry ${i}, ${j}, ${key}`);
    }
  }
  const sharkSource = fs.readFileSync(path.join(root, "js/data/sharknado-map.js"), "utf8");
  const shark = vm.runInNewContext(sharkSource + "\nSHARK_MAP");
  for (const row of shark.parts) {
    const args = [...row.slice(0, 6), row[6]];
    const expected = geometry(false, args), actual = geometry(true, args);
    assert.equal(actual.length, expected.length, "Sharknado geometry");
    for (let i = 0; i < expected.length; i++) for (const key of Object.keys(expected[i])) {
      if (key === "flat") assert.deepEqual(actual[i][key], expected[i][key]);
      else assert.ok(Math.abs(actual[i][key] - expected[i][key]) < 1e-9, `Sharknado geometry ${i}, ${key}`);
    }
  }
  assert.equal(bridge.tiltedColumns(1, 1, 1, Infinity, 0, 0, [1,0,0,0,1,0,0,0,1]), null);
  console.log(`Bridge comparisons passed: movement, ${responses} horizontal and ${verticals} vertical collisions, ${colors.length} colours, ${climbs} climbing directions, 2001 easing values, ${hsvCases} HSV colours, 400 LZ4 blocks, ${deinterleaveCases} interleaved integers, ${words.length} integer/float words, a synthetic map import, ${angles.length} animation angles, 800 local and 600 remote animation frames.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
