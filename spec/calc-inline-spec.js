describe("calc-inline", () => {
  let editor, editorElement, mainModule;

  beforeEach(async () => {
    jasmine.attachToDOM(lumine.views.getView(lumine.workspace));
    editor = await lumine.workspace.open();
    editorElement = lumine.views.getView(editor);

    lumine.config.set("calc-inline.extendedVariables", true);
    lumine.config.set("calc-inline.withMath", true);
    lumine.config.set("calc-inline.evaluateAllOnEmptySelection", true);
    lumine.config.set("calc-inline.countStartIndex", 0);
    lumine.config.set("calc-inline.evaluationTimeout", 1000);
    lumine.notifications.clear();

    const activation = lumine.packages.activatePackage("calc-inline");
    lumine.commands.dispatch(editorElement, "calc-inline:evaluate");
    mainModule = (await activation).mainModule;
    editor.setText("");
    lumine.notifications.clear();
  });

  afterEach(async () => {
    await lumine.packages.deactivatePackage("calc-inline");
  });

  function dispatch(command) {
    lumine.commands.dispatch(editorElement, command);
  }

  function selectLine(row = 0) {
    editor.setCursorBufferPosition([row, 0]);
    editor.selectToEndOfLine();
  }

  it("registers its editor commands", () => {
    const commands = lumine.commands
      .findCommands({ target: editorElement })
      .map((command) => command.name);

    for (const name of [
      "calc-inline:evaluate",
      "calc-inline:replace",
      "calc-inline:count",
    ]) {
      expect(commands).toContain(name);
    }
  });

  describe("calc-inline:evaluate", () => {
    it("appends the result to a selected expression", () => {
      editor.setText("1 + 2\n2 + 3");
      selectLine();

      dispatch("calc-inline:evaluate");

      expect(editor.getText()).toBe("1 + 2 = 3\n2 + 3");
    });

    it("evaluates multiple selections in one transaction", () => {
      editor.setText("1 + 2\n2 + 3");
      editor.setCursorBufferPosition([0, 0]);
      editor.addCursorAtBufferPosition([1, 0]);
      editor.selectToEndOfLine();

      dispatch("calc-inline:evaluate");

      expect(editor.getText()).toBe("1 + 2 = 3\n2 + 3 = 5");
      editor.undo();
      expect(editor.getText()).toBe("1 + 2\n2 + 3");
    });

    it("preserves zero and false results", () => {
      editor.setText("1 - 1\n1 > 2");
      editor.setCursorBufferPosition([0, 0]);
      editor.addCursorAtBufferPosition([1, 0]);
      editor.selectToEndOfLine();

      dispatch("calc-inline:evaluate");

      expect(editor.getText()).toBe("1 - 1 = 0\n1 > 2 = false");
    });
  });

  describe("calc-inline:replace", () => {
    it("replaces selected expressions and preserves surrounding text", () => {
      editor.setText("before 5 + 5 after");
      editor.setSelectedBufferRange([
        [0, 7],
        [0, 12],
      ]);

      dispatch("calc-inline:replace");

      expect(editor.getText()).toBe("before 10 after");
    });

    it("replaces string results without adding quotes", () => {
      editor.setText('"hello".toUpperCase()');
      editor.selectAll();

      dispatch("calc-inline:replace");

      expect(editor.getText()).toBe("HELLO");
    });

    it("leaves null and undefined results unchanged", () => {
      for (const expression of ["null", "undefined"]) {
        editor.setText(expression);
        editor.selectAll();
        dispatch("calc-inline:replace");
        expect(editor.getText()).toBe(expression);
      }
    });
  });

  describe("empty selections", () => {
    it("evaluates non-comment lines and restores the cursor", () => {
      editor.setText("1 + 2\n// explain\n\n2 + 3");
      editor.setCursorBufferPosition([3, 2]);

      dispatch("calc-inline:evaluate");

      expect(editor.getText()).toBe("1 + 2 = 3\n// explain\n\n2 + 3 = 5");
      expect(editor.getCursorBufferPosition()).toEqual([3, 2]);
    });

    it("does nothing when whole-document evaluation is disabled", () => {
      lumine.config.set("calc-inline.evaluateAllOnEmptySelection", false);
      editor.setText("1 + 2\n2 + 3");
      editor.setCursorBufferPosition([0, 0]);

      dispatch("calc-inline:replace");

      expect(editor.getText()).toBe("1 + 2\n2 + 3");
    });
  });

  describe("calc-inline:count", () => {
    it("numbers empty selections from the configured start index", () => {
      lumine.config.set("calc-inline.countStartIndex", 5);
      editor.setText("\n\n");

      dispatch("calc-inline:count");

      expect(editor.getText()).toBe("5\n6\n");
    });
  });

  describe("extended variables", () => {
    it("provides the selection index and numbered results", () => {
      lumine.config.set("calc-inline.countStartIndex", 5);
      editor.setText("i\n_1 + 2\n_2 + i");

      dispatch("calc-inline:evaluate");

      expect(editor.getText()).toBe("i = 5\n_1 + 2 = 7\n_2 + i = 14");
    });

    it("keeps the previous result across commands", () => {
      editor.setText("6 * 7");
      editor.selectAll();
      dispatch("calc-inline:replace");

      editor.setText("_ + 1");
      editor.selectAll();
      dispatch("calc-inline:replace");

      expect(editor.getText()).toBe("43");
    });

    it("removes magic variables when the feature is disabled", () => {
      editor.setText("6 * 7");
      editor.selectAll();
      dispatch("calc-inline:replace");

      lumine.config.set("calc-inline.extendedVariables", false);
      editor.setText("typeof _");
      editor.selectAll();
      dispatch("calc-inline:replace");

      expect(editor.getText()).toBe("undefined");
    });
  });

  describe("Math helpers", () => {
    it("provides unqualified Math functions when enabled", () => {
      editor.setText("pow(2, 8)");
      editor.selectAll();
      dispatch("calc-inline:replace");
      expect(editor.getText()).toBe("256");
    });

    it("does not provide unqualified Math functions when disabled", () => {
      lumine.config.set("calc-inline.withMath", false);
      editor.setText("typeof pow");
      editor.selectAll();
      dispatch("calc-inline:replace");
      expect(editor.getText()).toBe("undefined");
    });

    it("supports comments in expressions", () => {
      editor.setText("1 + 2 // Math");
      editor.selectAll();
      dispatch("calc-inline:evaluate");
      expect(editor.getText()).toBe("1 + 2 // Math = 3");
    });

    it("generates printable strings with Math.pwd", () => {
      editor.setText("Math.pwd(32).length");
      editor.selectAll();
      dispatch("calc-inline:replace");
      expect(editor.getText()).toBe("32");
    });
  });

  describe("evaluation failures", () => {
    it("keeps the expression and reports an error", () => {
      spyOn(console, "error");
      editor.setText("missingName + 1");
      editor.selectAll();

      dispatch("calc-inline:replace");

      expect(editor.getText()).toBe("missingName + 1");
      const errors = lumine.notifications
        .getNotifications()
        .filter((notification) => notification.getType() === "error");
      expect(errors.length).toBe(1);
      expect(errors[0].getDetail()).toContain("missingName is not defined");
      expect(console.error).toHaveBeenCalled();
    });

    it("stops expressions that exceed the configured timeout", () => {
      spyOn(console, "error");
      lumine.config.set("calc-inline.evaluationTimeout", 25);
      editor.setText("while (true) {}");
      editor.selectAll();

      dispatch("calc-inline:replace");

      expect(editor.getText()).toBe("while (true) {}");
      const errors = lumine.notifications
        .getNotifications()
        .filter((notification) => notification.getType() === "error");
      expect(errors.length).toBe(1);
      expect(errors[0].getDetail()).toContain("timed out");
      expect(console.error).toHaveBeenCalled();
    });
  });

  it("has an initialized sandbox after activation", () => {
    expect(mainModule.sandbox).not.toBeNull();
  });
});
