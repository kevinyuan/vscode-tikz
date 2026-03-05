import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFile, execFileSync } from 'child_process';
import { DocumentParser } from './core/DocumentParser';
import { CacheManager } from './core/CacheManager';
import { ConfigurationManager } from './config/ConfigurationManager';
import { PreviewManager } from './preview/PreviewManager';
import { generateHash } from './utils/hash';
import { preprocessSource } from './utils/preprocessor';

let previewManager: PreviewManager | undefined;
let configManager: ConfigurationManager | undefined;
let cacheManager: CacheManager | undefined;
let documentParser: DocumentParser | undefined;
let outputChannel: vscode.OutputChannel;

/** Track the last known markdown document so we don't depend on activeTextEditor */
let lastMarkdownDocument: vscode.TextDocument | undefined;

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('TikZJax');
  outputChannel.appendLine('TikZJax extension activating...');

  documentParser = new DocumentParser();
  cacheManager = new CacheManager(context.globalState);
  // Clear stale persistent cache from before the hash normalization fix
  const cacheVersion = context.globalState.get<number>('tikzjax.cacheVersion', 0);
  if (cacheVersion < 2) {
    cacheManager.clear().then(() => {
      context.globalState.update('tikzjax.cacheVersion', 2);
      outputChannel.appendLine('Cleared stale persistent cache (hash scheme changed)');
    });
  }
  configManager = new ConfigurationManager();
  const config = configManager.getConfiguration();

  previewManager = new PreviewManager(
    context.extensionUri,
    documentParser,
    cacheManager,
    config
  );

  const configWatcher = configManager.onConfigurationChange((newConfig) => {
    previewManager?.updateConfiguration(newConfig);
  });
  context.subscriptions.push(configWatcher);

  registerCommands(context);
  registerEventHandlers(context);

  // Track the active markdown document
  if (vscode.window.activeTextEditor?.document.languageId === 'markdown') {
    lastMarkdownDocument = vscode.window.activeTextEditor.document;
  }

  outputChannel.appendLine('TikZJax extension activated');

  /**
   * Shared rendering logic — returns HTML for a TikZ source string.
   * Includes inline style fallbacks so output works inside Marp (which strips external CSS).
   */
  function renderTikzHtml(source: string): string {
    const hash = generateHash(source.trim());
    const result = previewManager?.getSvg(hash);
    outputChannel.appendLine(`[render] content length=${source.length} trimmed length=${source.trim().length} hash=${hash.slice(0, 8)}`);

    if (result?.svg) {
      outputChannel.appendLine(`[render] hash=${hash.slice(0, 8)} → cached SVG`);
      return `<div class="tikz-diagram" style="text-align:center;margin:1em 0">${result.svg}</div>\n`;
    } else if (result?.error) {
      outputChannel.appendLine(`[render] hash=${hash.slice(0, 8)} → error: ${result.error.slice(0, 80)}`);
      const escaped = escapeHtml(result.error);
      return `<div class="tikz-diagram tikz-error" style="text-align:center;margin:1em 0;color:#c00"><div class="tikz-error-title">⚠ Rendering Error</div><pre class="tikz-error-message" style="white-space:pre-wrap">${escaped}</pre></div>\n`;
    } else {
      outputChannel.appendLine(`[render] hash=${hash.slice(0, 8)} → not cached, triggering background render`);
      scheduleBackgroundRender();
      return `<div class="tikz-diagram tikz-loading" style="text-align:center;margin:1em 0"><span class="tikz-spinner"></span> Rendering TikZ diagram…</div>\n`;
    }
  }

  return {
    extendMarkdownIt(md: any) {
      outputChannel.appendLine('extendMarkdownIt called — registering tikz fence renderer');

      // ── Non-Marp path: custom fence rule on the outer renderer ──
      const defaultFence = md.renderer.rules.fence ||
        function (tokens: any, idx: any, options: any, _env: any, self: any) {
          return self.renderToken(tokens, idx, options);
        };

      md.renderer.rules.fence = (tokens: any, idx: any, options: any, env: any, self: any) => {
        const token = tokens[idx];
        const info = (token.info || '').trim().toLowerCase();

        if (info === 'tikz') {
          return renderTikzHtml(token.content);
        }

        return defaultFence(tokens, idx, options, env, self);
      };

      // ── Marp compatibility ──
      // Marp creates a NEW internal markdown-it instance on every parse() call
      // and only copies `image` and `link_open` renderer rules — our fence rule
      // is never on that internal renderer.
      //
      // Strategy: After ALL extensions have loaded, wrap md.parse so that after
      // each parse call we find Marp's internal instance (stored on
      // md[Symbol("marp-vscode")]) and install our fence rule on its renderer
      // before render() runs.
      //
      // Timing: queueMicrotask fires BETWEEN extension loads (VS Code uses
      // async for-of with await), so we use setTimeout(0) which fires after
      // all microtasks — guaranteeing all extensions have finished loading.

      /** Find Marp's Symbol key on the md object */
      const findMarpSymbol = (): symbol | undefined => {
        return Object.getOwnPropertySymbols(md).find(
          s => s.toString().includes('marp')
        );
      };

      /** Install our tikz fence rule on Marp's internal renderer */
      const installFenceOnMarpInstance = (): void => {
        const sym = findMarpSymbol();
        if (!sym) { return; }
        const marpInstance = md[sym];
        if (!marpInstance || !marpInstance.markdown) { return; }
        const marpRenderer = marpInstance.markdown.renderer;
        // Marp creates a new instance per-parse, so always install fresh
        if (marpRenderer.rules._tikzFenceInstalled) { return; }
        marpRenderer.rules._tikzFenceInstalled = true;
        outputChannel.appendLine('[marp-compat] Installing fence rule on Marp internal renderer');
        const origFence = marpRenderer.rules.fence ||
          function (tokens: any, idx: any, options: any, _env: any, self: any) {
            return self.renderToken(tokens, idx, options);
          };
        marpRenderer.rules.fence = (tokens: any, idx: any, options: any, env: any, self: any) => {
          const token = tokens[idx];
          const info = (token.info || '').trim().toLowerCase();
          if (info === 'tikz') {
            outputChannel.appendLine('[marp-fence] Rendering tikz block');
            return renderTikzHtml(token.content);
          }
          return origFence(tokens, idx, options, env, self);
        };
      };

      // Wrap md.parse synchronously (handles case where we load after Marp)
      const origParse = md.parse.bind(md);
      md.parse = function (src: string, env?: any) {
        const tokens = origParse(src, env);
        installFenceOnMarpInstance();
        return tokens;
      };

      // Re-wrap after ALL extensions load using setTimeout(0).
      // setTimeout(0) fires after all microtasks (including VS Code's
      // async extension loading loop), so Marp's overwrite has completed.
      setTimeout(() => {
        const currentParse = md.parse;
        md.parse = function (src: string, env?: any) {
          outputChannel.appendLine(`[parse-wrapper] src.length=${src.length}`);
          const tokens = currentParse.call(md, src, env);
          installFenceOnMarpInstance();
          return tokens;
        };
        outputChannel.appendLine('[init] Installed tikz parse wrapper via setTimeout(0)');
      }, 0);

      return md;
    }
  };
}

