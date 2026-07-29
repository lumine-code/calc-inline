describe("calc", () => {
  let editor, editorElement, mainModule;

  beforeEach(async () => {
    jasmine.attachToDOM(atom.views.getView(atom.workspace));
    editor = await atom.workspace.open();
    editorElement = atom.views.getView(editor);

    atom.config.set("calc.extendedVariables", true);
    atom.config.set("calc.withMath", true);
    atom.config.set("calc.evaluateAllOnEmptySelection", true);
    atom.config.set("calc.countStartIndex", 0);
    atom.config.set("calc.evaluationTimeout", 1000);
    atom.notifications.clear();

    const activation = atom.packages.activatePackage("calc");
    atom.commands.dispatch(editorElement, "calc:evaluate");
    mainModule = (await activation).mainModule;
    editor.setText("");
    atom.notifications.clear();
  });

  afterEach(async () => {
    await atom.packages.deactivatePackage("calc");
  });

  function dispatch(command) {
    atom.commands.dispatch(editorElement, command);
  }

  function selectLine(row = 0) {
    editor.setCursorBufferPosition([row, 0]);
    editor.selectToEndOfLine();
  }

  it("registers its editor commands", () => {
    const commands = atom.commands
      .findCommands({ target: editorElement })
      .map((command) => command.name);

    for (const name of ["calc:evaluate", "calc:replace", "calc:count"]) {
      expect(commands).toContain(name);
    }
  });

  describe("calc:evaluate", () => {
    it("appends the result to a selected expression", () => {
      editor.setText("1 + 2\n2 + 3");
      selectLine();

      dispatch("calc:evaluate");

      expect(editor.getText()).toBe("1 + 2 = 3\n2 + 3");
    });

    it("evaluates multiple selections in one transaction", () => {
      editor.setText("1 + 2\n2 + 3");
      editor.setCursorBufferPosition([0, 0]);
      editor.addCursorAtBufferPosition([1, 0]);
      editor.selectToEndOfLine();

      dispatch("calc:evaluate");

      expect(editor.getText()).toBe("1 + 2 = 3\n2 + 3 = 5");
      editor.undo();
      expect(editor.getText()).toBe("1 + 2\n2 + 3");
    });

    it("preserves zero and false results", () => {
      editor.setText("1 - 1\n1 > 2");
      editor.setCursorBufferPosition([0, 0]);
      editor.addCursorAtBufferPosition([1, 0]);
      editor.selectToEndOfLine();

      dispatch("calc:evaluate");

      expect(editor.getText()).toBe("1 - 1 = 0\n1 > 2 = false");
    });
  });

  describe("calc:replace", () => {
    it("replaces selected expressions and preserves surrounding text", () => {
      editor.setText("before 5 + 5 after");
      editor.setSelectedBufferRange([
        [0, 7],
        [0, 12],
      ]);

      dispatch("calc:replace");

      expect(editor.getText()).toBe("before 10 after");
    });

    it("replaces string results without adding quotes", () => {
      editor.setText('"hello".toUpperCase()');
      editor.selectAll();

      dispatch("calc:replace");

      expect(editor.getText()).toBe("HELLO");
    });

    it("leaves null and undefined results unchanged", () => {
      for (const expression of ["null", "undefined"]) {
        editor.setText(expression);
        editor.selectAll();
        dispatch("calc:replace");
        expect(editor.getText()).toBe(expression);
      }
    });
  });

  describe("empty selections", () => {
    it("evaluates non-comment lines and restores the cursor", () => {
      editor.setText("1 + 2\n// explain\n\n2 + 3");
      editor.setCursorBufferPosition([3, 2]);

      dispatch("calc:evaluate");

      expect(editor.getText()).toBe("1 + 2 = 3\n// explain\n\n2 + 3 = 5");
      expect(editor.getCursorBufferPosition()).toEqual([3, 2]);
    });

    it("does nothing when whole-document evaluation is disabled", () => {
      atom.config.set("calc.evaluateAllOnEmptySelection", false);
      editor.setText("1 + 2\n2 + 3");
      editor.setCursorBufferPosition([0, 0]);

      dispatch("calc:replace");

      expect(editor.getText()).toBe("1 + 2\n2 + 3");
    });
  });

  describe("calc:count", () => {
    it("numbers empty selections from the configured start index", () => {
      atom.config.set("calc.countStartIndex", 5);
      editor.setText("\n\n");

      dispatch("calc:count");

      expect(editor.getText()).toBe("5\n6\n");
    });
  });

  describe("extended variables", () => {
    it("provides the selection index and numbered results", () => {
      atom.config.set("calc.countStartIndex", 5);
      editor.setText("i\n_1 + 2\n_2 + i");

      dispatch("calc:evaluate");

      expect(editor.getText()).toBe("i = 5\n_1 + 2 = 7\n_2 + i = 14");
    });

    it("keeps the previous result across commands", () => {
      editor.setText("6 * 7");
      editor.selectAll();
      dispatch("calc:replace");

      editor.setText("_ + 1");
      editor.selectAll();
      dispatch("calc:replace");

      expect(editor.getText()).toBe("43");
    });

    it("removes magic variables when the feature is disabled", () => {
      editor.setText("6 * 7");
      editor.selectAll();
      dispatch("calc:replace");

      atom.config.set("calc.extendedVariables", false);
      editor.setText("typeof _");
      editor.selectAll();
      dispatch("calc:replace");

      expect(editor.getText()).toBe("undefined");
    });
  });

  describe("Math helpers", () => {
    it("provides unqualified Math functions when enabled", () => {
      editor.setText("pow(2, 8)");
      editor.selectAll();
      dispatch("calc:replace");
      expect(editor.getText()).toBe("256");
    });

    it("does not provide unqualified Math functions when disabled", () => {
      atom.config.set("calc.withMath", false);
      editor.setText("typeof pow");
      editor.selectAll();
      dispatch("calc:replace");
      expect(editor.getText()).toBe("undefined");
    });

    it("supports comments in expressions", () => {
      editor.setText("1 + 2 // Math");
      editor.selectAll();
      dispatch("calc:evaluate");
      expect(editor.getText()).toBe("1 + 2 // Math = 3");
    });

    it("generates printable strings with Math.pwd", () => {
      editor.setText("Math.pwd(32).length");
      editor.selectAll();
      dispatch("calc:replace");
      expect(editor.getText()).toBe("32");
    });
  });

  describe("evaluation failures", () => {
    it("keeps the expression and reports an error", () => {
      spyOn(console, "error");
      editor.setText("missingName + 1");
      editor.selectAll();

      dispatch("calc:replace");

      expect(editor.getText()).toBe("missingName + 1");
      const errors = atom.notifications
        .getNotifications()
        .filter((notification) => notification.getType() === "error");
      expect(errors.length).toBe(1);
      expect(errors[0].getDetail()).toContain("missingName is not defined");
      expect(console.error).toHaveBeenCalled();
    });

    it("stops expressions that exceed the configured timeout", () => {
      spyOn(console, "error");
      atom.config.set("calc.evaluationTimeout", 25);
      editor.setText("while (true) {}");
      editor.selectAll();

      dispatch("calc:replace");

      expect(editor.getText()).toBe("while (true) {}");
      const errors = atom.notifications
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
