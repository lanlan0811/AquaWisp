import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { WorkspaceSearch } from "@aquawisp/tools";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("M3 workspace search", () => {
  it("glob and grep only regular files within the real workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "AquaWisp M3 search-"));
    const outside = await mkdtemp(join(tmpdir(), "AquaWisp M3 search outside-"));
    directories.push(root, outside);
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "first.txt"), "needle one", "utf8");
    await writeFile(join(root, "nested", "second.txt"), "needle two", "utf8");
    await writeFile(join(outside, "secret.txt"), "needle secret", "utf8");
    await symlink(
      outside,
      join(root, "outside-link"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const search = await WorkspaceSearch.create({
      workspaceRoot: root,
      maximumResults: 10,
      maximumFileBytes: 1024,
    });

    expect(await search.glob("**/*.txt")).toEqual(["first.txt", "nested/second.txt"]);
    expect(await search.grep("needle")).toEqual([
      { path: "first.txt", line: 1, text: "needle one" },
      { path: "nested/second.txt", line: 1, text: "needle two" },
    ]);
  });
});