/** Schedule a background render for the last known markdown document */
let bgRenderScheduled = false;
function scheduleBackgroundRender(): void {
  if (bgRenderScheduled) { return; }
  bgRenderScheduled = true;

  // Use setImmediate-like to run after the current synchronous markdown-it render completes
  setTimeout(async () => {
    bgRenderScheduled = false;

    const doc = findMarkdownDocument();
    if (!doc) {
      outputChannel.appendLine('[bg-render] No markdown document found');
      return;
    }
    if (!previewManager) {
      outputChannel.appendLine('[bg-render] No preview manager');
      return;
    }

    outputChannel.appendLine(`[bg-render] Starting render for ${doc.fileName}`);
    try {
      await previewManager.renderDocument(doc);
      outputChannel.appendLine('[bg-render] Render complete');
    } catch (err: any) {
      outputChannel.appendLine(`[bg-render] Render failed: ${err.message}`);
    }
  }, 50);
}

/** Find the markdown document — try activeTextEditor first, fall back to tracked doc */
function findMarkdownDocument(): vscode.TextDocument | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document.languageId === 'markdown') {
    return editor.document;
  }
  // Fall back to last known markdown document
  if (lastMarkdownDocument && !lastMarkdownDocument.isClosed) {
    return lastMarkdownDocument;
  }
  // Last resort: search all open text documents
  return vscode.workspace.textDocuments.find(d => d.languageId === 'markdown');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function registerCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('tikzjax.openPreview', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { vscode.window.showWarningMessage('No active editor found'); return; }
      if (editor.document.languageId !== 'markdown') {
        vscode.window.showWarningMessage('TikZ preview is only available for Markdown files'); return;
      }
      if (!previewManager) { return; }
      await previewManager.createOrShowPreview(editor.document);
    }),

    vscode.commands.registerCommand('tikzjax.refreshDiagrams', async () => {
      const doc = findMarkdownDocument();
      if (!doc || !previewManager || !cacheManager || !documentParser) { return; }
      const blocks = documentParser.parse(doc);
      for (const block of blocks) { await cacheManager.invalidate(block.hash); }
      previewManager.clearMemoryCache();
      await previewManager.renderDocument(doc);
      vscode.window.setStatusBarMessage(`$(sync) Refreshed ${blocks.length} TikZ diagram(s)`, 3000);
    }),

    vscode.commands.registerCommand('tikzjax.clearCache', async () => {
      if (!cacheManager) { return; }
      const stats = await cacheManager.getStats();
      await cacheManager.clear();
      previewManager?.clearMemoryCache();
      vscode.window.showInformationMessage(
        `Cleared ${stats.entryCount} cached diagram(s) (${formatBytes(stats.totalSize)})`
      );
      const doc = findMarkdownDocument();
      if (doc && previewManager) { await previewManager.renderDocument(doc); }
    }),

    vscode.commands.registerCommand('tikzjax.resetEngine', async () => {
      if (!previewManager) { return; }
      await previewManager.resetEngine();
      vscode.window.setStatusBarMessage('$(debug-restart) TikZJax engine reset', 3000);
    }),

    vscode.commands.registerCommand('tikzjax.exportMarpPptx', async () => {
      const editor = vscode.window.activeTextEditor;
      const doc = (editor && editor.document.languageId === 'markdown')
        ? editor.document
        : findMarkdownDocument();
      if (!doc) {
        vscode.window.showWarningMessage('Open a Marp markdown file to export.');
        return;
      }
      await exportMarpPptx(doc);
    })
  );
}

