"use strict";

function selectedInputs(editor, wholeDocument) {
  const selections = editor.getSelections();
  if (wholeDocument && selections.length === 1 && selections[0].isEmpty()) {
    const lines = editor.getText().split(/\r\n|\n|\r/);
    if (lines.length > 1 && lines.at(-1) === "") lines.pop();
    return {
      cursor: editor.getCursorBufferPosition(),
      inputs: lines.map((source, row) => ({
        source,
        range: [
          [row, 0],
          [row, source.length],
        ],
      })),
    };
  }
  const inputs = selections.map((selection) => {
    const range = selection.getBufferRange();
    return {
      source: selection.getText(),
      range: [range.start.toArray(), range.end.toArray()],
    };
  });
  inputs.sort(
    (a, b) => a.range[0][0] - b.range[0][0] || a.range[0][1] - b.range[0][1],
  );
  return { inputs, cursor: null };
}

function calculateEdits(inputs, action, evaluate, start) {
  const edits = [];
  const errors = [];
  let index = start;
  for (const input of inputs) {
    if (action === "count") {
      edits.push({ range: input.range, text: String(index++) });
      continue;
    }
    if (!input.source.trim() || /^\s*\/\//.test(input.source)) continue;
    const answer = evaluate(input.source);
    if (answer.kind === "error") errors.push(answer.error);
    if (answer.kind !== "value") continue;
    edits.push({
      range: input.range,
      text:
        action === "replace" ? answer.text : `${input.source} = ${answer.text}`,
    });
  }
  return { edits, errors };
}

function applyEdits(editor, edits, cursor) {
  if (!edits.length) return;
  editor.transact(() => {
    for (const edit of edits.toReversed())
      editor.setTextInBufferRange(edit.range, edit.text);
  });
  if (cursor) editor.setCursorBufferPosition(cursor);
}

module.exports = { selectedInputs, calculateEdits, applyEdits };
