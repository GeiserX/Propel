import { describe, it, expect, vi, afterEach } from "vitest";
import { shareOrCopy } from "./share";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const DATA = { title: "Repsol", text: "Repsol — 1.659/L", url: "https://pumperly.com/es?station=ES:123&lat=40.4&lng=-3.7" };

describe("shareOrCopy", () => {
  it("uses navigator.share when available and canShare accepts", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { share, canShare });
    expect(await shareOrCopy(DATA)).toBe("shared");
    expect(share).toHaveBeenCalledWith(DATA);
  });

  it("returns 'dismissed' (not failed) when the user cancels the share sheet", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("cancelled", "AbortError"));
    vi.stubGlobal("navigator", { share, canShare: () => true });
    expect(await shareOrCopy(DATA)).toBe("dismissed");
  });

  it("falls back to clipboard.writeText when navigator.share is absent (desktop Firefox)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await shareOrCopy(DATA)).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(DATA.url);
  });

  it("falls back to clipboard when canShare rejects the payload", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const share = vi.fn();
    vi.stubGlobal("navigator", { share, canShare: () => false, clipboard: { writeText } });
    expect(await shareOrCopy(DATA)).toBe("copied");
    expect(share).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith(DATA.url);
  });

  it("falls back to clipboard when share() throws a non-abort error", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const share = vi.fn().mockRejectedValue(new Error("boom"));
    vi.stubGlobal("navigator", { share, canShare: () => true, clipboard: { writeText } });
    expect(await shareOrCopy(DATA)).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(DATA.url);
  });

  it("uses execCommand('copy') as last resort when writeText rejects", async () => {
    // Tests run under the "node" project (no jsdom), so document is absent;
    // stub a minimal one so the legacyCopy textarea path can execute.
    const writeText = vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    const execCommand = vi.fn().mockReturnValue(true);
    const appended: unknown[] = [];
    const removed: unknown[] = [];
    const textarea = { value: "", style: {} as Record<string, string>, setAttribute: vi.fn(), select: vi.fn() };
    const createElement = vi.fn(() => textarea);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("document", {
      createElement,
      execCommand,
      body: {
        appendChild: vi.fn((n: unknown) => { appended.push(n); return n; }),
        removeChild: vi.fn((n: unknown) => { removed.push(n); return n; }),
      },
    });

    expect(await shareOrCopy(DATA)).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(DATA.url);
    expect(createElement).toHaveBeenCalledWith("textarea");
    expect(textarea.value).toBe(DATA.url); // the URL was loaded into the textarea
    expect(execCommand).toHaveBeenCalledWith("copy");
    // The temporary textarea is both appended and cleaned up.
    expect(appended).toHaveLength(1);
    expect(removed).toHaveLength(1);
    expect(appended[0]).toBe(textarea);
    expect(removed[0]).toBe(textarea);
  });

  it("returns 'failed' when both writeText and execCommand fail", async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    const execCommand = vi.fn().mockReturnValue(false);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({ value: "", style: {}, setAttribute: vi.fn(), select: vi.fn() })),
      execCommand,
      body: { appendChild: vi.fn((n: unknown) => n), removeChild: vi.fn((n: unknown) => n) },
    });

    expect(await shareOrCopy(DATA)).toBe("failed");
    expect(writeText).toHaveBeenCalledWith(DATA.url);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("shares when share() exists but canShare is absent (older iOS Safari)", async () => {
    // The ternary defaults `ok` to true when canShare isn't a function.
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share });
    expect(await shareOrCopy(DATA)).toBe("shared");
    expect(share).toHaveBeenCalledWith(DATA);
  });
});
