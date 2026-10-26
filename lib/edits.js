"use strict";

function selectedInputs(editor, wholeDocument) {
  const source = editor.getBuffer().getTextSnapshot();
  const selections = editor.getSelections();
  if (wholeDocument && selections.length === 1 && selections[0].isEmpty()) {
    return {
      cursor: editor.getCursorBufferPosition(),
      inputs: lineInputs(source),
    };
  }
  const inputs = selections.map((selection) => {
    const range = selection.getBufferRange();
    return {
      sourceSnapshot: source.subtext(
        source.offsetAt(range.start),
        source.offsetAt(range.end),
      ),
      range: [range.start.toArray(), range.end.toArray()],
    };
  });
  inputs.sort(
    (a, b) => a.range[0][0] - b.range[0][0] || a.range[0][1] - b.range[0][1],
  );
  return { inputs, cursor: null };
}

function* lineInputs(source) {
  let start = 0,
    offset = 0;
  const input = (end) => ({
    sourceSnapshot: source.subtext(start, end),
    range: [source.positionAt(start), source.positionAt(end)],
  });
  for (const chunk of source.chunks()) {
    for (const match of chunk.matchAll(/[\r\n]/g)) {
      const end = offset + match.index;
      if (end < start) continue;
      yield input(end);
      start =
        end +
        (source.charCodeAt(end) === 13 && source.charCodeAt(end + 1) === 10
          ? 2
          : 1);
    }
    offset += chunk.length;
  }
  if (start < source.length || source.length === 0) yield input(source.length);
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

module.exports = { selectedInputs, calculateEdits };
