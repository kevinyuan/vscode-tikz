/**
 * Injects a CJK webfont fallback into a Marp markdown document so exported
 * PDF (Chromium) and PPTX (LibreOffice via Chromium-rendered HTML) render
 * Chinese / Japanese / Korean glyphs.
 *
 * Why this is necessary:
 *   marp-cli uses puppeteer's bundled headless Chromium, which on macOS does
 *   NOT resolve system CJK fonts by name (PingFang SC, Hiragino Sans GB,
 *   -apple-system all fail). Even when the user explicitly lists these fonts
 *   in their theme CSS, the glyphs are dropped from the output PDF. The only
 *   reliable fix is to force Chromium to download a CJK webfont over HTTP.
 *
 * How it works:
 *   A `<style>` block is inserted into the document body right after the
 *   YAML front-matter. It `@import`s Noto Sans SC from Google Fonts and
 *   applies a font-family chain ending with `'Noto Sans SC'` to all common
 *   Marp content elements. Because browsers resolve font-family per-glyph,
 *   Latin characters still pick up the earlier Latin fonts in the chain and
 *   CJK glyphs fall through to the loaded webfont.
 *
 *   The injection is idempotent (checked via a marker comment) and only
 *   triggers when the document has YAML front-matter (i.e. is a Marp file).
 */

const CJK_INJECT_MARKER = 'tikz-marp-cjk-inject';

const CJK_STYLE_BLOCK =
  `<style data-${CJK_INJECT_MARKER}>\n` +
  `@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&display=swap');\n` +
  `section, h1, h2, h3, h4, h5, h6, p, li, td, th, blockquote, code, pre, figcaption, caption, small, strong, em {\n` +
  `  font-family: 'Inter', -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Helvetica, Arial, 'Noto Sans SC', sans-serif;\n` +
  `}\n` +
  `</style>\n`;

export function injectMarpCjkFont(md: string): string {
  // Idempotent: skip if already injected.
  if (md.includes(`data-${CJK_INJECT_MARKER}`)) {
    return md;
  }

  const fmMatch = md.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (!fmMatch) {
    return md;
  }

  const fmEnd = fmMatch[0];
  const rest = md.slice(fmEnd.length);
  return `${fmEnd}\n${CJK_STYLE_BLOCK}\n${rest}`;
}
