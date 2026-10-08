"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Session = require("../lib/session");
const { calculateEdits } = require("../lib/edits");

const defaults = { start: 0, variables: true, math: true, timeout: 100 };

test("supports JavaScript values and reports syntax errors separately", () => {
  const evaluate = new Session().begin(defaults);
  for (const [source, expected] of [
    ["17 * 3", "51"],
    ["false", "false"],
    ["0", "0"],
    ["0n", "0"],
    ["Symbol('sample')", "Symbol(sample)"],
    ["[2, 4, 8]", "2,4,8"],
  ]) {
    assert.deepEqual(evaluate(source), { kind: "value", text: expected });
  }
  assert.equal(evaluate("null").kind, "empty");
  assert.equal(evaluate("undefined").kind, "empty");
  assert.equal(evaluate("(").error.name, "SyntaxError");
});

test("keeps a session's previous value while resetting each batch's numbered values", () => {
  const session = new Session();
  let evaluate = session.begin({ ...defaults, start: 8 });
  assert.equal(evaluate("i * 2").text, "16");
  assert.equal(evaluate("_1 + i").text, "25");
  evaluate = session.begin(defaults);
  assert.equal(evaluate("_ + 5").text, "30");
  assert.equal(evaluate("typeof _2").text, "undefined");
  evaluate = session.begin({ ...defaults, variables: false });
  assert.equal(
    evaluate("typeof i + ':' + typeof _").text,
    "undefined:undefined",
  );
});

test("isolates package activations and supports ordinary persistent bindings", () => {
  const one = new Session();
  const evaluate = one.begin(defaults);
  assert.equal(evaluate("globalThis.saved = 19").text, "19");
  assert.equal(one.begin(defaults)("saved + 2").text, "21");
  assert.equal(new Session().begin(defaults)("typeof saved").text, "undefined");
});

test("restores user globals when Math shortcuts are turned off", () => {
  const session = new Session();
  session.begin({ ...defaults, math: false })("globalThis.max = 'user value'");
  assert.equal(session.begin(defaults)("max(12, 31)").text, "31");
  assert.equal(
    session.begin({ ...defaults, math: false })("max").text,
    "user value",
  );
  assert.equal(
    session.begin({ ...defaults, math: false })("typeof pow").text,
    "undefined",
  );
});

test("bounds evaluation and result formatting, then permits later input", () => {
  const evaluate = new Session().begin({ ...defaults, timeout: 15 });
  assert.match(evaluate("for (;;) {}").error.message, /timed out/);
  assert.match(
    evaluate("({toString() { for (;;) {} }})").error.message,
    /timed out/,
  );
  assert.equal(evaluate("6 * 11").text, "66");
});

test("formats results even if evaluated code changes the global String binding", () => {
  const evaluate = new Session().begin(defaults);
  evaluate("String = null");
  assert.equal(
    evaluate("({toString() { return 'rendered'; }})").text,
    "rendered",
  );
});

test("provides printable strings through the documented Math helpers", () => {
  const evaluate = new Session().begin(defaults);
  for (const source of ["Math.pwd(43)", "Math.password(43)", "pwd(43)"]) {
    const value = evaluate(source);
    assert.equal(value.kind, "value");
    assert.match(value.text, /^[\x20-\x7e]{43}$/);
  }
  assert.equal(evaluate("Math.pwd().length").text, "20");
  assert.equal(evaluate("Math.pwd(0)").text, "");
  assert.equal(evaluate("Math.pwd(-3)").kind, "error");
});

test("plans a batch without changing skipped inputs or losing successful neighbours", () => {
  const sources = [
    "// explanation",
    "  ",
    "23 - 9",
    "notDefined",
    "_ + 10",
    "null",
  ];
  const inputs = sources.map((source, row) => ({
    source,
    range: [
      [row, 0],
      [row, source.length],
    ],
  }));
  const planned = calculateEdits(
    inputs,
    "evaluate",
    new Session().begin(defaults),
    0,
  );
  assert.deepEqual(
    planned.edits.map((entry) => entry.text),
    ["23 - 9 = 14", "_ + 10 = 24"],
  );
  assert.equal(planned.errors.length, 1);
  assert.equal(planned.errors[0].name, "ReferenceError");
});

test("numbers every selected range including empty selections without evaluation", () => {
  const inputs = ["", "comment", ""].map((source, row) => ({
    source,
    range: [
      [row, 0],
      [row, source.length],
    ],
  }));
  const planned = calculateEdits(
    inputs,
    "count",
    () => {
      throw new Error("unexpected evaluation");
    },
    -2,
  );
  assert.deepEqual(
    planned.edits.map((entry) => entry.text),
    ["-2", "-1", "0"],
  );
});
