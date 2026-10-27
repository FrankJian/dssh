import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { historyShellIntegrationCommand, historyShellIntegrationFor, readHistorySetupOutput } from "./historyShellIntegration.ts";

test("Bash reports real statuses, preserves prompt hooks, and installs only once", { skip: process.platform === "win32" }, () => {
  const result = spawnSync("bash", ["--noprofile", "--norc", "-i"], {
    input: [
      `PROMPT_COMMAND='printf "original:%s\\n" "$?"'`,
      historyShellIntegrationCommand,
      historyShellIntegrationCommand,
      "false",
      "(exit 2)",
      "printf 'done\\n'",
      "exit",
      "",
    ].join("\n"),
    encoding: "utf8",
    env: { ...process.env, HISTFILE: "/dev/null" },
    timeout: 5000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const statuses = [...result.stdout.matchAll(/\x1b\]633;D;(\d+)\x07/g)].map((match) => Number(match[1]));
  assert.deepEqual(statuses, [0, 0, 1, 2, 0]);
  assert.ok(result.stdout.includes("original:1"));
  assert.ok(result.stdout.includes("original:2"));
});

for (const shell of ["sh", "dash", "ksh"]) {
  test(`${shell} reports each completed command without a manual session switch`, { skip: process.platform === "win32" }, (context) => {
    const result = spawnSync(shell, ["-i"], {
      input: ["PS1='$ '", historyShellIntegrationFor("posix"), historyShellIntegrationFor("posix"), "false", "(exit 2)", "printf 'done\\n'", "exit", ""].join("\n"),
      encoding: "utf8",
      env: { ...process.env, HISTFILE: "/dev/null", ENV: "" },
      timeout: 5000,
    });
    if (result.error?.code === "ENOENT") return context.skip(`${shell} is not installed`);
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    const output = result.stdout + result.stderr;
    const statuses = [...output.matchAll(/\x1b\]633;D;(\d+)\x07/g)].map((match) => Number(match[1]));
    assert.deepEqual(statuses, [0, 0, 1, 2, 0]);
  });
}

test("Fish postexec reports successes and failures without replacing fish_prompt", (context) => {
  const result = spawnSync("fish", ["--no-config", "--interactive"], {
    input: [historyShellIntegrationFor("fish"), historyShellIntegrationFor("fish"), "false", "sh -c 'exit 2'", "printf 'done\\n'", "exit", ""].join("\n"),
    encoding: "utf8",
    env: { ...process.env, fish_history: "", TERM: "xterm-256color" },
    timeout: 5000,
  });
  if (result.error?.code === "ENOENT") return context.skip("Fish is not installed");
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const statuses = [...result.stdout.matchAll(/\x1b\]633;D;(\d+)\x07/g)].map((match) => Number(match[1]));
  assert.deepEqual(statuses, [0, 0, 1, 2, 0]);
});

for (const shell of ["pwsh", "powershell"]) {
  test(`${shell} reports native failure and ignores stale LASTEXITCODE after success`, (context) => {
    const commands = [
        "$function:prompt = { 'PSTEST> ' }",
        historyShellIntegrationFor("powershell"),
        "prompt",
        historyShellIntegrationFor("powershell"),
        "prompt",
        "$dsshExe = (Get-Process -Id $PID).Path",
        "& $dsshExe -NoLogo -NoProfile -Command 'exit 2'",
        "prompt",
        "Write-Output 'done'",
        "prompt",
      ];
    const result = spawnSync(shell, ["-NoLogo", "-NoProfile", "-Command", commands.join("; ")], {
      encoding: "utf8",
      timeout: 10000,
    });
    if (result.error?.code === "ENOENT") return context.skip(`${shell} is not installed`);
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    const statuses = [...result.stdout.matchAll(/\x1b\]633;D;(-?\d+)\x07/g)].map((match) => Number(match[1]));
    assert.deepEqual(statuses, [0, 0, 2, 0]);
    assert.ok(result.stdout.includes("PSTEST>"));
  });
}

test("automatic setup filters chunked initialization echo but preserves subsequent prompt output", () => {
  const partial = "source echo DsshReady;fish\r\n\x1b]633;DsshReady;fi";
  assert.equal(readHistorySetupOutput(partial), null);
  assert.deepEqual(readHistorySetupOutput(partial + "sh\x07user> "), { shell: "fish", output: "user> " });
  assert.equal(readHistorySetupOutput("printed text DsshReady;bash"), null);
  assert.deepEqual(readHistorySetupOutput("\x1b]633;DsshReady;powershell\x1b\\PS> "), { shell: "powershell", output: "PS> " });
});

test("Zsh reports failure before invoking an existing precmd", { skip: process.platform === "win32" }, (context) => {
  const result = spawnSync("zsh", ["-d", "-f", "-i"], {
    input: [
      `precmd() { printf 'original:%s\\n' "$?"; }`,
      `__dssh_test_hook() { printf 'hook:%s\\n' "$?"; }; precmd_functions=(__dssh_test_hook)`,
      historyShellIntegrationCommand,
      historyShellIntegrationCommand,
      "false",
      "(exit 2)",
      "printf 'done\\n'",
      "exit",
      "",
    ].join("\n"),
    encoding: "utf8",
    env: { ...process.env, HISTFILE: "/dev/null" },
    timeout: 5000,
  });
  if (result.error?.code === "ENOENT") return context.skip("Zsh is not installed");
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const statuses = [...result.stdout.matchAll(/\x1b\]633;D;(\d+)\x07/g)].map((match) => Number(match[1]));
  assert.deepEqual(statuses, [0, 0, 1, 2, 0]);
  assert.ok(result.stdout.includes("original:1"));
  assert.ok(result.stdout.includes("original:2"));
});
