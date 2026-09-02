import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TerminalExecutor } from "@aquawisp/tools";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function executor(): Promise<{ root: string; terminal: TerminalExecutor }> {
  const root = await mkdtemp(join(tmpdir(), "AquaWisp M3 terminal-"));
  temporaryDirectories.push(root);
  return {
    root,
    terminal: await TerminalExecutor.create({
      workspaceRoot: root,
      maximumOutputBytes: 8,
      defaultTimeoutMilliseconds: 1_000,
    }),
  };
}

describe("M3 terminal executor", () => {
  it("passes argv directly, caps output, and binds cwd to the workspace", async () => {
    const { terminal } = await executor();
    const result = await terminal.execute({
      executable: process.execPath,
      arguments: ["-e", "process.stdout.write(process.cwd() + ':abcdefghijk')"],
      cwd: ".",
    });

    expect(result.exitCode).toBe(0);
    expect(result.outputTruncated).toBe(true);
    expect(result.stdout).toHaveLength(8);
  });

  it("rejects a cwd outside the workspace and terminates timed-out commands", async () => {
    const { terminal } = await executor();

    await expect(
      terminal.execute({ executable: process.execPath, arguments: ["-e", ""], cwd: ".." }),
    ).rejects.toThrow("escapes workspace");
    const result = await terminal.execute({
      executable: process.execPath,
      arguments: ["-e", "setTimeout(() => {}, 10000)"],
      cwd: ".",
      timeoutMilliseconds: 20,
    });
    expect(result.timedOut).toBe(true);
  });

  it("terminates an active process when its Run signal is cancelled", async () => {
    const { terminal } = await executor();
    const controller = new AbortController();
    const execution = terminal.execute(
      {
        executable: process.execPath,
        arguments: ["-e", "setTimeout(() => {}, 10000)"],
        cwd: ".",
      },
      controller.signal,
    );

    controller.abort(new Error("Run cancelled by test"));
    await expect(execution).rejects.toThrow("Run cancelled by test");
  });
});
