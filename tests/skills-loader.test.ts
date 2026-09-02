import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BuiltInSkillLoader } from "@aquawisp/skills";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("M7 built-in skill loader", () => {
  it("discovers frontmatter first and loads instructions only on demand", async () => {
    const root = await mkdtemp(join(tmpdir(), "AquaWisp M7 skills-"));
    directories.push(root);
    const path = join(root, "SKILL.md");
    await writeFile(
      path,
      "---\nname: sample\ndescription: 示例技能\nauthor: AquaWisp\n---\n# 正文\n按需加载",
      "utf8",
    );
    const loader = await BuiltInSkillLoader.create([root]);
    expect(await loader.list()).toEqual([
      expect.objectContaining({ name: "sample", description: "示例技能" }),
    ]);
    expect((await loader.load(path)).instructions).toContain("按需加载");
    await expect(loader.load(join(root, "..", "outside.md"))).rejects.toThrow("outside");
  });

  it("ships exactly the five planned built-in skills with one AquaWisp browser skill", async () => {
    const loader = await BuiltInSkillLoader.create([join(process.cwd(), "skills")]);
    const skills = await loader.list();

    expect(skills.map(({ name }) => name).sort()).toEqual([
      "browser-use",
      "docx",
      "pdf",
      "pptx",
      "xlsx",
    ]);
    const browser = skills.find(({ name }) => name === "browser-use");
    expect(browser?.metadata).toMatchObject({
      author: "AquaWisp Contributors",
      version: "0.1.0",
      license: "MIT",
    });
    expect(browser?.path).toBe(join(process.cwd(), "skills", "browser-use", "SKILL.md"));
  });
});
