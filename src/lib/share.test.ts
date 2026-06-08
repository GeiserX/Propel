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
});
