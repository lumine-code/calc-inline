"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { spawnSync } = require("node:child_process"),
  path = require("node:path");

for (const name of ["i", "_", "_1", "format"]) {
  test(`reserved ${name} binding cannot run a host-side unbounded setter`, () => {
    const source = `const Session=require(${JSON.stringify(path.resolve(__dirname, "../lib/session"))});const evaluate=new Session().begin({start:0,variables:true,math:true,timeout:20});const name=${JSON.stringify(name)};const code=name==="format"?'const key=Object.getOwnPropertyNames(globalThis).find(n=>n.startsWith("calc_")).replace(/_string$/,"");Object.defineProperty(globalThis,key,{configurable:true,set(){while(true){}}});1':'Object.defineProperty(globalThis,'+JSON.stringify(name)+',{configurable:true,set(){while(true){}}});1';const first=evaluate(code);const second=name==="i"?evaluate("2"):null;console.log(JSON.stringify({first,second}));`;
    const result = spawnSync(process.execPath, ["-e", source], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 1000,
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
    const data = JSON.parse(result.stdout);
    assert.equal(data.first.kind, "value");
    if (name === "i")
      assert.deepEqual(data.second, { kind: "value", text: "2" });
  });
}

for (const mode of ["error", "formatter"]) {
  test(`${mode} data cannot invoke host coercion outside the VM budget`, () => {
    const command =
      mode === "error"
        ? "throw new Proxy({}, {get(){while(true){}}})"
        : 'const key=Object.getOwnPropertyNames(globalThis).find(n=>n.startsWith("calc_")&&n.endsWith("_string"));globalThis[key]=()=>({toString(){while(true){}}});1';
    const source = `const Session=require(${JSON.stringify(path.resolve(__dirname, "../lib/session"))});const evaluate=new Session().begin({start:0,variables:true,math:true,timeout:20});const answer=evaluate(${JSON.stringify(command)});console.log(JSON.stringify({kind:answer.kind,name:String(answer.error?.name),message:String(answer.error?.message),text:answer.text==null?null:String(answer.text)}));`;
    const result = spawnSync(process.execPath, ["-e", source], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 1000,
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
    const answer = JSON.parse(result.stdout);
    assert.equal(answer.kind, "error");
    assert.equal(typeof answer.name, "string");
    assert.equal(typeof answer.message, "string");
  });
}

test("prototype setters are bypassed and nonconfigurable conflicts are caught", () => {
  const source = `const Session=require(${JSON.stringify(path.resolve(__dirname, "../lib/session"))});const s=new Session(),options={start:0,variables:true,math:true,timeout:20},evaluate=s.begin(options);evaluate('delete globalThis.i;delete globalThis._;Object.setPrototypeOf(globalThis,{set i(v){while(true){}},set _(v){while(true){}}});1');const value=evaluate('2');const bad=evaluate('Object.defineProperty(globalThis,"i",{configurable:false,set(){while(true){}}});3');const conflict=evaluate('4');console.log(JSON.stringify({value,badKind:bad.kind,conflictKind:conflict.kind,errorName:String(conflict.error?.name)}));`;
  const result = spawnSync(process.execPath, ["-e", source], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 1000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  const answer = JSON.parse(result.stdout);
  assert.deepEqual(answer.value, { kind: "value", text: "2" });
  assert.equal(answer.conflictKind, "error");
  assert.equal(answer.errorName, "TypeError");
});

test("Promise microtasks remain inside the evaluation deadline", () => {
  const source = `const Session=require(${JSON.stringify(path.resolve(__dirname, "../lib/session"))});const evaluate=new Session().begin({start:0,variables:true,math:true,timeout:20});const bad=evaluate('Promise.resolve().then(()=>{while(true){}})');console.log(JSON.stringify({kind:bad.kind,message:String(bad.error?.message)}));`;
  const result = spawnSync(process.execPath, ["-e", source], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 1000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).kind, "error");
});
test("ordinary Promise values and bounded microtasks retain their synchronous contract", () => {
  const Session = require("../lib/session");
  const evaluate = new Session().begin({
    start: 0,
    variables: true,
    math: true,
    timeout: 100,
  });
  assert.deepEqual(evaluate("Promise.resolve(7)"), {
    kind: "value",
    text: "[object Promise]",
  });
  assert.deepEqual(
    evaluate("Promise.resolve().then(()=>globalThis.microtaskValue=9);'ready'"),
    { kind: "value", text: "ready" },
  );
  assert.deepEqual(evaluate("microtaskValue"), { kind: "value", text: "9" });
});

test("error snapshots remain safe after mutable String, JSON and VM prototype changes", () => {
  const source = `const Session=require(${JSON.stringify(path.resolve(__dirname, "../lib/session"))});const s=new Session(),e=s.begin({start:0,variables:true,math:true,timeout:20});const result=e('String=null;JSON=null;Object.prototype.toJSON=function(){while(true){}};throw new TypeError("ordinary failure")');console.log(JSON.stringify({kind:result.kind,name:result.error.name,message:result.error.message}));`;
  const result = spawnSync(process.execPath, ["-e", source], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 1000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    kind: "error",
    name: "TypeError",
    message: "ordinary failure",
  });
});
test("untrusted setup errors also become host-safe snapshots", () => {
  const source = `const S=require(${JSON.stringify(path.resolve(__dirname, "../lib/session"))});const s=new S(),o={start:0,variables:true,math:true,timeout:20};s.begin(o)('Reflect={deleteProperty(){throw new Proxy({}, {get(){while(true){}}})}};1');const result=s.begin(o)('2');console.log(JSON.stringify(result));`;
  const result = spawnSync(process.execPath, ["-e", source], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 1000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).kind, "error");
});
