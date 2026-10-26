describe("Calc command timeout boundary snapshots", () => {
  beforeEach(async () => {
    await lumine.packages.activatePackage("language-text");
  });

  let editor;
  beforeEach(async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    await lumine.packages.activatePackage("calc-inline");
    editor = await lumine.workspace.open();
    lumine.config.set("calc-inline.evaluationTimeout", 20);
  });
  for (const source of [
    "throw new Proxy({}, {get(){while(true){}}})",
    "Promise.resolve().then(()=>{while(true){}})",
  ]) {
    it(`reports a bounded error without editing the source for ${source}`, async () => {
      editor.setText(source);
      editor.selectAll();
      const error = spyOn(lumine.notifications, "addError").and.callThrough();
      await lumine.commands.dispatch(
        lumine.views.getView(editor),
        "calc-inline:replace",
      );
      expect(error).toHaveBeenCalled();
      expect(typeof error.calls.mostRecent().args[1].detail).toBe("string");
      expect(editor.getText()).toBe(source);
    });
  }
});
