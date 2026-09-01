import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  RevisionConflictError,
  WorkspaceBoundaryError,
  WorkspaceFilesystem,
} from "@aquawisp/tools";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function workspace(): Promise<{ root: string; files: WorkspaceFilesystem }> {
  const root = await mkdtemp(join(tmpdir(), "AquaWisp M3 filesystem-"));
  temporaryDirectories.push(root);
  return { root, files: await WorkspaceFilesystem.create({ workspaceRoot: root }) };
}

describe("M3 workspace filesystem", () => {
  it("reads revisions, writes atomically, and applies exact edits", async () => {
    const { root, files } = await workspace();
    const target = join(root, "notes.txt");
    await writeFile(target, "first line", "utf8");

    const initial = await files.read("notes.txt");
    const written = await files.write({
      path: "notes.txt",
      content: "second line",
      expectedRevision: initial.revision,
    });
    const edited = await files.edit("notes.txt", written.revision, [
      { search: "second", replace: "final" },
    ]);

    expect(initial.revision).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(written.content).toBe("second line");
    expect(edited.content).toBe("final line");
    expect((await files.read("notes.txt")).revision).toBe(edited.revision);
  });

  it("rejects stale revisions and ambiguous edits", async () => {
    const { root, files } = await workspace();
    await writeFile(join(root, "notes.txt"), "repeat repeat", "utf8");
    const initial = await files.read("notes.txt");

    await expect(
      files.write({ path: "notes.txt", content: "changed", expectedRevision: "sha256:stale" }),
    ).rejects.toBeInstanceOf(RevisionConflictError);
    await expect(
      files.edit("notes.txt", initial.revision, [{ search: "repeat", replace: "once" }]),
    ).rejects.toThrow("exactly one location");
  });

  it("rejects paths and symlinks that escape the real workspace root", async () => {
    const { root, files } = await workspace();
    const outside = await mkdtemp(join(tmpdir(), "AquaWisp M3 outside-"));
    temporaryDirectories.push(outside);
    const link = join(root, "outside-link");
    await writeFile(join(outside, "secret.txt"), "secret", "utf8");
    await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");

    await expect(files.read("../outside.txt")).rejects.toBeInstanceOf(WorkspaceBoundaryError);
    await expect(files.read("outside-link/secret.txt")).rejects.toBeInstanceOf(
      WorkspaceBoundaryError,
    );
  });
});