/**
 * Check if a document is a Marp deck and set the context key accordingly.
 * When doc is undefined (e.g. switching to preview webview), keep the last state
 * so the button remains visible in the preview title bar.
 */
function updateMarpContext(doc: vscode.TextDocument | undefined): void {
  if (!doc) { return; } // Keep last state when switching to webview/preview
  if (doc.languageId !== 'markdown') {
    vscode.commands.executeCommand('setContext', 'tikzjax.isMarpFile', false);
    return;
  }
  const head = doc.getText().slice(0, 500);
  const isMarp = /^---[\s\S]*?marp:\s*true/m.test(head);
  vscode.commands.executeCommand('setContext', 'tikzjax.isMarpFile', isMarp);
}

function registerEventHandlers(context: vscode.ExtensionContext): void {
  // Set initial Marp context
  updateMarpContext(vscode.window.activeTextEditor?.document);

  // Track active markdown document
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document.languageId === 'markdown') {
        lastMarkdownDocument = editor.document;
      }
      updateMarpContext(editor?.document);
    })
  );

  // Release lastMarkdownDocument reference when the document closes
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (lastMarkdownDocument === doc) {
        lastMarkdownDocument = undefined;
      }
    })
  );

  // Watch for document changes — trigger background rendering
  let debounceTimer: NodeJS.Timeout | undefined;
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId !== 'markdown' || !previewManager) { return; }
      lastMarkdownDocument = event.document;
      updateMarpContext(event.document);
      if (debounceTimer) { clearTimeout(debounceTimer); }
      debounceTimer = setTimeout(async () => {
        debounceTimer = undefined;
        outputChannel.appendLine(`[doc-change] Rendering blocks for ${event.document.fileName}`);
        await previewManager!.renderDocument(event.document);
      }, 1000);
    })
  );

  // Watch for theme changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme(async () => {
      if (!previewManager) { return; }
      previewManager.clearMemoryCache();
      const doc = findMarkdownDocument();
      if (doc) { await previewManager.renderDocument(doc); }
    })
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) { return '0 Bytes'; }
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Render TikZ source to SVG using node-tikzjax directly.
 * Mirrors the logic in marp-tikz.js / PreviewManager._renderTikzToSvg.
 */
