"use strict";

const EvaluationSession = require("./session");
const { selectedInputs } = require("./edits");
const { CompositeDisposable } = require("lumine");
const MAX_EXPRESSION_LENGTH = 65536;
const MAX_RETAINED_RESULTS = 10000;

let registration;
let session;
let pending;

async function execute(action, event) {
  const element = event?.target?.closest?.("lumine-text-editor:not([mini])");
  const editor = element?.getModel?.();
  if (!editor || editor.getGrammar() === lumine.grammars.nullGrammar) return;
  pending?.controller.abort();
  const request = (pending = { controller: new AbortController() });
  const buffer = editor.getBuffer();
  const revision = buffer.getTextRevision();
  const grammar = editor.getGrammar();
  const subscriptions = new CompositeDisposable(
    editor.onDidDestroy(() => request.controller.abort()),
    editor.onDidChangeGrammar(() => request.controller.abort()),
    editor.onDidChangeSelectionRange(() => {
      if (buffer.getTextRevision() === revision) request.controller.abort();
    }),
  );
  const option = (key) => lumine.config.get(`calc-inline.${key}`);
  const configuredStart = option("countStartIndex");
  const start = Number.isInteger(configuredStart) ? configuredStart : 0;
  const snapshot = selectedInputs(
    editor,
    option("evaluateAllOnEmptySelection"),
  );
  const variables = option("extendedVariables");
  const evaluate =
    action === "count"
      ? null
      : session.begin({
          start,
          variables,
          math: option("withMath"),
          timeout: option("evaluationTimeout"),
        });
  const errors = [];
  let errorCount = 0;
  const failBudget = (message) =>
    Object.assign(new Error(message), { code: "ERR_CALC_INPUT_BUDGET" });
  async function ignoredLargeInput(source) {
    let offset = 0,
      deadline = performance.now() + 4;
    for (const chunk of source.chunks()) {
      request.controller.signal.throwIfAborted();
      const first = chunk.search(/\S/);
      if (first >= 0)
        return (
          source.charCodeAt(offset + first) === 47 &&
          source.charCodeAt(offset + first + 1) === 47
        );
      offset += chunk.length;
      if (performance.now() >= deadline) {
        await new Promise((resolve) => setImmediate(resolve));
        deadline = performance.now() + 4;
      }
    }
    return true;
  }
  async function* edits() {
    let batch = [],
      index = start,
      evaluated = 0,
      deadline = performance.now() + 4;
    for (const input of snapshot.inputs) {
      request.controller.signal.throwIfAborted();
      if (action === "count")
        batch.push({ range: input.range, text: String(index++) });
      else {
        if (input.sourceSnapshot.length > MAX_EXPRESSION_LENGTH) {
          if (await ignoredLargeInput(input.sourceSnapshot)) continue;
          throw failBudget(
            "An expression exceeds the 65536 UTF-16 compilation input budget.",
          );
        }
        const source = input.sourceSnapshot.slice(0);
        if (source.trim() && !/^\s*\/\//.test(source)) {
          if (variables && ++evaluated > MAX_RETAINED_RESULTS)
            throw failBudget(
              "Extended variables retain at most 10000 results per run. Disable Extended Variables to evaluate more expressions.",
            );
          const answer = evaluate(source);
          if (answer.kind === "error") {
            errorCount++;
            if (errors.length < 20) errors.push(answer.error);
          } else if (answer.kind === "value") {
            if (answer.text.length > MAX_EXPRESSION_LENGTH)
              throw failBudget(
                "A calculation result exceeds the 65536 UTF-16 output budget.",
              );
            batch.push({
              range: input.range,
              text:
                action === "replace"
                  ? answer.text
                  : input.sourceSnapshot.replace(
                      input.sourceSnapshot.length,
                      input.sourceSnapshot.length,
                      ` = ${answer.text}`,
                    ),
            });
          }
        }
      }
      if (batch.length === 512) {
        yield batch;
        batch = [];
      }
      if (performance.now() >= deadline) {
        await new Promise((resolve) => setImmediate(resolve));
        deadline = performance.now() + 4;
      }
    }
    if (batch.length) yield batch;
  }
  try {
    await buffer.applyTextEdits(edits(), {
      expectedRevision: revision,
      signal: request.controller.signal,
      isCurrent: () =>
        pending === request &&
        !editor.isDestroyed() &&
        !editor.isReadOnly() &&
        editor.getGrammar() === grammar,
    });
    if (
      snapshot.cursor &&
      !editor.isDestroyed() &&
      buffer.getTextRevision() <= revision + 1
    )
      editor.setCursorBufferPosition(snapshot.cursor);
    for (const error of errors)
      lumine.notifications.addError("Calculation failed", {
        detail: `${error.name}: ${error.message}`,
        dismissable: true,
      });
    if (errorCount > errors.length)
      lumine.notifications.addError("More calculations failed", {
        detail: `${errorCount - errors.length} additional errors were omitted from notifications.`,
        dismissable: true,
      });
  } catch (error) {
    if (error.name !== "AbortError")
      lumine.notifications.addError("Calculation failed", {
        detail: error.message,
        dismissable: true,
      });
  } finally {
    subscriptions.dispose();
    if (pending === request) pending = null;
  }
}

module.exports = {
  activate() {
    registration?.dispose();
    session = new EvaluationSession();
    const hasGrammar = ({ target }) => {
      const editor = lumine.workspace.getTextEditorForElement(target, {
        includeMini: false,
      });
      return Boolean(
        editor && editor.getGrammar() !== lumine.grammars.nullGrammar,
      );
    };
    registration = lumine.commands.add(
      "lumine-text-editor:not([mini]):not([readonly])",
      {
        "calc-inline:evaluate": {
          isAvailable: hasGrammar,
          description: "Append the result of each selected expression.",
          didDispatch: (event) => execute("evaluate", event),
        },
        "calc-inline:replace": {
          isAvailable: hasGrammar,
          description: "Insert the computed values into the selected ranges.",
          didDispatch: (event) => execute("replace", event),
        },
        "calc-inline:count": {
          isAvailable: hasGrammar,
          description:
            "Number the selected ranges from the configured start index.",
          didDispatch: (event) => execute("count", event),
        },
      },
    );
  },

  deactivate() {
    pending?.controller.abort();
    pending = null;
    registration?.dispose();
    registration = null;
    session = null;
  },

  provideBackgroundTips() {
    return {
      packageName: "calc-inline",
      tips: [
        "{% if keys['calc-inline:replace'] %}Insert calculated values into your selections with {{ 'calc-inline:replace' | keystroke }}{% else %}Calc Inline can replace selected JavaScript expressions with their calculated values.{% endif %}",
      ],
    };
  },
};
