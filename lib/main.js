"use strict";

const EvaluationSession = require("./session");
const { selectedInputs, calculateEdits, applyEdits } = require("./edits");

let registration;
let session;

function execute(action, event) {
  const element = event?.target?.closest?.("lumine-text-editor:not([mini])");
  const editor =
    element?.getModel?.() ?? lumine.workspace.getActiveTextEditor();
  if (!editor) return;
  const option = (key) => lumine.config.get(`calc-inline.${key}`);
  const configuredStart = option("countStartIndex");
  const start = Number.isInteger(configuredStart) ? configuredStart : 0;
  const snapshot = selectedInputs(
    editor,
    option("evaluateAllOnEmptySelection"),
  );
  const evaluate = session.begin({
    start,
    variables: option("extendedVariables"),
    math: option("withMath"),
    timeout: option("evaluationTimeout"),
  });
  const result = calculateEdits(snapshot.inputs, action, evaluate, start);
  applyEdits(editor, result.edits, snapshot.cursor);
  for (const error of result.errors) {
    lumine.notifications.addError("Calculation failed", {
      detail: `${error.name}: ${error.message}`,
      dismissable: true,
    });
  }
}

module.exports = {
  activate() {
    registration?.dispose();
    session = new EvaluationSession();
    registration = lumine.commands.add("lumine-workspace", {
      "calc-inline:evaluate": {
        description: "Append the result of each selected expression.",
        didDispatch: (event) => execute("evaluate", event),
      },
      "calc-inline:replace": {
        description: "Insert the computed values into the selected ranges.",
        didDispatch: (event) => execute("replace", event),
      },
      "calc-inline:count": {
        description:
          "Number the selected ranges from the configured start index.",
        didDispatch: (event) => execute("count", event),
      },
    });
  },

  deactivate() {
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
