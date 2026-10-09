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

// Reserved bindings belong to the session. Define data properties rather than
// assigning through user accessors, which would execute outside a VM timeout.
function bindValue(context, name, value) {
  Object.defineProperty(context, name, {
    value,
    configurable: true,
    writable: true,
    enumerable: true,
  });
}

class EvaluationSession {
  #context = createContext(Object.create(null), {
    microtaskMode: "afterEvaluate",
  });
  #resultNames = [];
  #mathNames = [];
  #savedGlobals = new Map();
  #formatKey = `calc_${randomUUID().replaceAll("-", "")}`;
  #stringKey = `${this.#formatKey}_string`;
  #errorKey = `${this.#formatKey}_error`;
  #formatter = new Script(
    `globalThis[${JSON.stringify(this.#stringKey)}](globalThis[${JSON.stringify(this.#formatKey)}])`,
  );
  #errorFormatter = new Script(`
    (() => {
      try {
        const error = globalThis[${JSON.stringify(this.#errorKey)}];
        const name = error == null ? undefined : error.name;
        const message = error == null ? undefined : error.message;
        return {
          name: typeof name === "string" ? name : "Error",
          message: typeof message === "string" ? message :
            globalThis[${JSON.stringify(this.#stringKey)}](error)
        };
      } catch {
        return {name: "Error", message: "Unable to read calculation error"};
      }
    })()
  `);

  constructor() {
    initialize.runInContext(this.#context);
    bindValue(
      this.#context,
      this.#stringKey,
      new Script("String").runInContext(this.#context),
    );
  }

  begin({ start, variables, math, timeout }) {
    const budget = Number.isInteger(timeout) && timeout > 0 ? timeout : 1000;
    try {
      for (const name of this.#resultNames)
        Reflect.deleteProperty(this.#context, name);
      this.#resultNames = [];
      if (this.#mathNames.length) {
        new Script(`
        for (const name of ${JSON.stringify(this.#mathNames)}) {
          Reflect.deleteProperty(globalThis, name);
        }
      `).runInContext(this.#context, { timeout: budget, displayErrors: false });
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
      `).runInContext(this.#context, { timeout: budget, displayErrors: false });
      }
      if (!variables) {
        Reflect.deleteProperty(this.#context, "i");
        Reflect.deleteProperty(this.#context, "_");
      }
    } catch (error) {
      const details = this.normalizeError(error, budget);
      return () => ({ kind: "error", error: details });
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
        if (settings.variables)
          bindValue(this.#context, "i", settings.start + position);
        const value = new Script(source, {
          filename: "calc-inline-expression",
        }).runInContext(this.#context, {
          timeout: settings.timeout,
          displayErrors: false,
        });
        if (settings.variables) {
          const name = `_${position + 1}`;
          bindValue(this.#context, "_", value);
          bindValue(this.#context, name, value);
          this.#resultNames.push(name);
        }
        if (value == null) return { kind: "empty" };
        bindValue(this.#context, this.#formatKey, value);
        const text = this.#formatter.runInContext(this.#context, {
          timeout: settings.timeout,
          displayErrors: false,
        });
        if (typeof text !== "string") {
          throw new TypeError("Calculation formatter did not return a string");
        }
        return { kind: "value", text };
      } catch (error) {
        return {
          kind: "error",
          error: this.normalizeError(error, settings.timeout),
        };
      } finally {
        Reflect.deleteProperty(this.#context, this.#formatKey);
      }
    };
  }

  normalizeError(error, timeout) {
    const fallback = {
      name: "Error",
      message: "Unable to read calculation error",
    };
    try {
      bindValue(this.#context, this.#errorKey, error);
      const details = this.#errorFormatter.runInContext(this.#context, {
        timeout,
        displayErrors: false,
      });
      // The VM formatter owns these literal data fields. Copy only verified
      // primitives into a host DTO; never return its possibly modified prototype.
      if (
        typeof details.name !== "string" ||
        typeof details.message !== "string"
      )
        return fallback;
      return { name: details.name, message: details.message };
    } catch {
      return fallback;
    } finally {
      Reflect.deleteProperty(this.#context, this.#errorKey);
    }
  }
}

module.exports = EvaluationSession;
