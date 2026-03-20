import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFile, execFileSync } from 'child_process';
import { DocumentParser } from './core/DocumentParser';
import { CacheManager } from './core/CacheManager';
import { ConfigurationManager } from './config/ConfigurationManager';
import { PreviewManager } from './preview/PreviewManager';
import { MarpSlideNavigator } from './preview/MarpSlideNavigator';
import { generateHash } from './utils/hash';
import { extractAndReplaceMath, ExtractedMath } from './utils/mathPreprocessor';
import { latexToOmml } from './utils/mathToOmml';


let previewManager: PreviewManager | undefined;
let configManager: ConfigurationManager | undefined;
let cacheManager: CacheManager | undefined;
let documentParser: DocumentParser | undefined;
let outputChannel: vscode.OutputChannel;

/** Track the last known markdown document so we don't depend on activeTextEditor */
let lastMarkdownDocument: vscode.TextDocument | undefined;

/** Toggle state injected into preview via tikz fence output */
let thumbPanelVisible = false;
let thumbToggleSeq = 0;

/** Cached speaker notes per slide, injected via tikz fence output */
let cachedSlideNotes: string[] = [];
let notesInjected = false;

/** Parse Marp speaker notes from markdown source.
 *  Notes are HTML comments (<!-- ... -->) within each slide. */
