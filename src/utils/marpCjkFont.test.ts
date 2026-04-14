import { injectMarpCjkFont } from './marpCjkFont';

describe('injectMarpCjkFont', () => {
  it('injects a style block into the body when front-matter exists', () => {
    const input = `---\nmarp: true\ntheme: default\n---\n\n# 你好\n`;
    const out = injectMarpCjkFont(input);
    expect(out).toContain('<style data-tikz-marp-cjk-inject>');
    expect(out).toContain('fonts.googleapis.com/css2?family=Noto+Sans+SC');
    expect(out).toContain("'Noto Sans SC'");
    expect(out).toContain('# 你好');
  });

  it('injects even when front-matter already has a style: key (user style is preserved)', () => {
    const input = `---\nmarp: true\nstyle: |\n  section { color: red; font-family: 'Inter', sans-serif; }\n---\n\nbody\n`;
    const out = injectMarpCjkFont(input);
    expect(out).toContain('<style data-tikz-marp-cjk-inject>');
    // Original style block preserved
    expect(out).toContain("section { color: red; font-family: 'Inter', sans-serif; }");
  });

  it('is idempotent — calling twice does not inject twice', () => {
    const input = `---\nmarp: true\n---\n\nbody\n`;
    const once = injectMarpCjkFont(input);
    const twice = injectMarpCjkFont(once);
    expect(twice).toBe(once);
    // Exactly one injection marker present
    const matches = twice.match(/data-tikz-marp-cjk-inject/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('does nothing when there is no front-matter', () => {
    const input = `# 你好\n\nno front-matter here\n`;
    expect(injectMarpCjkFont(input)).toBe(input);
  });

  it('handles CRLF line endings in front-matter', () => {
    const input = `---\r\nmarp: true\r\ntheme: default\r\n---\r\n\r\nbody\r\n`;
    const out = injectMarpCjkFont(input);
    expect(out).toContain('<style data-tikz-marp-cjk-inject>');
    // Front-matter is preserved intact
    expect(out).toContain('marp: true');
    expect(out).toContain('theme: default');
  });

  it('places the style block after the closing front-matter delimiter', () => {
    const input = `---\nmarp: true\n---\n\nbody content\n`;
    const out = injectMarpCjkFont(input);
    const fmEnd = out.indexOf('---\n', 4) + 4;
    const styleIdx = out.indexOf('<style data-tikz-marp-cjk-inject>');
    const bodyIdx = out.indexOf('body content');
    expect(styleIdx).toBeGreaterThan(fmEnd);
    expect(bodyIdx).toBeGreaterThan(styleIdx);
  });

  it('font-family chain keeps common Latin fonts before the CJK fallback', () => {
    const input = `---\nmarp: true\n---\n\nbody\n`;
    const out = injectMarpCjkFont(input);
    const fontLine = out.match(/font-family: ([^;]+);/)![1];
    const notoIdx = fontLine.indexOf("'Noto Sans SC'");
    const interIdx = fontLine.indexOf("'Inter'");
    expect(interIdx).toBeGreaterThanOrEqual(0);
    expect(notoIdx).toBeGreaterThan(interIdx);
  });
});
