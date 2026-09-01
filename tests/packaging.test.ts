import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface BuilderTarget {
  readonly target: string;
  readonly arch: readonly string[];
}

interface BuilderConfiguration {
  readonly appId: string;
  readonly asar: boolean;
  readonly directories: {
    readonly output: string;
    readonly buildResources: string;
  };
  readonly files: readonly string[];
  readonly win: { readonly target: readonly BuilderTarget[] };
  readonly mac: { readonly target: readonly BuilderTarget[] };
}

describe("M9 desktop packaging", () => {
  it("defines isolated Windows and macOS distributables", async () => {
    const configPath = resolve(repositoryRoot, "apps", "desktop", "electron-builder.json");
    const config = JSON.parse(await readFile(configPath, "utf8")) as BuilderConfiguration;

    expect(config.appId).toBe("com.aquawisp.desktop");
    expect(config.asar).toBe(true);
    expect(config.directories.output).toBe("../../release/desktop");
    expect(config.directories.buildResources).toBe("build-resources");
    expect(config.files).toEqual(["dist/**/*.js", "package.json"]);
    expect(config.win.target).toContainEqual({ target: "nsis", arch: ["x64"] });
    expect(config.mac.target).toContainEqual({ target: "dmg", arch: ["x64", "arm64"] });
  });

  it("keeps the editable application icon as SVG", async () => {
    const iconPath = resolve(repositoryRoot, "apps", "desktop", "build-resources", "icon.svg");
    const icon = await readFile(iconPath, "utf8");

    expect(icon).toContain("<svg");
    expect(icon).toContain("#0E7490");
    expect(icon).toContain("#34B3A0");
    await access(resolve(repositoryRoot, "docs", "packaging.md"));
  });
});