async function renderTikzSourceToSvg(source: string): Promise<string> {
  const tex2svg = (await import('node-tikzjax')).default;

  let processed = preprocessSource(source);

  // Downgrade pgfplots compat (engine limitation)
  processed = processed.replace(
    /\\pgfplotsset\s*\{\s*compat\s*=\s*[\d.]+\s*\}/,
    '\\pgfplotsset{compat=1.16}'
  );

  // Detect packages
  const packages: Record<string, string> = {};
  const pkgRegex = /\\usepackage(?:\[([^\]]*)\])?\{([^}]+)\}/g;
  let m;
  while ((m = pkgRegex.exec(processed)) !== null) {
    packages[m[2].trim()] = m[1] || '';
  }

  // Detect tikz libraries
  const libs: string[] = [];
  const libRegex = /\\usetikzlibrary\{([^}]+)\}/g;
  while ((m = libRegex.exec(processed)) !== null) {
    libs.push(...m[1].split(',').map(s => s.trim()).filter(Boolean));
  }

  return tex2svg(processed, {
    showConsole: false,
    texPackages: packages,
    tikzLibraries: libs.join(','),
  });
}

/**
 * Fix SVG width/height to match viewBox (same as marp-tikz.js fixSvgDimensions).
 */
function fixSvgDimensions(svg: string): string {
  const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
  if (!viewBoxMatch) { return svg; }
  const parts = viewBoxMatch[1].trim().split(/\s+/);
  if (parts.length !== 4) { return svg; }
  let result = svg.replace(/(<svg[^>]*?\s)width="[^"]*"/, `$1width="${parts[2]}pt"`);
  result = result.replace(/(<svg[^>]*?\s)height="[^"]*"/, `$1height="${parts[3]}pt"`);
  return result;
}

/** Resolve marp-cli command and args prefix. */
function resolveMarpCli(): { cmd: string; prefix: string[] } {
  try {
    const resolved = require.resolve('@marp-team/marp-cli/marp-cli.js');
    return { cmd: process.execPath, prefix: [resolved] };
  } catch {
    return { cmd: 'npx', prefix: ['@marp-team/marp-cli'] };
  }
}

/** Check marp-cli version and return true if >= 4.1.0. */
function marpSupportsEditablePptx(): boolean {
  try {
    const { cmd, prefix } = resolveMarpCli();
    const verOut = execFileSync(cmd, [...prefix, '--version'], {
      encoding: 'utf-8', timeout: 10000,
    }).trim();
    const m = verOut.match(/(\d+)\.(\d+)\.\d+/);
    if (!m) { return false; }
    const [, major, minor] = m.map(Number);
    return major > 4 || (major === 4 && minor >= 1);
  } catch {
    return false;
  }
}

/**
 * Run marp-cli to convert processed markdown to PPTX.
 */
