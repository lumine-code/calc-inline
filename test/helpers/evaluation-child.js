"use strict";

const childProcess = require("node:child_process");
const READY = "LUMINE_CALC_EVALUATION_READY";

module.exports = function runEvaluationChild(
  script,
  binary = process.execPath,
) {
  return new Promise((resolve) => {
    const source = `
      process.stdin.once("data", () => { ${script}\n });
      process.stdout.write(${JSON.stringify(READY + "\n")});
    `;
    const started = Date.now();
    const child = childProcess.spawn(binary, ["-e", source], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "",
      frame = "",
      outputBytes = 0,
      phase = "bootstrap",
      executionStarted,
      error,
      timer;
    const fail = (failure) => {
      error ??= failure;
      child.kill("SIGKILL");
    };
    const arm = (milliseconds) =>
      setTimeout(() => {
        const failure = new Error(
          `Calculation ${phase} timed out after ${milliseconds}ms`,
        );
        failure.code = "ETIMEDOUT";
        fail(failure);
      }, milliseconds);
    const acceptOutput = (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes <= 1024 * 1024) return true;
      const failure = new Error("Calculation child exceeded its output buffer");
      failure.code = "ENOBUFS";
      fail(failure);
      return false;
    };
    timer = arm(10000);
    child.once("error", (failure) => (error ??= failure));
    child.stdin.on("error", fail);
    child.stdout.on("error", fail);
    child.stderr.on("error", fail);
    child.stderr.on("data", (chunk) => {
      if (acceptOutput(chunk)) stderr += chunk;
    });
    child.stdout.on("data", (chunk) => {
      if (!acceptOutput(chunk)) return;
      stdout += chunk;
      if (phase !== "bootstrap") return;
      frame += chunk;
      let newline;
      while ((newline = frame.indexOf("\n")) !== -1) {
        const line = frame.slice(0, newline);
        frame = frame.slice(newline + 1);
        if (line !== READY) continue;
        clearTimeout(timer);
        phase = "execution";
        executionStarted = Date.now();
        // Requiring the session, constructing fixtures, VM evaluation, output
        // and normal child exit retain the original one-second watchdog.
        timer = arm(1000);
        child.stdin.end("RUN\n");
        break;
      }
    });
    child.once("close", (status, signal) => {
      clearTimeout(timer);
      if (!error && phase === "bootstrap")
        error = new Error(
          "Calculation child exited before bootstrap readiness",
        );
      resolve({
        error,
        status,
        signal,
        stdout: stdout.startsWith(READY + "\n")
          ? stdout.slice(READY.length + 1)
          : stdout,
        stderr,
        phase,
        startupMs: (executionStarted ?? Date.now()) - started,
        executionMs:
          executionStarted == null ? null : Date.now() - executionStarted,
        pid: child.pid,
        reaped: true,
      });
    });
  });
};
