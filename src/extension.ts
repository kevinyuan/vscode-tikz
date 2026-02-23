import * as vscode from 'vscode';
import { DocumentParser } from './core/DocumentParser';
import { CacheManager } from './core/CacheManager';
import { ConfigurationManager } from './config/ConfigurationManager';
import { PreviewManager } from './preview/PreviewManager';
import { generateHash } from './utils/hash';

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

  return {
    extendMarkdownIt(md: any) {
      outputChannel.appendLine('extendMarkdownIt called — registering tikz fence renderer');

      const defaultFence = md.renderer.rules.fence ||
        function (tokens: any, idx: any, options: any, _env: any, self: any) {
          return self.renderToken(tokens, idx, options);
        };

      md.renderer.rules.fence = (tokens: any, idx: any, options: any, env: any, self: any) => {
        const token = tokens[idx];
        const info = (token.info || '').trim().toLowerCase();

        if (info === 'tikz') {
          const source = token.content;
          const hash = generateHash(source.trim());
          const result = previewManager?.getSvg(hash);
          outputChannel.appendLine(`[md-it] content length=${source.length} trimmed length=${source.trim().length} hash=${hash.slice(0, 8)}`);
          outputChannel.appendLine(`[md-it] first 80 chars: ${JSON.stringify(source.trim().slice(0, 80))}`);

          if (result?.svg) {
            outputChannel.appendLine(`[render] hash=${hash.slice(0, 8)} → cached SVG`);
            return `<div class="tikz-diagram">${result.svg}</div>\n`;
          } else if (result?.error) {
            outputChannel.appendLine(`[render] hash=${hash.slice(0, 8)} → error: ${result.error.slice(0, 80)}`);
            const escaped = escapeHtml(result.error);
            return `<div class="tikz-diagram tikz-error"><div class="tikz-error-title">⚠ Rendering Error</div><pre class="tikz-error-message">${escaped}</pre></div>\n`;
          } else {
            outputChannel.appendLine(`[render] hash=${hash.slice(0, 8)} → not cached, triggering background render`);
            scheduleBackgroundRender();
            return `<div class="tikz-diagram tikz-loading"><span class="tikz-spinner"></span> Rendering TikZ diagram…</div>\n`;
          }
        }

        return defaultFence(tokens, idx, options, env, self);
      };

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
    })
  );
}

function registerEventHandlers(context: vscode.ExtensionContext): void {
  // Track active markdown document
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document.languageId === 'markdown') {
        lastMarkdownDocument = editor.document;
      }
    })
  );

  // Watch for document changes — trigger background rendering
  let debounceTimer: NodeJS.Timeout | undefined;
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId !== 'markdown' || !previewManager) { return; }
      lastMarkdownDocument = event.document;
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

export function deactivate(): void {
  if (previewManager) { previewManager.dispose(); previewManager = undefined; }
  if (configManager) { configManager.dispose(); configManager = undefined; }
  cacheManager = undefined;
  documentParser = undefined;
}