function runMarpCli(processedMdPath: string, outputPath: string, cwd: string, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const { cmd, prefix } = resolveMarpCli();

    const args = ['--pptx', '--allow-local-files', '--html', '--no-stdin', processedMdPath, '-o', outputPath];
    if (marpSupportsEditablePptx()) {
      args.splice(1, 0, '--pptx-editable');
      outputChannel.appendLine('[marp-export] Marp >= 4.1.0, enabling --pptx-editable');
    }
    const cmdArgs = [...prefix, ...args];

    const child = execFile(cmd, cmdArgs, {
      cwd,
      timeout: timeoutMs,
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    }, (error, _stdout, stderr) => {
      if (error) {
        const msg = stderr?.trim() || error.message;
        if (error.killed || (error as any).code === 'ETIMEDOUT') {
          reject(new Error(`marp-cli timed out after ${timeoutMs / 1000}s`));
        } else {
          reject(new Error(msg));
        }
      } else {
        resolve();
      }
    });

    // Safety: kill the process if it's still running when timeout fires
    // (node's execFile timeout sends SIGTERM, but we also guard here)
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, timeoutMs + 5000);
    child.on('exit', () => clearTimeout(timer));
  });
}

/** Timeout value for marp-cli (60 seconds) */
const MARP_CLI_TIMEOUT = 60_000;

/**
 * Export the active Marp document to PPTX, rendering TikZ blocks to SVG first.
 */
async function exportMarpPptx(doc: vscode.TextDocument): Promise<void> {
  const inputPath = doc.uri.fsPath;
  const inputDir = path.dirname(inputPath);
  const inputBasename = path.basename(inputPath, '.md');

  let result: string | undefined;
  try {
    result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Exporting Marp slides…', cancellable: true },
    async (progress, token): Promise<string | undefined> => {
      let md = doc.getText();

      // Find all tikz blocks
      const tikzRegex = /^```tikz\s*$([\s\S]*?)^```\s*$/gm;
      const blocks: { full: string; source: string }[] = [];
      let match;
      while ((match = tikzRegex.exec(md)) !== null) {
        blocks.push({ full: match[0], source: match[1] });
      }

      // Create temp directory for processed files
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tikz-marp-'));
      const imgDir = path.join(tmpDir, '.tikz-images');
      fs.mkdirSync(imgDir);

      try {
        // Render TikZ blocks to SVG
        if (blocks.length > 0) {
          for (let i = 0; i < blocks.length; i++) {
            if (token.isCancellationRequested) { return; }
            progress.report({ message: `Rendering diagram ${i + 1}/${blocks.length}…` });
            try {
              const svg = await renderTikzSourceToSvg(blocks[i].source);
              const fixed = fixSvgDimensions(svg);
              const svgFile = path.join(imgDir, `tikz-${i + 1}.svg`);
              fs.writeFileSync(svgFile, fixed, 'utf-8');

              const relPath = `.tikz-images/tikz-${i + 1}.svg`;
              const imgTag = `\n<div style="display:flex;justify-content:center;align-items:center;"><img src="${relPath}" /></div>\n`;
              md = md.replace(blocks[i].full, imgTag);
            } catch (err: any) {
              md = md.replace(blocks[i].full, `<p style="color:red;">TikZ render failed: ${escapeHtml(err.message)}</p>`);
            }
          }
        }

        if (token.isCancellationRequested) { return; }

        // Write processed markdown to temp dir
        const processedMdPath = path.join(tmpDir, `${inputBasename}.md`);
        fs.writeFileSync(processedMdPath, md, 'utf-8');

        // Symlink assets from original directory so relative paths in CSS resolve
        for (const entry of fs.readdirSync(inputDir)) {
          const src = path.join(inputDir, entry);
          const dest = path.join(tmpDir, entry);
          if (!fs.existsSync(dest)) {
            try { fs.symlinkSync(src, dest); } catch { /* skip if symlink fails */ }
          }
        }

        // Determine output path (next to original file, timestamped)
        const now = new Date();
        const dd = String(now.getDate()).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        const outputPath = path.join(inputDir, `${inputBasename}-${dd}-${hh}${mm}${ss}.pptx`);

        // Run marp-cli with retry on failure
        const maxAttempts = 2;
        let lastError: Error | undefined;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          if (token.isCancellationRequested) { return; }
          progress.report({
            message: attempt > 1
              ? `Retrying marp-cli (attempt ${attempt}/${maxAttempts})…`
              : 'Running marp-cli…'
          });
          try {
            await runMarpCli(processedMdPath, outputPath, tmpDir, MARP_CLI_TIMEOUT);
            lastError = undefined;
            break;
          } catch (err: any) {
            lastError = err;
            outputChannel.appendLine(`[marp-export] Attempt ${attempt} failed: ${err.message}`);
          }
        }

        if (lastError) {
          throw lastError;
        }

        // Post-process: remove full-slide blank overlay shapes
        // LibreOffice's ODP→PPTX conversion creates opaque white rectangles
        // covering the entire slide that block clicking/selecting content.
        try {
          await fixPptxOverlays(outputPath);
          outputChannel.appendLine('[marp-export] Post-processed PPTX: removed overlay shapes');
        } catch (ppErr: any) {
          outputChannel.appendLine(`[marp-export] PPTX post-processing failed: ${ppErr.message}`);
        }

        return outputPath;
      } finally {
        // Cleanup temp directory
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  );
  } catch (err: any) {
    const retry = await vscode.window.showErrorMessage(
      `Export failed: ${err.message}`,
      'Retry', 'Dismiss'
    );
    if (retry === 'Retry') {
      await exportMarpPptx(doc);
    }
    return;
  }

  if (result) {
    const action = await vscode.window.showInformationMessage(
      `Exported to ${path.basename(result)}`,
      'Open File', 'Reveal in Finder'
    );
    if (action === 'Open File') {
      await vscode.env.openExternal(vscode.Uri.file(result));
    } else if (action === 'Reveal in Finder') {
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(result));
    }
  }
}

