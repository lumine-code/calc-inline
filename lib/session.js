"use strict";

const { createContext, Script } = require("node:vm");
const { randomUUID } = require("node:crypto");

const initialize = new Script(`
  (() => {
    const printable = (size = 20) => {
      if (!Number.isInteger(size) || size < 0) {
        throw new RangeError("Expected a non-negative integer length");
      }
      return Array.from({ length: size }, () =>
        String.fromCodePoint(32 + Math.trunc(95 * Math.random()))
      ).join("");
    };
    Object.assign(Math, { pwd: printable, password: printable });
  })();
`);

const mathNames = Object.getOwnPropertyNames(Math).filter(
  (name) => name !== "__proto__",
);

class EvaluationSession {
  #context = createContext(Object.create(null));
  #resultNames = [];
  #mathNames = [];
  #savedGlobals = new Map();
  #formatKey = `calc_${randomUUID().replaceAll("-", "")}`;
  #stringKey = `${this.#formatKey}_string`;
  #formatter = new Script(
    `globalThis[${JSON.stringify(this.#stringKey)}](globalThis[${JSON.stringify(this.#formatKey)}])`,
  );

  constructor() {
    initialize.runInContext(this.#context);
    this.#context[this.#stringKey] = new Script("String").runInContext(
      this.#context,
    );
  }

  begin({ start, variables, math, timeout }) {
    const budget = Number.isInteger(timeout) && timeout > 0 ? timeout : 1000;
    for (const name of this.#resultNames)
      Reflect.deleteProperty(this.#context, name);
    this.#resultNames = [];
    if (this.#mathNames.length) {
      new Script(`
        for (const name of ${JSON.stringify(this.#mathNames)}) {
          Reflect.deleteProperty(globalThis, name);
        }
      `).runInContext(this.#context, { timeout: budget });
    }
    for (const name of this.#mathNames) {
      const previous = this.#savedGlobals.get(name);
      if (previous) Object.defineProperty(this.#context, name, previous);
      else Reflect.deleteProperty(this.#context, name);
    }
    this.#mathNames = [];
    this.#savedGlobals.clear();
    if (math) {
      this.#mathNames = [...mathNames, "pwd", "password"];
      for (const name of this.#mathNames) {
        this.#savedGlobals.set(
          name,
          Object.getOwnPropertyDescriptor(this.#context, name),
        );
      }
      new Script(`
        for (const name of ${JSON.stringify(this.#mathNames)}) {
          Object.defineProperty(globalThis, name, {
            configurable: true,
            get: () => Math[name],
            set: value => { Math[name] = value; }
          });
        }
      `).runInContext(this.#context, { timeout: budget });
    }
    if (!variables) {
      Reflect.deleteProperty(this.#context, "i");
      Reflect.deleteProperty(this.#context, "_");
    }
    const settings = {
      start: Number.isInteger(start) ? start : 0,
      variables,
      timeout: budget,
    };
    let ordinal = 0;
    return (source) => {
      const position = ordinal++;
      try {
        if (settings.variables) this.#context.i = settings.start + position;
        const value = new Script(source, {
          filename: "calc-inline-expression",
        }).runInContext(this.#context, { timeout: settings.timeout });
        if (settings.variables) {
          const name = `_${position + 1}`;
          this.#context._ = value;
          this.#context[name] = value;
          this.#resultNames.push(name);
        }
        if (value == null) return { kind: "empty" };
        this.#context[this.#formatKey] = value;
        const text = this.#formatter.runInContext(this.#context, {
          timeout: settings.timeout,
        });
        return { kind: "value", text };
      } catch (error) {
        return { kind: "error", error };
      } finally {
        Reflect.deleteProperty(this.#context, this.#formatKey);
      }
    };
  }
}

module.exports = EvaluationSession;
