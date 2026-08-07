const { CompositeDisposable } = require("atom");
const vm = require("node:vm");

const NO_RESULT = Symbol("no-result");
const DEFAULT_EVALUATION_TIMEOUT = 1000;

module.exports = {
  events: null,
  sandbox: null,
  numberedResults: null,
  selectionIndex: 0,
  resultIndex: 1,

  activate() {
    this.events?.dispose();
    this.events = new CompositeDisposable(
      // On the workspace: the application menu dispatches at whatever holds
      // focus, so an editor scope left every one of these menu items dead
      // whenever focus was elsewhere. Each handler resolves the editor itself.
      atom.commands.add("atom-workspace", {
        "calc-inline:replace": () => this.editorReplace(),
        "calc-inline:evaluate": () => this.editorEvaluate(),
        "calc-inline:count": () => this.editorCount(),
      }),
    );

    this.createSandbox();
  },

  deactivate() {
    this.events?.dispose();
    this.events = null;
    this.sandbox = null;
    this.numberedResults = null;
  },

  createSandbox() {
    this.sandbox = vm.createContext();
    this.numberedResults = new Set();

    vm.runInContext(
      `
        Math.pwd = function(length = 20) {
          if (!Number.isInteger(length) || length < 0) {
            throw new TypeError("Password length must be a non-negative integer");
          }

          let output = "";
          for (let index = 0; index < length; index++) {
            output += String.fromCharCode(Math.floor(Math.random() * 95) + 32);
          }
          return output;
        };
        Math.password = Math.pwd;
      `,
      this.sandbox,
    );
  },

  prepareRun() {
    const configuredStart = atom.config.get("calc-inline.countStartIndex");
    this.selectionIndex = Number.isInteger(configuredStart)
      ? configuredStart
      : 0;
    this.resultIndex = 1;

    this.deleteSandboxProperties(this.numberedResults);
    this.numberedResults.clear();

    if (!atom.config.get("calc-inline.extendedVariables")) {
      this.deleteSandboxProperties(["i", "_"]);
    }
  },

  deleteSandboxProperties(names) {
    const propertyNames = [...names];
    if (propertyNames.length === 0) {
      return;
    }

    const serializedNames = propertyNames
      .map((name) => JSON.stringify(name))
      .join(", ");
    vm.runInContext(
      `for (const name of [${serializedNames}]) delete globalThis[name];`,
      this.sandbox,
    );
  },

  getEvaluationTimeout() {
    const configuredTimeout = atom.config.get("calc-inline.evaluationTimeout");
    return Number.isInteger(configuredTimeout) && configuredTimeout > 0
      ? configuredTimeout
      : DEFAULT_EVALUATION_TIMEOUT;
  },

  calculateResult(expression) {
    let source = expression;
    let variableName = null;

    if (atom.config.get("calc-inline.extendedVariables")) {
      variableName = `_${this.resultIndex}`;
      this.numberedResults.add(variableName);
      this.sandbox.i = this.selectionIndex;
      this.selectionIndex += 1;
      this.resultIndex += 1;
    }

    if (atom.config.get("calc-inline.withMath")) {
      source = `with (Math) {\n${source}\n}`;
    }

    try {
      const result = vm.runInContext(source, this.sandbox, {
        displayErrors: true,
        timeout: this.getEvaluationTimeout(),
      });
      if (variableName) {
        this.sandbox._ = result;
        this.sandbox[variableName] = result;
      }
      return result;
    } catch (error) {
      this.reportEvaluationError(error);
      return NO_RESULT;
    }
  },

  resultText(expression) {
    const result = this.calculateResult(expression);
    if (result === NO_RESULT || result == null) {
      return null;
    }

    try {
      return String(result);
    } catch (error) {
      this.reportEvaluationError(error);
      return null;
    }
  },

  reportEvaluationError(error) {
    console.error("Unable to evaluate Calc Inline expression", error);
    atom.notifications.addError(
      "Calc Inline could not evaluate an expression",
      {
        detail: `${error.name}: ${error.message}`,
        dismissable: true,
      },
    );
  },

  iterateSelections(transform, { includeEmpty = false } = {}) {
    const editor = atom.workspace.getActiveTextEditor();
    if (!editor) {
      return;
    }

    this.prepareRun();
    let originalCursorPosition = null;

    editor.getBuffer().transact(() => {
      const selections = editor.getSelections();
      if (
        atom.config.get("calc-inline.evaluateAllOnEmptySelection") &&
        selections.length === 1 &&
        selections[0].isEmpty()
      ) {
        originalCursorPosition = editor.getCursorBufferPosition();
        editor.selectAll();
        editor.splitSelectionsIntoLines();
      }

      const orderedSelections = [...editor.getSelections()].sort(
        (left, right) => left.compare(right),
      );
      for (const selection of orderedSelections) {
        const text = selection.getText();
        if (!includeEmpty && (selection.isEmpty() || /^\s*\/\//.test(text))) {
          continue;
        }

        const output = transform(selection);
        if (output != null) {
          selection.insertText(String(output));
        }
      }
    });

    if (originalCursorPosition) {
      editor.setCursorBufferPosition(originalCursorPosition);
    }
  },

  editorEvaluate() {
    this.iterateSelections((selection) => {
      const expression = selection.getText();
      const result = this.resultText(expression);
      return result == null ? null : `${expression} = ${result}`;
    });
  },

  editorReplace() {
    this.iterateSelections((selection) => this.resultText(selection.getText()));
  },

  editorCount() {
    const configuredStart = atom.config.get("calc-inline.countStartIndex");
    let index = Number.isInteger(configuredStart) ? configuredStart : 0;
    this.iterateSelections(() => index++, { includeEmpty: true });
  },
};
