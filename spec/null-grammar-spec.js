"use strict";

const path = require("node:path");

describe("Calc Inline with no grammar", () => {
  let editor;
  beforeEach(async () => {
    await lumine.packages.activatePackage("language-text");
    await lumine.packages.activatePackage(path.join(__dirname, ".."));
    editor = await lumine.workspace.open();
    editor.setText("1 + 2\n3 + 4");
    lumine.config.set("calc-inline.evaluateAllOnEmptySelection", true);
  });
  afterEach(() => {
    editor?.destroy();
    lumine.config.unset("calc-inline.evaluateAllOnEmptySelection");
  });

  it("does not read or evaluate the whole document and becomes available on resume", () => {
    const grammar = lumine.grammars.grammarForScopeName("text.plain");
    editor.setGrammar(lumine.grammars.nullGrammar);
    spyOn(editor, "getText").and.callThrough();
    for (const action of ["evaluate", "replace", "count"]) {
      expect(
        lumine.commands.canDispatch(
          editor.getElement(),
          `calc-inline:${action}`,
        ),
      ).toBe(false);
      lumine.commands.dispatch(editor.getElement(), `calc-inline:${action}`);
    }
    expect(editor.getText).not.toHaveBeenCalled();
    editor.setGrammar(grammar);
    lumine.commands.dispatch(editor.getElement(), "calc-inline:evaluate");
    expect(editor.getText()).toBe("1 + 2 = 3\n3 + 4 = 7");
  });
});
