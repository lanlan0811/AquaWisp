import { createRuntimeEnvironment, desktopConfig } from "@aquawisp/desktop";
import { describe, expect, it } from "vitest";

describe("M5 desktop configuration", () => {
  it("registers three session modes but never allows full access as a default", () => {
    expect(desktopConfig.executionModes.map(({ id }) => id)).toEqual([
      "plan",
      "work",
      "full_access",
    ]);
    expect(desktopConfig.executionModes.find(({ id }) => id === "full_access")).toMatchObject({
      canBeDefault: false,
      requiresConfirmation: true,
    });
    expect(
      desktopConfig.executionModes.find(({ id }) => id === desktopConfig.settings.defaultMode),
    ).toMatchObject({ canBeDefault: true });
  });

  it("registers action ledger labels, detail bounds, and tool icons", () => {
    expect(desktopConfig.actionLedger.states.map(({ id }) => id)).toEqual([
      "planned",
      "authorized",
      "dispatched",
      "observed",
      "verified",
      "unknown",
      "denied",
    ]);
    expect(desktopConfig.actionLedger.maximumDetailCharacters).toBeGreaterThan(0);
    expect(
      desktopConfig.actionLedger.toolIcons.find(({ toolName }) => toolName === "terminal.execute"),
    ).toMatchObject({ icon: "terminal" });
  });

  it("bounds the Electron browser host and keeps all browser IPC channels unique", () => {
    expect(desktopConfig.browser.maximumTabs).toBeGreaterThan(0);
    expect(desktopConfig.browser.requestTimeoutMs).toBeGreaterThanOrEqual(
      desktopConfig.browser.tabAttachmentTimeoutMs,
    );
    expect(new Set(Object.values(desktopConfig.ipcChannels)).size).toBe(
      Object.values(desktopConfig.ipcChannels).length,
    );
  });

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
