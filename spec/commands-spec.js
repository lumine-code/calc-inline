"use strict";

describe("Calc Inline command contracts", () => {
  let editor;
  let surface;

  beforeEach(async () => {
    jasmine.attachToDOM(lumine.views.getView(lumine.workspace));
    editor = await lumine.workspace.open();
    surface = lumine.views.getView(editor);
    for (const [key, value] of Object.entries({
      extendedVariables: true,
      withMath: true,
      evaluateAllOnEmptySelection: true,
      countStartIndex: 0,
      evaluationTimeout: 100,
    }))
      lumine.config.set(`calc-inline.${key}`, value);
    await lumine.packages.activatePackage("calc-inline");
    lumine.notifications.clear();
  });

  afterEach(async () => {
    await lumine.packages.deactivatePackage("calc-inline");
  });

  function command(action, target = surface) {
    lumine.commands.dispatch(target, `calc-inline:${action}`);
  }

  it("calculates line batches as one undo operation and preserves the cursor", () => {
    const original = "7 * 9\n// note\n\n_1 + 4";
    editor.setText(original);
    editor.setCursorBufferPosition([3, 2]);
    command("evaluate");
    expect(editor.getText()).toBe("7 * 9 = 63\n// note\n\n_1 + 4 = 67");
    expect(editor.getCursorBufferPosition()).toEqual([3, 2]);
    editor.undo();
    expect(editor.getText()).toBe(original);
  });

  it("replaces selected ranges without touching surrounding text", () => {
    editor.setText("left 9 * 8 right\nnext 4 + 5 end");
    editor.setSelectedBufferRanges([
      [
        [0, 5],
        [0, 10],
      ],
      [
        [1, 5],
        [1, 10],
      ],
    ]);
    command("replace");
    expect(editor.getText()).toBe("left 72 right\nnext 9 end");
  });

  it("orders selection variables by document position", () => {
    lumine.config.set("calc-inline.countStartIndex", 4);
    editor.setText("i\n_1 + i");
    editor.setSelectedBufferRanges([
      [
        [1, 0],
        [1, 6],
      ],
      [
        [0, 0],
        [0, 1],
      ],
    ]);
    command("replace");
    expect(editor.getText()).toBe("4\n9");
  });

  it("dispatches application menu actions from the workspace", () => {
    editor.setText("max(13, 17)");
    editor.selectAll();
    command("replace", lumine.views.getView(lumine.workspace));
    expect(editor.getText()).toBe("17");
  });

  it("uses the editor that received the command rather than an unrelated active editor", async () => {
    editor.setText("21 * 2");
    editor.selectAll();
    const other = await lumine.workspace.open();
    other.setText("untouched");
    command("replace", surface);
    expect(editor.getText()).toBe("42");
    expect(other.getText()).toBe("untouched");
  });

  it("numbers empty document rows and keeps the trailing newline", () => {
    lumine.config.set("calc-inline.countStartIndex", 12);
    editor.setText("\n\n");
    command("count");
    expect(editor.getText()).toBe("12\n13\n");
  });

  it("honours disabled whole-document mode", () => {
    lumine.config.set("calc-inline.evaluateAllOnEmptySelection", false);
    editor.setText("4 * 4\n5 * 5");
    command("replace");
    expect(editor.getText()).toBe("4 * 4\n5 * 5");
  });

  it("keeps unsuccessful expressions and computes later valid input", () => {
    editor.setText("missingValue\n16 / 4\nnull\nfalse");
    command("replace");
    expect(editor.getText()).toBe("missingValue\n4\nnull\nfalse");
    const errors = lumine.notifications
      .getNotifications()
      .filter((notification) => notification.getType() === "error");
    expect(errors.length).toBe(1);
    expect(errors[0].getDetail()).toContain("ReferenceError");
  });

  it("interrupts slow evaluation and slow result formatting", () => {
    lumine.config.set("calc-inline.evaluationTimeout", 15);
    for (const source of [
      "while (true) {}",
      "({toString() { while (true) {} }})",
    ]) {
      editor.setText(source);
      editor.selectAll();
      command("replace");
      expect(editor.getText()).toBe(source);
    }
    expect(
      lumine.notifications
        .getNotifications()
        .filter((notification) => notification.getType() === "error").length,
    ).toBe(2);
  });

  it("creates fresh execution state after reactivation", async () => {
    editor.setText("globalThis.remembered = 81");
    editor.selectAll();
    command("replace");
    await lumine.packages.deactivatePackage("calc-inline");
    await lumine.packages.activatePackage("calc-inline");
    editor.setText("typeof remembered");
    editor.selectAll();
    command("replace");
    expect(editor.getText()).toBe("undefined");
  });
});
