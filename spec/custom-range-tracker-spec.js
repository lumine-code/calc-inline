"use strict";

describe("Calc Inline with custom range tracking", () => {
  let editor;
  let buffer;

  beforeEach(async () => {
    jasmine.useRealClock();
    await lumine.packages.activatePackage("language-text");
    await lumine.packages.activatePackage("calc-inline");
    editor = await lumine.workspace.open();
    buffer = editor.getBuffer();
    for (const [key, value] of Object.entries({
      extendedVariables: true,
      withMath: true,
      evaluateAllOnEmptySelection: true,
      countStartIndex: 0,
      evaluationTimeout: 100,
    }))
      lumine.config.set(`calc-inline.${key}`, value);
    lumine.notifications.clear();
  });

  afterEach(async () => {
    await lumine.packages.deactivatePackage("calc-inline");
    editor?.destroy();
  });

  function trackDocument() {
    const texts = [];
    const layer = buffer.addMarkerLayer({
      trackRanges(entries) {
        texts.push(buffer.getText());
        return entries.map(({ id }) => ({ id, range: buffer.getRange() }));
      },
    });
    const marker = layer.markRange(buffer.getRange(), { invalidate: "never" });
    return { texts, marker };
  }

  function command(action) {
    return lumine.commands.dispatch(
      editor.getElement(),
      `calc-inline:${action}`,
    );
  }

  function errors() {
    return lumine.notifications
      .getNotifications()
      .filter((notification) => notification.getType() === "error");
  }

  for (const [action, first, second] of [
    ["replace", "36", "15"],
    ["evaluate", "12 * 3 = 36", "9 + 6 = 15"],
    ["count", "0", "1"],
  ]) {
    it(`${action} preserves surrounding .dat code and tracks each intermediate edit in one undo step`, async () => {
      const original = "let#span 12 * 3\nlet#width 9 + 6";
      editor.setText(original);
      editor.setSelectedBufferRanges([
        [
          [1, 10],
          [1, 15],
        ],
        [
          [0, 9],
          [0, 15],
        ],
      ]);
      const { texts, marker } = trackDocument();

      await command(action);

      const expected = `let#span ${first}\nlet#width ${second}`;
      expect(editor.getText()).toBe(expected);
      expect(texts).toEqual([`let#span ${first}\nlet#width 9 + 6`, expected]);
      expect(marker.getRange()).toEqual(buffer.getRange());
      expect(marker.isValid()).toBe(true);
      expect(errors()).toEqual([]);
      editor.undo();
      expect(editor.getText()).toBe(original);
      editor.redo();
      expect(editor.getText()).toBe(expected);
    });

    it(`${action} restores the cursor after tracking multiple whole-document edits`, async () => {
      editor.setText("12 * 3\n9 + 6");
      editor.setCursorBufferPosition([1, 1]);
      lumine.config.set("calc-inline.countStartIndex", 100);
      const { texts } = trackDocument();
      const expectedFirst = action === "count" ? "100" : first;
      const expectedSecond = action === "count" ? "101" : second;

      await command(action);

      expect(editor.getText()).toBe(`${expectedFirst}\n${expectedSecond}`);
      expect(texts).toEqual([
        `${expectedFirst}\n9 + 6`,
        `${expectedFirst}\n${expectedSecond}`,
      ]);
      expect(editor.getCursorBufferPosition()).toEqual([1, 1]);
      expect(errors()).toEqual([]);
    });
  }

  it("cancels prepared calculations without publishing text or calling the tracker", async () => {
    editor.setText("let#span 12 * 3\n".repeat(30000));
    const original = buffer.getTextSnapshot();
    const { texts } = trackDocument();

    const pending = command("count");
    await lumine.packages.deactivatePackage("calc-inline");
    await pending;

    expect(buffer.getTextSnapshot().equals(original)).toBe(true);
    expect(texts).toEqual([]);
    expect(errors()).toEqual([]);
  });
});
