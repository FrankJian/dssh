/**
 * Terminal wallpapers are only shown through a frosted overlay. Checking the
 * actual embedded WebView keeps unsupported Windows and macOS installations on
 * the regular opaque terminal path instead of rendering an unblurred image.
 */
export function supportsTerminalWallpaperGlass(): boolean {
  if (typeof CSS === "undefined" || typeof CSS.supports !== "function") {
    return false;
  }

  return (
    CSS.supports("backdrop-filter", "blur(1px)")
    || CSS.supports("-webkit-backdrop-filter", "blur(1px)")
  );
}
