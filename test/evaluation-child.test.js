"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const path = require("node:path");
const runEvaluationChild = require("./helpers/evaluation-child");

test("delayed runtime bootstrap retains the actual VM execution budget", async (t) => {
  const spawn = childProcess.spawn.bind(childProcess);
  t.mock.method(childProcess, "spawn", (binary, args, options) =>
    spawn(
      binary,
      [
        args[0],
        "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200);\n" +
          args[1],
        ...args.slice(2),
      ],
      options,
    ),
  );
  const source = `const Session=require(${JSON.stringify(path.resolve(__dirname, "../lib/session"))});const evaluate=new Session().begin({start:0,variables:true,math:true,timeout:20});console.log(JSON.stringify(evaluate("6 * 7")));`;
  const result = await runEvaluationChild(source);
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { kind: "value", text: "42" });
  assert.ok(result.startupMs >= 1200);
  assert.ok(result.executionMs < 1000);
  assert.equal(result.reaped, true);
});

test("a host setter outside the VM is still terminated within one second", async () => {
  const result = await runEvaluationChild(
    "const target={set value(_value){while(true){}}};target.value=1;",
  );
  assert.equal(result.error?.code, "ETIMEDOUT");
  assert.match(result.error.message, /execution timed out after 1000ms/);
  assert.equal(result.phase, "execution");
  assert.notEqual(result.status, 0);
  assert.equal(result.reaped, true);
});

test("a runtime that never reaches readiness is bounded and reaped", async (t) => {
  const spawn = childProcess.spawn.bind(childProcess);
  t.mock.method(childProcess, "spawn", (binary, _args, options) =>
    spawn(binary, ["-e", "setInterval(()=>{}, 1000)"], options),
  );
  const result = await runEvaluationChild('console.log("must not run")');
  assert.equal(result.error?.code, "ETIMEDOUT");
  assert.match(result.error.message, /bootstrap timed out after 10000ms/);
  assert.equal(result.phase, "bootstrap");
  assert.equal(result.executionMs, null);
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.reaped, true);
});

test("actual nonzero child exits remain failures", async () => {
  const result = await runEvaluationChild("process.exit(23)");
  assert.equal(result.error, undefined);
  assert.equal(result.status, 23);
  assert.equal(result.reaped, true);
});

test("an unavailable runtime preserves its executable error", async () => {
  const result = await runEvaluationChild(
    "",
    path.join(__dirname, "missing-evaluation-runtime"),
  );
  assert.equal(result.error?.code, "ENOENT");
  assert.notEqual(result.status, 0);
  assert.equal(result.reaped, true);
});
