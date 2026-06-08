// Share-or-copy helper built on the Web Share API with a clipboard fallback.
//
// Behavior (per research, all cited to MDN / caniuse):
// - If navigator.share exists (iOS Safari 12.2+, Android Chrome, desktop
//   Chrome/Edge/Safari) and canShare accepts the payload, open the native
//   share sheet. Must be called from a user gesture (transient activation)
//   over HTTPS — both satisfied when invoked from an onClick on pumperly.com.
// - User-cancelled shares reject with AbortError; swallow that silently.
// - Otherwise (notably desktop Firefox) fall back to navigator.clipboard
//   .writeText, then to a legacy execCommand("copy") last resort.
//
// Returns how the share resolved so the UI can show a transient "Copied!"
// state when the URL was copied rather than shared.

export type ShareOutcome = "shared" | "copied" | "dismissed" | "failed";

export interface ShareData {
  title?: string;
  text?: string;
  url: string;
}

function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "absolute";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to legacy path (e.g. permission/activation issues)
    }
  }
  return legacyCopy(text);
}

/**
 * Try the native share sheet; fall back to copying the URL to the clipboard.
 * Call this directly from a click handler (it relies on transient activation).
 */
export async function shareOrCopy(data: ShareData): Promise<ShareOutcome> {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    // canShare may be absent on older implementations that still have share().
    const ok = typeof navigator.canShare === "function" ? navigator.canShare(data) : true;
    if (ok) {
      try {
        await navigator.share(data);
        return "shared";
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return "dismissed";
        // Any other share error → fall through to clipboard.
      }
    }
  }
  return (await copyToClipboard(data.url)) ? "copied" : "failed";
}
