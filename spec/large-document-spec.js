describe("Calc Inline snapshot batch editing", () => {
  let editor;
  beforeEach(async () => {
    jasmine.useRealClock();
    await lumine.packages.activatePackage("language-text");
    await lumine.packages.activatePackage("calc-inline");
    editor = await lumine.workspace.open();
    lumine.config.set("calc-inline.evaluateAllOnEmptySelection", true);
    lumine.config.set("calc-inline.countStartIndex", 0);
  });
  afterEach(async () => {
    await lumine.packages.deactivatePackage("calc-inline");
    editor?.destroy();
  });
  const run = (action) =>
    lumine.commands.dispatch(editor.getElement(), `calc-inline:${action}`);

  it("numbers a giant selected range without reading it and restores it with one undo", async () => {
    editor.setText("x".repeat(1024 * 1024));
    editor.selectAll();
    const original = editor.getBuffer().getTextSnapshot();
    const read = spyOn(editor.getLastSelection(), "getText").and.throwError(
      "unbounded source",
    );
    await run("count");
    expect(read).not.toHaveBeenCalled();
    read.and.callThrough();
    expect(editor.getText()).toBe("0");
    editor.undo();
    expect(editor.getBuffer().getTextSnapshot().equals(original)).toBeTrue();
  });

  it("numbers many rows using source coordinates and preserves mixed line separators", async () => {
    const original = "a\rb\r\nc\n".repeat(10000);
    editor.setText(original);
    const read = spyOn(editor, "getText").and.throwError("whole document read");
    await run("count");
    expect(read).not.toHaveBeenCalled();
    read.and.callThrough();
    expect(editor.getText()).toBe(
      Array.from(
        { length: 10000 },
        (_, index) => `${index * 3}\r${index * 3 + 1}\r\n${index * 3 + 2}\n`,
      ).join(""),
    );
    editor.undo();
    expect(editor.getText()).toBe(original);
  });

  it("rejects an oversized expression before reading it and commits no earlier edits", async () => {
    editor.setText("1 + 2\n1" + " ".repeat(65537));
    const original = editor.getBuffer().getTextSnapshot();
    await run("replace");
    expect(editor.getBuffer().getTextSnapshot().equals(original)).toBeTrue();
    expect(
      lumine.notifications.getNotifications().at(-1).getDetail(),
    ).toContain("65536");
  });

  it("does not publish a prepared batch after deactivation or a concurrent edit", async () => {
    editor.setText("row\n".repeat(30000));
    const original = editor.getBuffer().getTextSnapshot();
    const pending = run("count");
    await lumine.packages.deactivatePackage("calc-inline");
    await pending;
    expect(editor.getBuffer().getTextSnapshot().equals(original)).toBeTrue();
    await lumine.packages.activatePackage("calc-inline");
    const newer = run("count");
    editor.getBuffer().append("external");
    const changed = editor.getBuffer().getTextSnapshot();
    await newer;
    expect(editor.getBuffer().getTextSnapshot().equals(changed)).toBeTrue();
  });

  it("skips giant blank/comment lines without compiling or extracting them", async () => {
    const blank = " ".repeat(70000),
      comment = "//" + "x".repeat(70000);
    editor.setText(`${blank}\n${comment}\n1 + 2`);
    await run("replace");
    expect(editor.getText()).toBe(`${blank}\n${comment}\n3`);
  });

  it("rejects oversized formatted output without committing earlier edits", async () => {
    editor.setText('1 + 2\n"x".repeat(65537)');
    const original = editor.getBuffer().getTextSnapshot();
    await run("replace");
    expect(editor.getBuffer().getTextSnapshot().equals(original)).toBeTrue();
    expect(
      lumine.notifications.getNotifications().at(-1).getDetail(),
    ).toContain("output budget");
  });
});
