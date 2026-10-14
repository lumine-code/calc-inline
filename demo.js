// Authentic package usage. Run with lumine/script/demo.js; fixtures stay in demo/.
module.exports = {
  version: 1,
  dependencies: [],
  viewport: { width: 1100, height: 340 },
  async before() {},
  async prepare(context) {
    const { state, open } = context;
    state.editor = await open("usage/calculations.txt");
  },
  scenes: [
    {
      id: "scene-1",
      file: "demo.png",
      caption: "Expressions before evaluation.",
      timeout: 60000,
      async run() {},
      ready() {
        return Boolean(
          document.querySelector("lumine-workspace")?.getBoundingClientRect()
            .height > 0 && document.body.innerText.trim().length > 0,
        );
      },
    },
    {
      id: "scene-2",
      file: "demo-2.png",
      caption: "Calculated results appended by Calc Inline.",
      timeout: 60000,
      async run(context) {
        const { lumine, state } = context;
        {
          lumine.commands.dispatch(
            lumine.views.getView(state.editor),
            "calc-inline:evaluate",
          );
        }
      },
      ready(context) {
        const { state } = context;
        return Boolean(state.editor.getText().includes("256"));
      },
    },
  ],
  async cleanup() {},
};