function parseSpeakerNotes(markdown: string): string[] {
  const lines = markdown.split('\n');
  const notes: string[] = [];
  let currentNotes: string[] = [];
  let inFrontmatter = false;
  let frontmatterDone = false;
  let inComment = false;
  let commentLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip frontmatter
    if (i === 0 && line.trim() === '---') { inFrontmatter = true; continue; }
    if (inFrontmatter && line.trim() === '---') { inFrontmatter = false; frontmatterDone = true; continue; }
    if (inFrontmatter || !frontmatterDone) { continue; }

    // Slide separator
    if (line.trim() === '---') {
      notes.push(currentNotes.join('\n').trim());
      currentNotes = [];
      continue;
    }

    // Multi-line comment handling
    if (inComment) {
      const endIdx = line.indexOf('-->');
      if (endIdx >= 0) {
        commentLines.push(line.substring(0, endIdx));
        currentNotes.push(commentLines.join('\n').trim());
        commentLines = [];
        inComment = false;
      } else {
        commentLines.push(line);
      }
      continue;
    }

    // Single-line comment: <!-- ... -->
    const singleMatch = line.match(/<!--\s*(.*?)\s*-->/);
    if (singleMatch) {
      // Skip directives like <!-- _class: title -->
      const content = singleMatch[1];
      if (content && !content.match(/^_?\w+\s*:/)) {
        currentNotes.push(content);
      }
      continue;
    }

    // Start of multi-line comment: <!--
    const startMatch = line.match(/<!--\s*(.*)/);
    if (startMatch) {
      inComment = true;
      commentLines = [startMatch[1]];
      continue;
    }
  }
  // Last slide
  notes.push(currentNotes.join('\n').trim());

  return notes;
}


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

  // Pre-warm slow detection caches in background so first export is instant
  setTimeout(() => { marpSupportsEditablePptx(); isLibreOfficeInstalled(); }, 2000);

  // Marp slide navigator
  const slideNavigator = new MarpSlideNavigator();
  vscode.window.registerTreeDataProvider('tikzMarpSlides', slideNavigator);

  context.subscriptions.push(
    vscode.commands.registerCommand('tikz.toggleThumbnails', async () => {
      thumbPanelVisible = !thumbPanelVisible;
      thumbToggleSeq++;
      outputChannel.appendLine(`[toggle] visible=${thumbPanelVisible} seq=${thumbToggleSeq}`);
      await vscode.commands.executeCommand('markdown.preview.refresh');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('tikzjax.goToSlide', async (line: number) => {
      const doc = lastMarkdownDocument || vscode.window.visibleTextEditors.find(
        e => e.document.languageId === 'markdown'
      )?.document;
      if (!doc) { return; }
      // Move cursor if editor is already visible (don't force editor open)
      const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === doc.uri.toString());
      if (editor) {
        const pos = new vscode.Position(line, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.AtTop);
      }
    })
  );
  // Refresh navigator and thumbnails on document changes and editor switches
  const refreshNavigator = () => {
    const doc = lastMarkdownDocument || vscode.window.activeTextEditor?.document;
    if (doc?.languageId === 'markdown') {
      slideNavigator.refresh(doc);
    }
  };
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.languageId === 'markdown') {
        slideNavigator.refresh(e.document);
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(() => refreshNavigator()),
    vscode.window.onDidChangeVisibleTextEditors(() => refreshNavigator())
  );
  refreshNavigator();

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

    // Piggyback signals on tikz fence output (raw HTML, bypasses Marp's html sanitization)
    let signalHtml = '';
    if (thumbToggleSeq > 0) {
      signalHtml += `<div data-marp-thumb-toggle="${thumbToggleSeq}" data-marp-thumb-visible="${thumbPanelVisible}" style="display:none"></div>`;
    }
    // Inject speaker notes data once per render cycle
    if (!notesInjected && cachedSlideNotes.length > 0) {
      notesInjected = true;
      const notesJson = JSON.stringify(cachedSlideNotes).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
      signalHtml += `<div data-marp-slide-notes='${notesJson.replace(/'/g, '&#39;')}' style="display:none"></div>`;
    }

    if (result?.svg) {
      outputChannel.appendLine(`[render] hash=${hash.slice(0, 8)} → cached SVG`);
      return `<div class="tikz-diagram" style="text-align:center;margin:1em 0">${result.svg}</div>${signalHtml}\n`;
    } else if (result?.error) {
      outputChannel.appendLine(`[render] hash=${hash.slice(0, 8)} → error: ${result.error.slice(0, 80)}`);
      const escaped = escapeHtml(result.error);
      return `<div class="tikz-diagram tikz-error" style="text-align:center;margin:1em 0;color:#c00"><div class="tikz-error-title">⚠ Rendering Error</div><pre class="tikz-error-message" style="white-space:pre-wrap">${escaped}</pre></div>${signalHtml}\n`;
    } else {
      outputChannel.appendLine(`[render] hash=${hash.slice(0, 8)} → not cached, triggering background render`);
      scheduleBackgroundRender();
      return `<div class="tikz-diagram tikz-loading" style="text-align:center;margin:1em 0"><span class="tikz-spinner"></span> Rendering TikZ diagram…</div>${signalHtml}\n`;
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

      /** Reset per-render state and extract speaker notes from source */
      const prepareRender = (src: string): void => {
        notesInjected = false;
        cachedSlideNotes = parseSpeakerNotes(src);
      };

      // Wrap md.parse synchronously (handles case where we load after Marp)
      const origParse = md.parse.bind(md);
      md.parse = function (src: string, env?: any) {
        prepareRender(src);
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
          prepareRender(src);
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
    vscode.commands.registerCommand('tikz.openPreview', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { vscode.window.showWarningMessage('No active editor found'); return; }
      if (editor.document.languageId !== 'markdown') {
        vscode.window.showWarningMessage('TikZ preview is only available for Markdown files'); return;
      }
      if (!previewManager) { return; }
      await previewManager.createOrShowPreview(editor.document);
    }),

    vscode.commands.registerCommand('tikz.refreshDiagrams', async () => {
      const doc = findMarkdownDocument();
      if (!doc || !previewManager || !cacheManager || !documentParser) { return; }
      const blocks = documentParser.parse(doc);
      for (const block of blocks) { await cacheManager.invalidate(block.hash); }
      previewManager.clearMemoryCache();
      await previewManager.renderDocument(doc);
      vscode.window.setStatusBarMessage(`$(sync) Refreshed ${blocks.length} TikZ diagram(s)`, 3000);
    }),

    vscode.commands.registerCommand('tikz.clearCache', async () => {
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

    vscode.commands.registerCommand('tikz.resetEngine', async () => {
      if (!previewManager) { return; }
      await previewManager.resetEngine();
      vscode.window.setStatusBarMessage('$(debug-restart) TikZJax engine reset', 3000);
    }),

    vscode.commands.registerCommand('tikz.exportMarpPptx', async () => {
      const editor = vscode.window.activeTextEditor;
      const doc = (editor && editor.document.languageId === 'markdown')
        ? editor.document
        : findMarkdownDocument();
      if (!doc) {
        vscode.window.showWarningMessage('Open a Marp markdown file to export.');
        return;
      }
      await exportMarpPptx(doc);
    }),

    vscode.commands.registerCommand('tikz.toggleMarpPptxNotes', async () => {
      const config = vscode.workspace.getConfiguration('tikzjax');
      const current = config.get<boolean>('marpPptxNotes', true);
      await config.update('marpPptxNotes', !current, vscode.ConfigurationTarget.Global);
      vscode.window.setStatusBarMessage(
        `$(note) Speaker notes export: ${!current ? 'enabled' : 'disabled'}`, 3000
      );
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
    vscode.commands.executeCommand('setContext', 'tikz.isMarpFile', false);
    return;
  }
  const head = doc.getText().slice(0, 500);
  const isMarp = /^---[\s\S]*?marp:\s*true/m.test(head);
  vscode.commands.executeCommand('setContext', 'tikz.isMarpFile', isMarp);
}

/**
 * When the preview webview is focused, activeTextEditor is undefined.
 * The markdown file being previewed is guaranteed to be in workspace.textDocuments
 * (VS Code keeps it open). Cross-reference via tab groups to find the right file
 * when multiple markdown docs are open.
 */
function findMarkdownDocumentForFocusedPreview(): vscode.TextDocument | undefined {
  const mdDocs = vscode.workspace.textDocuments.filter(d => d.languageId === 'markdown');
  if (mdDocs.length === 0) { return undefined; }
  if (mdDocs.length === 1) { return mdDocs[0]; }

  // Multiple markdown files open: find the one in the same tab group as the active preview
  const allGroups = vscode.window.tabGroups.all;
  const activeGroup = allGroups.find(g => g.isActive) ?? allGroups[0];
  for (const tab of activeGroup.tabs) {
    if (tab.input instanceof vscode.TabInputText) {
      const uri = (tab.input as vscode.TabInputText).uri;
      const doc = mdDocs.find(d => d.uri.toString() === uri.toString());
      if (doc) { return doc; }
    }
  }

  return mdDocs[0]; // fallback
}

function registerEventHandlers(context: vscode.ExtensionContext): void {
  // Set initial Marp context.
  // If the preview webview is focused on reload, activeTextEditor is undefined.
  // The previewed markdown file is always in workspace.textDocuments — use that.
  const initialDoc = vscode.window.activeTextEditor?.document
    ?? findMarkdownDocumentForFocusedPreview();
  if (initialDoc?.languageId === 'markdown') {
    lastMarkdownDocument = initialDoc;
  }
  updateMarpContext(initialDoc);

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


// Cached on first call — spawning marp-cli/soffice for version checks is slow (~2-3s)
let _marpEditableCache: boolean | undefined;
let _libreOfficeCache: boolean | undefined;

/** Check marp-cli version and return true if >= 4.1.0. Result is cached. */
function marpSupportsEditablePptx(): boolean {
  if (_marpEditableCache !== undefined) { return _marpEditableCache; }
  try {
    const { cmd, prefix } = resolveMarpCli();
    const verOut = execFileSync(cmd, [...prefix, '--version'], {
      encoding: 'utf-8', timeout: 10000,
    }).trim();
    const m = verOut.match(/(\d+)\.(\d+)\.\d+/);
    if (!m) { _marpEditableCache = false; return false; }
    const [, major, minor] = m.map(Number);
    _marpEditableCache = major > 4 || (major === 4 && minor >= 1);
  } catch {
    _marpEditableCache = false;
  }
  return _marpEditableCache;
}

function isLibreOfficeInstalled(): boolean {
  if (_libreOfficeCache !== undefined) { return _libreOfficeCache; }
  try {
    if (process.platform === 'darwin') {
      _libreOfficeCache = fs.existsSync('/Applications/LibreOffice.app');
    } else if (process.platform === 'win32') {
      execFileSync('where', ['soffice'], { encoding: 'utf-8', timeout: 5000 });
      _libreOfficeCache = true;
    } else {
      execFileSync('which', ['soffice'], { encoding: 'utf-8', timeout: 5000 });
      _libreOfficeCache = true;
    }
  } catch {
    _libreOfficeCache = false;
  }
  return _libreOfficeCache;
}

/**
 * Run marp-cli to convert processed markdown to PPTX or PDF.
 */
function runMarpCli(processedMdPath: string, outputPath: string, cwd: string, timeoutMs: number, useEditable: boolean, format: 'pptx' | 'pdf' = 'pptx'): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const { cmd, prefix } = resolveMarpCli();

    const formatFlag = format === 'pdf' ? '--pdf' : '--pptx';
    const args = [formatFlag, '--allow-local-files', '--html', '--no-stdin', processedMdPath, '-o', outputPath];
    if (format === 'pptx' && useEditable && marpSupportsEditablePptx()) {
      args.splice(1, 0, '--pptx-editable');
      outputChannel.appendLine('[marp-export] --pptx-editable enabled (editable slides; disable tikzjax.marpPptxEditable if math misaligns)');
    } else if (format === 'pptx' && !useEditable) {
      outputChannel.appendLine('[marp-export] --pptx-editable disabled by setting; using bitmap PPTX for accurate math rendering');
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
 * Export the active Marp document to PPTX or PDF, rendering TikZ blocks to SVG first.
 * Shows a pre-export options toast (format + speaker notes) and persists the choice.
 */
async function exportMarpPptx(doc: vscode.TextDocument): Promise<void> {
  const inputPath = doc.uri.fsPath;
  const inputDir = path.dirname(inputPath);
  const inputBasename = path.basename(inputPath, '.md');

  // ── Pre-export options prompt ─────────────────────────────────────────────
  const cfg = vscode.workspace.getConfiguration('tikzjax');
  const lastFormat = cfg.get<'pptx' | 'pdf'>('exportFormat', 'pptx');
  const lastNotes  = cfg.get<boolean>('marpPptxNotes', true);

  // Put last-used button first so it appears highlighted (primary position)
  const allButtons: Array<'PPTX + Notes' | 'PPTX' | 'PDF'> = ['PPTX + Notes', 'PPTX', 'PDF'];
  const lastBtn: 'PPTX + Notes' | 'PPTX' | 'PDF' =
    lastFormat === 'pdf' ? 'PDF' : lastNotes ? 'PPTX + Notes' : 'PPTX';
  const ordered = [lastBtn, ...allButtons.filter(b => b !== lastBtn)];

  const choice = await vscode.window.showInformationMessage(
    'Select export format:',
    ...ordered
  );
  if (!choice) { return; }

  const exportFormat: 'pptx' | 'pdf' = choice === 'PDF' ? 'pdf' : 'pptx';
  const exportNotes = choice === 'PPTX + Notes';

  // Persist choices
  await cfg.update('exportFormat', exportFormat, vscode.ConfigurationTarget.Global);
  if (exportFormat === 'pptx') {
    await cfg.update('marpPptxNotes', exportNotes, vscode.ConfigurationTarget.Global);
  }
  // ─────────────────────────────────────────────────────────────────────────

  let result: string | undefined;
  try {
    result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Exporting Marp slides…', cancellable: true },
    async (progress, token): Promise<string | undefined> => {
      // Check LibreOffice availability (PPTX editable mode only)
      if (exportFormat === 'pptx' && marpSupportsEditablePptx() && !isLibreOfficeInstalled()) {
        const action = await vscode.window.showWarningMessage(
          'LibreOffice is required for editable PPTX export. Without it, slides will be exported as non-editable images.',
          'Download LibreOffice', 'Continue Anyway', 'Cancel'
        );
        if (action === 'Download LibreOffice') {
          await vscode.env.openExternal(vscode.Uri.parse('https://www.libreoffice.org/download/download-libreoffice/'));
          return;
        }
        if (action !== 'Continue Anyway') { return; }
      }
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
              const svg = await previewManager!.renderTikzToSvg(blocks[i].source);
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

        const useEditable = configManager?.getConfiguration().marpPptxEditable ?? true;
        const isPptxEditable = exportFormat === 'pptx' && useEditable && marpSupportsEditablePptx();

        const mathResult = isPptxEditable
            ? extractAndReplaceMath(md)
            : { processedMarkdown: md, formulas: [] as ExtractedMath[] };
        md = mathResult.processedMarkdown;
        if (mathResult.formulas.length > 0) {
            outputChannel.appendLine(`[marp-export] Extracted ${mathResult.formulas.length} math formula(s) for OMML injection`);
        }
        // Strip .eq-row / .eq-body div wrappers so display math placeholders are inline
        // in the paragraph flow. Without stripping, LibreOffice creates a separate floating
        // shape per formula, causing OMML to appear as a layer overlapping adjacent content.
        if (isPptxEditable && mathResult.formulas.some(f => f.isDisplay)) {
            md = md.replace(
                /<div class="eq-row">\s*<div class="eq-body">\s*(MARPMATH\d+)\s*<\/div>(?:\s*<div class="eq-num">([^<]*)<\/div>)?\s*<\/div>/g,
                (_m: string, placeholder: string, eqNum?: string) =>
                    `\n\n${placeholder}${eqNum ? '    ' + eqNum.trim() : ''}\n\n`
            );
            // Collapse 3+ consecutive newlines to 2 to prevent extra blank paragraphs in PPTX
            md = md.replace(/\n{3,}/g, '\n\n');
        }

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
        const outputExt = exportFormat === 'pdf' ? '.pdf' : '.pptx';
        const outputPath = path.join(inputDir, `${inputBasename}-${dd}-${hh}${mm}${ss}${outputExt}`);

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
            await runMarpCli(processedMdPath, outputPath, tmpDir, MARP_CLI_TIMEOUT, useEditable, exportFormat);
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

        // PPTX-only post-processing
        if (exportFormat === 'pptx') {
          // Remove full-slide blank overlay shapes (LibreOffice artefact)
          try {
            await fixPptxOverlays(outputPath);
            outputChannel.appendLine('[marp-export] Post-processed PPTX: removed overlay shapes');
          } catch (ppErr: any) {
            outputChannel.appendLine(`[marp-export] PPTX post-processing failed: ${ppErr.message}`);
          }

          // Inject native OMML math objects
          if (mathResult.formulas.length > 0) {
            progress.report({ message: 'Injecting math formulas…' });
            try {
              await injectMathIntoSlides(outputPath, mathResult.formulas);
              outputChannel.appendLine(`[marp-export] Injected ${mathResult.formulas.length} math formula(s) as OMML`);
            } catch (mErr: any) {
              outputChannel.appendLine(`[marp-export] Math injection failed: ${mErr.message}`);
            }
          }

          // Inject speaker notes
          if (exportNotes) {
            const slideNotes = parseSpeakerNotes(doc.getText());
            if (slideNotes.some(n => n)) {
              progress.report({ message: 'Injecting speaker notes…' });
              try {
                await injectSpeakerNotes(outputPath, slideNotes);
                outputChannel.appendLine(`[marp-export] Injected speaker notes for ${slideNotes.filter(n => n).length} slide(s)`);
              } catch (nErr: any) {
                outputChannel.appendLine(`[marp-export] Speaker notes injection failed: ${nErr.message}`);
              }
            }
          }
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

// ─── OMML Math Injection ────────────────────────────────────────────────────

const OMML_M_NS   = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const OMML_A14_NS = 'http://schemas.microsoft.com/office/drawing/2010/main';

/**
 * Post-processes a PPTX file: finds placeholder text injected by extractAndReplaceMath(),
 * converts each formula to OMML, and replaces the placeholder with a native PowerPoint
 * math object (<m:oMath>...</m:oMath> directly inside <a:p>).
 */
async function injectMathIntoSlides(pptxPath: string, formulas: ExtractedMath[]): Promise<void> {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(fs.readFileSync(pptxPath));
  const formulaMap = new Map<string, ExtractedMath>(formulas.map(f => [f.placeholder, f]));
  const slidePattern = /^ppt\/slides\/slide\d+\.xml$/;
  let modified = false;

  // Read slide dimensions from presentation.xml
  let slideCx = 12192000; // default: 1280px Marp widescreen
  let slideCy = 6858000;  // default: 720px Marp widescreen
  const presFile = zip.file('ppt/presentation.xml');
  if (presFile) {
    const presXml: string = await presFile.async('string');
    const cxM = /sldSz\b[^>]*\bcx="(\d+)"/.exec(presXml);
    const cyM = /sldSz\b[^>]*\bcy="(\d+)"/.exec(presXml);
    if (cxM) { slideCx = parseInt(cxM[1], 10); }
    if (cyM) { slideCy = parseInt(cyM[1], 10); }
  }

  for (const filename of Object.keys(zip.files)) {
    if (!slidePattern.test(filename)) { continue; }
    const original: string = await zip.file(filename)!.async('string');
    const processed = processSlideXml(original, formulaMap, slideCx, slideCy);
    if (processed !== original) {
      zip.file(filename, processed);
      modified = true;
    }
  }

  if (modified) {
    const output = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    fs.writeFileSync(pptxPath, output);
  }
}

/** Inject m: and a14: namespaces into the slide root element if not already present. */
function ensureSlideNamespaces(xml: string): string {
  let out = xml;
  if (!out.includes('xmlns:m=')) {
    out = out.replace(/(<p:sld\b[^>]*?)(\s*>)/, `$1 xmlns:m="${OMML_M_NS}"$2`);
  }
  if (!out.includes('xmlns:a14=')) {
    out = out.replace(/(<p:sld\b[^>]*?)(\s*>)/, `$1 xmlns:a14="${OMML_A14_NS}"$2`);
  }
  return out;
}

/**
 * Processes a single slide XML string, replacing all math placeholders with OMML.
 * Operates at the <p:sp> shape level so we can also fix shape geometry for display math.
 */
function processSlideXml(xml: string, formulaMap: Map<string, ExtractedMath>, slideCx: number, slideCy: number): string {
  let hasAny = false;
  for (const key of formulaMap.keys()) {
    if (xml.includes(key)) { hasAny = true; break; }
  }
  if (!hasAny) { return xml; }

  let result = xml.replace(/<p:sp>([\s\S]*?)<\/p:sp>/g, (spXml: string) => {
    return processShape(spXml, formulaMap, slideCx);
  });

  if (result === xml) { return xml; }

  // Second pass: detect and resolve vertical overlap for display math shapes.
  // Must run before centering so we know the true post-expansion content height.
  result = fixDisplayMathLayout(result, slideCx, slideCy);

  // Third pass: vertically center the content cluster in the available zone.
  // Because content height varies per slide (more formulas → taller cluster),
  // margins are computed automatically rather than hardcoded.
  result = centerContentVertically(result, slideCy);

  return ensureSlideNamespaces(result);
}

/**
 * Processes a single <p:sp> shape: injects OMML for any math placeholders,
 * and widens the shape to slide width when it contains only display math.
 */
function processShape(spXml: string, formulaMap: Map<string, ExtractedMath>, slideCx: number): string {
  let hasAny = false;
  for (const key of formulaMap.keys()) {
    if (spXml.includes(key)) { hasAny = true; break; }
  }
  if (!hasAny) { return spXml; }

  // Detect display-only shape BEFORE injecting (placeholder text is still present)
  const displayOnly = isDisplayMathOnlyShape(spXml, formulaMap);

  // Inject OMML into paragraphs
  let result = spXml.replace(/<a:p>([\s\S]*?)<\/a:p>/g, (paraXml: string, paraContent: string) => {
    return processParagraph(paraXml, paraContent, formulaMap, displayOnly);
  });

  if (result === spXml) { return spXml; }

  // Remove empty paragraphs adjacent to OMML — artifacts of \n\n placeholder wrapping
  if (result.includes('a14:m')) {
    result = removeEmptyParasAdjacentToOmml(result);
  }

  // For display-only shapes: widen to slide width so centering works correctly
  if (displayOnly) { result = widenShape(result, slideCx); }

  return result;
}

/** Returns true if the shape's entire text content is exactly one display math placeholder. */
function isDisplayMathOnlyShape(spXml: string, formulaMap: Map<string, ExtractedMath>): boolean {
  const tRe = /<a:t[^>]*>([^<]*)<\/a:t>/g;
  let m: RegExpExecArray | null;
  let combined = '';
  while ((m = tRe.exec(spXml)) !== null) {
    combined += decodeXmlEntities(m[1]);
  }
  const formula = formulaMap.get(combined.trim());
  return formula?.isDisplay === true;
}

/** Widens a shape to slide width (x=0) for display math centering.
 *  Only adjusts horizontal geometry; cy (height) is left exactly as LibreOffice set it
 *  so we never artificially resize formula shapes. */
function widenShape(spXml: string, slideCx: number): string {
  let result = spXml;
  result = result.replace(/(<a:off\b[^>]*\bx=")[^"]*"/, '$10"');
  result = result.replace(/(<a:ext\b[^>]*\bcx=")[^"]*"/, `$1${slideCx}"`);
  return result;
}

// ─── Display-math layout adjustment ──────────────────────────────────────────

/**
 * Removes empty <a:p> paragraphs immediately before or after OMML-containing paragraphs
 * within a single shape's XML. These empty paragraphs are artifacts of the \n\n wrapping
 * added around math placeholders in extractAndReplaceMath().
 */
function removeEmptyParasAdjacentToOmml(spXml: string): string {
  let result = spXml;
  // Remove empty paragraph (no <a:r> or <a14:m>) immediately BEFORE an OMML paragraph
  result = result.replace(
    /<a:p>([\s\S]*?)<\/a:p>(\s*<a:p>[\s\S]*?<a14:m>)/g,
    (_m, before, next) => /<a:r>|<a14:m>/.test(before) ? `<a:p>${before}</a:p>${next}` : next
  );
  // Remove empty paragraph immediately AFTER an OMML paragraph
  result = result.replace(
    /(<\/a14:m>[\s\S]*?<\/a:p>)\s*<a:p>([\s\S]*?)<\/a:p>/g,
    (_m, ommlClose, after) =>
      /<a:r>|<a14:m>/.test(after) ? `${ommlClose}<a:p>${after}</a:p>` : ommlClose
  );
  return result;
}

/**
 * Vertically centers the content cluster in the zone between the slide header and
 * footer. Margins are computed automatically from actual content height, so slides
 * with more content get smaller margins and slides with less content get larger ones.
 *
 * Runs AFTER fixDisplayMathLayout so formula shapes already have their expanded cy,
 * giving an accurate content span to center against.
 *
 * Footer detection: Marp footer shapes are thin decorative bars (cy < 200 000 EMU)
 * located in the bottom 10 % of the slide — distinguished from content shapes that
 * fixDisplayMathLayout may have pushed into the same region.
 *
 * Only shifts content UP (removes the LibreOffice-added blank gap). Never shifts
 * down — if content is already at or below center the slide layout is left alone.
 */
function centerContentVertically(xml: string, slideCy: number): string {
  const HEADER_ZONE    = Math.round(slideCy * 0.15);  // y < this → header shape
  const FOOTER_Y_MIN   = Math.round(slideCy * 0.90);  // y > this AND small cy → footer
  const FOOTER_CY_MAX  = 200000;                       // thin bar ≈ footer decoration

  // Scan <p:sp> shapes to classify each as header, footer, or content.
  const spRe = /<p:sp>([\s\S]*?)<\/p:sp>/g;
  let spM: RegExpExecArray | null;
  let headerBottom   = 0;
  let firstContentY  = Infinity;
  let lastContentBot = 0;

  while ((spM = spRe.exec(xml)) !== null) {
    const inner = spM[1];
    const yM  = /<a:off\b[^>]*\by="(\d+)"/.exec(inner);
    const cyM = /<a:ext\b[^>]*\bcy="(\d+)"/.exec(inner);
    if (!yM || !cyM) { continue; }
    const y  = parseInt(yM[1], 10);
    const cy = parseInt(cyM[1], 10);

    if (y < HEADER_ZONE) {
      headerBottom = Math.max(headerBottom, y + cy);
    } else if (y >= FOOTER_Y_MIN && cy < FOOTER_CY_MAX) {
      // Thin bar near slide bottom — Marp footer decoration, skip
    } else {
      firstContentY  = Math.min(firstContentY, y);
      lastContentBot = Math.max(lastContentBot, y + cy);
    }
  }

  if (firstContentY === Infinity || headerBottom === 0) { return xml; }

  const contentSpan   = lastContentBot - firstContentY;
  const footerTop     = Math.round(slideCy * 0.93); // conservative footer boundary
  const availableZone = footerTop - headerBottom;

  if (contentSpan >= availableZone) { return xml; }  // content already fills zone

  // Target: equal margins above and below the content cluster
  const margin      = Math.round((availableZone - contentSpan) / 2);
  const targetFirst = headerBottom + margin;
  const upShift     = firstContentY - targetFirst;

  if (upShift <= 0) { return xml; }   // already at or below center — leave it
  if (upShift < 100000) { return xml; } // negligible shift

  // Apply shift only to content shapes (skip header and footer shapes by y+cy criteria)
  return xml.replace(/<p:sp>([\s\S]*?)<\/p:sp>/g, (spXml: string, inner: string) => {
    const yM  = /<a:off\b[^>]*\by="(\d+)"/.exec(inner);
    const cyM = /<a:ext\b[^>]*\bcy="(\d+)"/.exec(inner);
    if (!yM || !cyM) { return spXml; }
    const y  = parseInt(yM[1], 10);
    const cy = parseInt(cyM[1], 10);
    if (y < HEADER_ZONE) { return spXml; }                          // header
    if (y >= FOOTER_Y_MIN && cy < FOOTER_CY_MAX) { return spXml; } // footer
    return spXml.replace(/(<a:off\b[^>]*\by=")(\d+)("[^>]*\/>)/g,
      (_m, pre, yStr, post) => `${pre}${parseInt(yStr, 10) - upShift}${post}`
    );
  });
}

/**
 * After OMML injection, detects display-math shapes (full slide width) that may
 * overflow into content below, and shifts those lower shapes down to avoid overlap.
 * Estimates formula height from font size and OMML structural complexity.
 */
function fixDisplayMathLayout(xml: string, slideCx: number, slideCy: number): string {
  // Detect body font size once — used to normalize display math sz to match Marp rendering.
  // LibreOffice sets sz=2000 (20pt) on display math shapes but Marp renders at body sz (~16.5pt),
  // causing formulas to appear 1.2x too large in PPTX. Normalizing fixes both size and bounding box.
  const bodySz = findBodyFontSize(xml);

  type ShapeInfo = { y: number; estimatedCy: number };
  const mathShapes: ShapeInfo[] = [];
  const shapeReplacements: Array<{ original: string; replacement: string }> = [];

  const spRe = /<p:sp>([\s\S]*?)<\/p:sp>/g;
  let spM: RegExpExecArray | null;
  while ((spM = spRe.exec(xml)) !== null) {
    const spXml = spM[0];
    const inner = spM[1];
    if (!inner.includes('a14:m')) { continue; }

    const yM  = /<a:off\b[^>]*\by="(\d+)"/.exec(inner);
    const cxM = /<a:ext\b[^>]*\bcx="(\d+)"/.exec(inner);
    if (!yM || !cxM) { continue; }

    // Skip inline math shapes (not full-width) — only display math has cx === slideCx
    if (parseInt(cxM[1], 10) !== slideCx) { continue; }

    const ommlM = /<m:oMath>[\s\S]*?<\/m:oMath>/.exec(inner);
    const estimatedCy = estimateOmmlHeightEmu(ommlM ? ommlM[0] : '', bodySz);

    mathShapes.push({ y: parseInt(yM[1], 10), estimatedCy });

    // Normalize sz to body size and set cy to estimated height so the bounding box
    // matches the visual formula size (fixes "selection box too small" issue).
    let modified = normalizeShapeSz(spXml, bodySz);
    modified = setShapeCy(modified, estimatedCy);
    shapeReplacements.push({ original: spXml, replacement: modified });
  }
  if (mathShapes.length === 0) { return xml; }

  // Apply shape modifications (sz normalization + cy correction)
  let result = xml;
  for (const { original, replacement } of shapeReplacements) {
    const idx = result.indexOf(original);
    if (idx !== -1) {
      result = result.slice(0, idx) + replacement + result.slice(idx + original.length);
    }
  }

  mathShapes.sort((a, b) => a.y - b.y);

  // Footer shapes start at ~95% of slide height (Marp standard template: y≈6501600 in 6858000px).
  // Use 93% as the threshold — safely below the footer, leaving room for any Marp theme variant.
  // Shapes at y >= footerY are excluded from shifting and from the available-space calculation.
  const footerY = Math.round(slideCy * 0.93);

  for (let idx = 0; idx < mathShapes.length; idx++) {
    const { y: shapeY, estimatedCy } = mathShapes[idx];

    const nextY     = findNearestYBelow(result, shapeY);
    const available = nextY - shapeY;
    const overflow  = estimatedCy - available;

    if (overflow > 0) {
      const lowestBottom = findLowestShapeBottom(result, shapeY, footerY);
      const maxShift     = Math.max(0, slideCy - lowestBottom - 50000);
      const actualShift  = Math.min(overflow, maxShift);
      if (actualShift > 0) {
        result = shiftShapesBelow(result, shapeY, actualShift, footerY);
        for (let j = idx + 1; j < mathShapes.length; j++) {
          if (mathShapes[j].y > shapeY) {
            mathShapes[j] = { ...mathShapes[j], y: mathShapes[j].y + actualShift };
          }
        }
      }
    }
  }
  return result;
}

/** Estimates rendered OMML formula height in EMU from font size and structural complexity. */
function estimateOmmlHeightEmu(omml: string, szHundredthsPt: number): number {
  // Base single-line height: font size × 1.3 (includes typical ascenders/descenders)
  const base = (szHundredthsPt / 100) * 12700 * 1.3;
  const hasFraction  = /<m:f\b/.test(omml);
  // Count nesting depth: each undOvr nary (∑/∏) nests one level taller
  const undOvrCount  = (omml.match(/undOvr/g) || []).length;
  const hasSubSup    = /subSup/.test(omml);
  const hasRadical   = /<m:rad\b/.test(omml);
  let factor = 1.0;
  if (hasFraction && undOvrCount > 1) { factor = 4.5; }   // fraction inside nested sums
  else if (hasFraction && undOvrCount > 0) { factor = 4.5; }
  else if (undOvrCount > 1) { factor = 4.5; }             // nested sums (∑∑): much taller
  else if (undOvrCount === 1) { factor = 3.0; }           // single ∑
  else if (hasFraction) { factor = 3.0; }
  else if (hasSubSup || hasRadical) { factor = 2.2; }
  return Math.round(base * factor);
}

/** Scans all non-math shapes and returns the most frequently used text font size (hundredths-pt). */
function findBodyFontSize(xml: string): number {
  const szCounts = new Map<number, number>();
  const spRe = /<p:sp>([\s\S]*?)<\/p:sp>/g;
  let spM: RegExpExecArray | null;
  while ((spM = spRe.exec(xml)) !== null) {
    const inner = spM[1];
    if (inner.includes('a14:m')) { continue; }  // skip math shapes
    const szRe = /\bsz="(\d+)"/g;
    let szM: RegExpExecArray | null;
    while ((szM = szRe.exec(inner)) !== null) {
      const sz = parseInt(szM[1], 10);
      if (sz >= 800 && sz <= 4400) {
        szCounts.set(sz, (szCounts.get(sz) || 0) + 1);
      }
    }
  }
  if (szCounts.size === 0) { return 1800; }
  let bestSz = 1800;
  let bestCount = 0;
  for (const [sz, count] of szCounts) {
    if (count > bestCount) { bestCount = count; bestSz = sz; }
  }
  return bestSz;
}

/** Sets the cy attribute on the <a:ext> element inside a <p:sp> shape. */
function setShapeCy(spXml: string, cy: number): string {
  return spXml.replace(/(<a:ext\b[^>]*\bcy=")[^"]*"/, `$1${cy}"`);
}

/** Replaces all sz="N" font-size attributes inside a shape with the given value. */
function normalizeShapeSz(spXml: string, sz: number): string {
  return spXml.replace(/\bsz="\d+"/g, `sz="${sz}"`);
}

/** Returns the smallest y > thresholdY among all <a:off y="..."/> in the slide XML. */
function findNearestYBelow(xml: string, thresholdY: number): number {
  const re = /<a:off\b[^>]*\by="(\d+)"/g;
  let m: RegExpExecArray | null;
  let nearest = Infinity;
  while ((m = re.exec(xml)) !== null) {
    const y = parseInt(m[1], 10);
    if (y > thresholdY) { nearest = Math.min(nearest, y); }
  }
  return nearest === Infinity ? thresholdY + 10_000_000 : nearest;
}

/** Returns the maximum (y + cy) for shapes whose y is in [minShapeY, maxShapeY). */
function findLowestShapeBottom(xml: string, minShapeY: number = 0, maxShapeY: number = Infinity): number {
  const re = /<a:off\b[^>]*\by="(\d+)"[^>]*\/>\s*<a:ext\b[^>]*\bcy="(\d+)"/g;
  let m: RegExpExecArray | null;
  let lowest = 0;
  while ((m = re.exec(xml)) !== null) {
    const y = parseInt(m[1], 10);
    if (y > minShapeY && y < maxShapeY) {
      lowest = Math.max(lowest, y + parseInt(m[2], 10));
    }
  }
  return lowest;
}

/** Increments all <a:off y="..."/> where thresholdY < y < maxY by shiftEmu (in-place by regex). */
function shiftShapesBelow(xml: string, thresholdY: number, shiftEmu: number, maxY: number = Infinity): string {
  return xml.replace(/(<a:off\b[^>]*\by=")(\d+)("[^>]*\/>)/g, (m, pre, y, post) => {
    const yVal = parseInt(y, 10);
    return (yVal > thresholdY && yVal < maxY) ? `${pre}${yVal + shiftEmu}${post}` : m;
  });
}


// ─── Paragraph processing ─────────────────────────────────────────────────────

/**
 * Processes a single <a:p> paragraph: merges text across runs, detects placeholders,
 * and reconstructs the paragraph with OMML elements in place of placeholders.
 */
function processParagraph(paraXml: string, paraContent: string, formulaMap: Map<string, ExtractedMath>, centerAlign?: boolean): string {
  // Extract paragraph-level properties (preserved verbatim).
  // Use two-branch regex: self-closing OR element with children.
  // The old (?:\/>|<\/a:pPr>) pattern incorrectly stops at the first />
  // inside any child element (e.g. <a:lnSpc/>).
  const pPrMatch = /<a:pPr[^>]*\/>|<a:pPr[\s\S]*?<\/a:pPr>/.exec(paraContent);
  const endParaMatch = /<a:endParaRPr[^>]*\/>|<a:endParaRPr[\s\S]*?<\/a:endParaRPr>/.exec(paraContent);
  const pPr = pPrMatch ? pPrMatch[0] : '';
  const endParaRPr = endParaMatch ? endParaMatch[0] : '';

  // Collect all <a:r> runs: their text and run-property XML
  const runs: { text: string; rPr: string }[] = [];
  const runRe = /<a:r>([\s\S]*?)<\/a:r>/g;
  let rm: RegExpExecArray | null;
  while ((rm = runRe.exec(paraContent)) !== null) {
    const inner = rm[1];
    const textMatch = /<a:t[^>]*>([^<]*)<\/a:t>/.exec(inner);
    const rPrMatch = /(<a:rPr[^>]*\/>|<a:rPr[\s\S]*?<\/a:rPr>)/.exec(inner);
    runs.push({
      text: textMatch ? decodeXmlEntities(textMatch[1]) : '',
      rPr: rPrMatch ? rPrMatch[1] : '',
    });
  }

  const combinedText = runs.map(r => r.text).join('');

  // Check if this paragraph contains any placeholder
  let hasPlaceholder = false;
  for (const key of formulaMap.keys()) {
    if (combinedText.includes(key)) { hasPlaceholder = true; break; }
  }
  if (!hasPlaceholder) { return paraXml; }

  // Build run segments: map character positions to original rPr so we can preserve
  // per-run formatting (bold, italic, etc.) for text between/around placeholders.
  const runSegments: { start: number; end: number; rPr: string }[] = [];
  let runPos = 0;
  for (const run of runs) {
    runSegments.push({ start: runPos, end: runPos + run.text.length, rPr: run.rPr });
    runPos += run.text.length;
  }
  const fallbackRPr = runs.find(r => r.rPr)?.rPr ?? '';

  const newContent = buildParagraphContent(combinedText, runSegments, fallbackRPr, formulaMap);
  const effectivePPr = centerAlign ? ensureCenteredPPr(pPr) : pPr;
  return `<a:p>${effectivePPr}${newContent}${endParaRPr}</a:p>`;
}

/**
 * Emits text for [start, end) of combinedText, splitting across original run boundaries
 * to preserve per-run formatting (bold, italic, font, etc.).
 */
function emitTextRange(
  text: string,
  start: number,
  end: number,
  runSegments: { start: number; end: number; rPr: string }[],
  fallbackRPr: string,
): string {
  let out = '';
  for (const seg of runSegments) {
    if (seg.end <= start || seg.start >= end) { continue; }
    const segStart = Math.max(start, seg.start);
    const segEnd = Math.min(end, seg.end);
    const segText = text.slice(segStart, segEnd);
    if (segText) { out += makeTextRun(segText, seg.rPr || fallbackRPr); }
  }
  return out;
}

/**
 * Splits combinedText at placeholder boundaries, emitting OMML for formulas and
 * preserving original per-run rPr for surrounding text.
 */
function buildParagraphContent(
  text: string,
  runSegments: { start: number; end: number; rPr: string }[],
  fallbackRPr: string,
  formulaMap: Map<string, ExtractedMath>,
): string {
  const hits: { start: number; end: number; formula: ExtractedMath }[] = [];
  for (const [key, formula] of formulaMap) {
    let pos = text.indexOf(key);
    while (pos !== -1) {
      hits.push({ start: pos, end: pos + key.length, formula });
      pos = text.indexOf(key, pos + key.length);
    }
  }
  hits.sort((a, b) => a.start - b.start);

  let out = '';
  let cursor = 0;
  let prevWasOmml = false;
  for (const hit of hits) {
    if (hit.start > cursor) {
      const between = text.slice(cursor, hit.start);
      // When two inline formulas are adjacent or only whitespace-separated,
      // insert em-spaces (U+2003) for visible separation — ASCII spaces collapse
      if (prevWasOmml && between.trim() === '') {
        // ASCII spaces (any count) collapse in PowerPoint adjacent to OMML — use em-spaces
        out += makeTextRun('\u2003\u2003\u2003', fallbackRPr);
      } else {
        out += emitTextRange(text, cursor, hit.start, runSegments, fallbackRPr);
      }
    } else if (prevWasOmml) {
      // Consecutive OMML elements with no text between — insert gap
      out += makeTextRun('\u2003\u2003\u2003', fallbackRPr);
    }
    try {
      // PPTX math structure: <a14:m> wraps <m:oMath> inside <a:p>
      // (bare <m:oMath> without <a14:m> is silently ignored by PowerPoint)
      const omml = latexToOmml(hit.formula.latex, hit.formula.isDisplay);
      out += `<a14:m>${omml}</a14:m>`;
      prevWasOmml = true;
    } catch {
      out += makeTextRun(hit.formula.placeholder, fallbackRPr);
      prevWasOmml = false;
    }
    cursor = hit.end;
  }
  if (cursor < text.length) {
    out += emitTextRange(text, cursor, text.length, runSegments, fallbackRPr);
  }
  return out;
}

function ensureCenteredPPr(pPr: string): string {
  if (!pPr) { return '<a:pPr algn="ctr"/>'; }
  if (/algn=/.test(pPr)) { return pPr.replace(/algn="[^"]*"/, 'algn="ctr"'); }
  return pPr.replace(/<a:pPr/, '<a:pPr algn="ctr"');
}

function makeTextRun(text: string, rPr: string): string {
  if (!text) { return ''; }
  const spaceAttr = (text[0] === ' ' || text[text.length - 1] === ' ') ? ' xml:space="preserve"' : '';
  return `<a:r>${rPr}<a:t${spaceAttr}>${xmlEscapeAttr(text)}</a:t></a:r>`;
}

function xmlEscapeAttr(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function decodeXmlEntities(text: string): string {
  return text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

// ─── Speaker Notes Injection ─────────────────────────────────────────────────

function xmlEscapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildNotesSlideXml(noteText: string): string {
  const paras = noteText.split('\n')
    .map(line => `<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${xmlEscapeText(line)}</a:t></a:r></a:p>`)
    .join('\n          ');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="Slide Image Placeholder 1"/>
          <p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr>
          <p:nvPr><p:ph type="sldImg"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr/>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="3" name="Notes Placeholder 2"/>
          <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
          <p:nvPr><p:ph type="body" idx="1"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr/>
        <p:txBody>
          <a:bodyPr/><a:lstStyle/>
          ${paras}
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:notes>`;
}

function buildNotesSlideRelsXml(slideNum: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide${slideNum}.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="../notesMasters/notesMaster1.xml"/>
</Relationships>`;
}

function buildNotesMasterXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notesMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="Slide Image Placeholder 1"/>
          <p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr>
          <p:nvPr><p:ph type="sldImg"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="457200" y="274638"/><a:ext cx="4525963" cy="3645963"/></a:xfrm></p:spPr>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="3" name="Notes Placeholder 2"/>
          <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
          <p:nvPr><p:ph type="body" idx="1"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="457200" y="4021963"/><a:ext cx="8229600" cy="4525963"/></a:xfrm></p:spPr>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US" dirty="0"/></a:p></p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:txStyles><p:bodyStyle/><p:otherStyle/></p:txStyles>
</p:notesMaster>`;
}

function buildNotesMasterRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;
}

/**
 * Post-process PPTX to inject speaker notes into each slide.
 * Creates notesSlide XML files and wires up all required relationships.
 */
async function injectSpeakerNotes(pptxPath: string, notes: string[]): Promise<void> {
  if (notes.every(n => !n)) { return; }

  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(fs.readFileSync(pptxPath));

  // Determine ordered slide filenames from presentation.xml + its rels
  const presRelsXml: string = await zip.file('ppt/_rels/presentation.xml.rels')!.async('string');
  const presXml: string = await zip.file('ppt/presentation.xml')!.async('string');

  // rId -> relative slide path (e.g. "slides/slide1.xml")
  const rIdToSlide = new Map<string, string>();
  for (const m of presRelsXml.matchAll(/<Relationship\s+Id="([^"]+)"\s+Type="[^"]*\/slide"\s+Target="([^"]+)"/g)) {
    rIdToSlide.set(m[1], m[2]);
  }

  // Ordered rIds from sldIdLst
  const sldIdOrder: string[] = [];
  for (const m of presXml.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)) {
    sldIdOrder.push(m[1]);
  }

  const orderedSlideFiles = sldIdOrder.map(rId => rIdToSlide.get(rId)).filter(Boolean) as string[];

  // Ensure notes master exists
  const hasMaster = !!zip.file('ppt/notesMasters/notesMaster1.xml');
  if (!hasMaster) {
    zip.file('ppt/notesMasters/notesMaster1.xml', buildNotesMasterXml());
    zip.file('ppt/notesMasters/_rels/notesMaster1.xml.rels', buildNotesMasterRelsXml());
  }

  let contentTypesXml: string = await zip.file('[Content_Types].xml')!.async('string');
  let presRelsUpdated = presRelsXml;
  let modified = false;

  for (let i = 0; i < orderedSlideFiles.length && i < notes.length; i++) {
    const note = notes[i];
    if (!note) { continue; }

    const slideRelPath = orderedSlideFiles[i]; // e.g. "slides/slide1.xml"
    const slideNumMatch = slideRelPath.match(/slide(\d+)\.xml$/i);
    if (!slideNumMatch) { continue; }
    const slideNum = slideNumMatch[1];

    const slideRelsFile = `ppt/slides/_rels/slide${slideNum}.xml.rels`;
    const notesFile = `ppt/notesSlides/notesSlide${slideNum}.xml`;
    const notesRelsFile = `ppt/notesSlides/_rels/notesSlide${slideNum}.xml.rels`;

    // Write notes slide
    zip.file(notesFile, buildNotesSlideXml(note));
    zip.file(notesRelsFile, buildNotesSlideRelsXml(slideNum));

    // Wire notes slide into the slide's rels file
    let slideRelsXml: string = (await zip.file(slideRelsFile)?.async('string')) ??
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>';
    if (!slideRelsXml.includes('notesSlide')) {
      const notesRelXml = `<Relationship Id="rIdNotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${slideNum}.xml"/>`;
      slideRelsXml = slideRelsXml.includes('</Relationships>')
        ? slideRelsXml.replace('</Relationships>', `  ${notesRelXml}\n</Relationships>`)
        : slideRelsXml.replace('/>', `>\n  ${notesRelXml}\n</Relationships>`);
      zip.file(slideRelsFile, slideRelsXml);
    }

    // Register notes slide content type
    const notesPartName = `/ppt/notesSlides/notesSlide${slideNum}.xml`;
    if (!contentTypesXml.includes(notesPartName)) {
      contentTypesXml = contentTypesXml.replace(
        '</Types>',
        `  <Override PartName="${notesPartName}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>\n</Types>`
      );
    }

    modified = true;
  }

  if (!modified) { return; }

  // Register notes master content type and presentation relationship if we just created it
  if (!hasMaster) {
    const masterPartName = '/ppt/notesMasters/notesMaster1.xml';
    if (!contentTypesXml.includes(masterPartName)) {
      contentTypesXml = contentTypesXml.replace(
        '</Types>',
        `  <Override PartName="${masterPartName}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>\n</Types>`
      );
    }
    if (!presRelsUpdated.includes('notesMaster')) {
      presRelsUpdated = presRelsUpdated.replace(
        '</Relationships>',
        `  <Relationship Id="rIdNM1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="notesMasters/notesMaster1.xml"/>\n</Relationships>`
      );
      zip.file('ppt/_rels/presentation.xml.rels', presRelsUpdated);
    }
  }

  zip.file('[Content_Types].xml', contentTypesXml);

  const output = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(pptxPath, output);
}

export function deactivate(): void {
  if (previewManager) { previewManager.dispose(); previewManager = undefined; }
  if (configManager) { configManager.dispose(); configManager = undefined; }
  cacheManager = undefined;
  documentParser = undefined;
}
