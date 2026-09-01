import { createRuntimeEnvironment, desktopConfig } from "@aquawisp/desktop";
import { describe, expect, it } from "vitest";

describe("M5 desktop configuration", () => {
  it("inherits only registered environment names and enables Electron Node mode", () => {
    const environment = createRuntimeEnvironment(
      {
        PATH: "registered-path",
        SECRET_NOT_REGISTERED: "must-not-cross-process-boundary",
      },
      desktopConfig.runtime,
    );

    expect(environment.PATH).toBe("registered-path");
    expect(environment.SECRET_NOT_REGISTERED).toBeUndefined();
    expect(environment[desktopConfig.runtime.runAsNodeEnvironmentVariable]).toBe("1");
  });
});