/**
 * Remove full-slide blank overlay shapes from editable PPTX and renumber IDs.
 * LibreOffice's ODP→PPTX conversion generates opaque white rectangles
 * that cover the entire slide, blocking interaction with real content.
 * After removal, shape IDs are renumbered to avoid gaps that trigger
 * PowerPoint's repair prompt.
 */
async function fixPptxOverlays(pptxPath: string): Promise<void> {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(fs.readFileSync(pptxPath));
  let modified = false;

  // Read slide dimensions from presentation.xml
  const presXml = await zip.file('ppt/presentation.xml')!.async('string');
  const sldSzMatch = presXml.match(/<p:sldSz\s+cx="(\d+)"\s+cy="(\d+)"/);
  if (!sldSzMatch) { return; }
  const slideW = parseInt(sldSzMatch[1], 10);
  const slideH = parseInt(sldSzMatch[2], 10);

  const slidePattern = /^ppt\/slides\/slide\d+\.xml$/;
  for (const filename of Object.keys(zip.files)) {
    if (!slidePattern.test(filename)) { continue; }

    const original = await zip.file(filename)!.async('string');
    let xml = original;

    xml = xml.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, (match: string) => {
      const extMatch = match.match(/<a:ext\s+cx="(\d+)"\s+cy="(\d+)"/);
      if (!extMatch) { return match; }
      const cx = parseInt(extMatch[1], 10);
      const cy = parseInt(extMatch[2], 10);
      // Shape must cover >= 98% of the slide to be considered an overlay
      if (cx < slideW * 0.98 || cy < slideH * 0.98) { return match; }
      // Only remove white (FFFFFF) overlays; keep colored backgrounds
      const fillMatch = match.match(/<a:solidFill>\s*<a:srgbClr\s+val="([^"]+)"/);
      if (fillMatch && fillMatch[1] !== 'FFFFFF') { return match; }
      const textRegex = /<a:t>([^<]*)<\/a:t>/g;
      let tm;
      while ((tm = textRegex.exec(match)) !== null) {
        if (tm[1].trim()) { return match; }
      }
      return '';
    });

    if (xml !== original) {
      let nextId = 2;
      xml = xml.replace(/<p:cNvPr\s+id="(\d+)"/g, (match: string, id: string) => {
        if (id === '1') { return match; }
        return `<p:cNvPr id="${nextId++}"`;
      });
      zip.file(filename, xml);
      modified = true;
    }
  }

  if (modified) {
    const output = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    fs.writeFileSync(pptxPath, output);
  }
}

export function deactivate(): void {
  if (previewManager) { previewManager.dispose(); previewManager = undefined; }
  if (configManager) { configManager.dispose(); configManager = undefined; }
  cacheManager = undefined;
  documentParser = undefined;
}
