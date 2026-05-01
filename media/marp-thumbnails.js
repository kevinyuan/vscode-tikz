// Injected into VS Code's markdown preview via markdown.previewScripts.
// Detects Marp slides and creates a thumbnail sidebar on the left.
// Uses CSS transform:scale() on cloned section HTML.
(function () {
    'use strict';

    var SIDEBAR_WIDTHS = { small: 172, big: 232, outline: 232 };
    var SLIDE_W = 1280;
    var SLIDE_H = 720;
    var sidebar = null;
    var toggle = null;
    var toolbar = null;
    var SIDEBAR_VISIBLE_KEY = 'marpSidebarVisible';
    var SIDEBAR_MODE_KEY    = 'marpSidebarMode';
    var NOTES_VISIBLE_KEY   = 'marpNotesVisible';
    var NOTES_HEIGHT_KEY    = 'marpNotesHeight';

    function ssGet(key) { try { return sessionStorage.getItem(key); } catch (e) { return null; } }
    function ssSet(key, val) { try { sessionStorage.setItem(key, String(val)); } catch (e) {} }

    var isVisible   = ssGet(SIDEBAR_VISIBLE_KEY) === 'true';
    var viewMode    = ssGet(SIDEBAR_MODE_KEY) || 'small'; // 'small' | 'big' | 'outline'
    var styleEl     = null;
    var notesPanel  = null;
    var notesVisible = ssGet(NOTES_VISIBLE_KEY) === 'true';
    var notesBtn    = null;
    var notesHeight = (function () {
        var v = parseInt(ssGet(NOTES_HEIGHT_KEY), 10); return (v > 0) ? v : 150;
    })();
    var currentSlideIdx = 0;
    var slideLineNumbers = []; // Source line numbers for each slide (injected by extension)
    var observer = null;       // MutationObserver instance (module-scoped so injectDataLineMarkers can pause it)

    // Key CSS properties to copy from computed styles
    var STYLE_PROPS = [
        'color', 'backgroundColor', 'backgroundImage', 'backgroundSize',
        'backgroundPosition', 'backgroundRepeat',
        'fontSize', 'fontFamily', 'fontWeight', 'fontStyle',
        'lineHeight', 'textAlign', 'letterSpacing', 'wordSpacing', 'textDecoration',
        'margin', 'padding',
        'display', 'flexDirection', 'flexWrap', 'justifyContent', 'alignItems', 'alignContent',
        'gridTemplateColumns', 'gridTemplateRows', 'gridTemplateAreas',
        'gridAutoColumns', 'gridAutoRows', 'gridAutoFlow',
        'gridColumn', 'gridRow', 'gridArea',
        'gap', 'columnGap', 'rowGap',
        'columnCount', 'columnWidth',
        'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
        'borderTop', 'borderBottom', 'borderLeft', 'borderRight',
        'borderCollapse', 'borderSpacing',
        'listStyleType', 'listStylePosition',
        'verticalAlign', 'whiteSpace', 'overflow',
        'opacity',
    ];

    /** Smooth-scroll to an element with a fixed duration regardless of distance. */
    var SCROLL_DURATION = 350; // ms
    function smoothScrollTo(element, container, block) {
        var scrollParent = container || document.scrollingElement || document.documentElement;
        var elRect = element.getBoundingClientRect();
        var parentRect = container ? container.getBoundingClientRect() : { top: 0, height: scrollParent.clientHeight };
        var startY = scrollParent.scrollTop;
        var relTop = elRect.top - parentRect.top + startY;
        var relBottom = relTop + elRect.height;
        var viewH = container ? container.clientHeight : scrollParent.clientHeight;
        var targetY;
        if (block === 'center') {
            targetY = relTop - (viewH - elRect.height) / 2;
        } else if (block === 'nearest') {
            // Account for sticky toolbar at the top of sidebar
            var topOffset = 0;
            if (container && toolbar && container.contains(toolbar)) {
                topOffset = toolbar.offsetHeight + 6; // toolbar height + margin
            }
            var visTop = startY + topOffset;
            var visBottom = startY + viewH;
            if (relTop >= visTop && relBottom <= visBottom) { return; }
            if (relTop < visTop) {
                targetY = relTop - topOffset;
            } else {
                targetY = relBottom - viewH;
            }
        } else {
            targetY = relTop;
        }
        targetY = Math.max(0, Math.min(targetY, scrollParent.scrollHeight - viewH));
        var distance = targetY - startY;
        if (Math.abs(distance) < 1) { return; }
        var startTime = null;
        function step(ts) {
            if (!startTime) { startTime = ts; }
            var elapsed = ts - startTime;
            var t = Math.min(elapsed / SCROLL_DURATION, 1);
            // ease-in-out cubic
            var ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
            scrollParent.scrollTop = startY + distance * ease;
            if (t < 1) { requestAnimationFrame(step); }
        }
        requestAnimationFrame(step);
    }

    /** Recursively copy computed styles from orig element tree to clone tree */
    function copyStyles(orig, clone, maxDepth) {
        if (maxDepth <= 0) return;
        var origEls = orig.children;
        var cloneEls = clone.children;
        for (var i = 0; i < origEls.length && i < cloneEls.length; i++) {
            var oe = origEls[i];
            var ce = cloneEls[i];
            if (ce.nodeType !== 1) continue;
            var cs = window.getComputedStyle(oe);
            for (var j = 0; j < STYLE_PROPS.length; j++) {
                var prop = STYLE_PROPS[j];
                var val = cs[prop];
                if (val && val !== '' && val !== 'none' && val !== 'normal' && val !== 'auto') {
                    ce.style[prop] = val;
                }
            }
            // Always copy these even if "none"/"auto"
            ce.style.display = cs.display;
            ce.style.color = cs.color;
            ce.style.backgroundColor = cs.backgroundColor;
            // Recurse into children
            if (oe.children.length > 0) {
                copyStyles(oe, ce, maxDepth - 1);
            }
        }
    }

    function injectStyles() {
        if (styleEl && styleEl.parentNode) { styleEl.parentNode.removeChild(styleEl); }
        styleEl = document.createElement('style');
        styleEl.textContent = [
            '#marp-thumb-sidebar {',
            '  position: fixed; top: 0; left: 0; height: 100vh;',
            '  overflow-y: auto; overflow-x: hidden; padding: 0 12px 8px;',
            '  box-sizing: border-box; background: var(--vscode-sideBar-background, rgba(37,37,38,0.97));',
            '  border-right: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));',
            '  z-index: 10000; scrollbar-width: thin;',
            '}',
            '#marp-thumb-sidebar.collapsed { display: none; }',
            '#marp-thumb-toggle {',
            '  position: fixed; top: 8px; left: 8px;',
            '  width: 28px; height: 28px; display: flex;',
            '  align-items: center; justify-content: center;',
            '  cursor: pointer; z-index: 10001;',
            '  background: var(--vscode-button-secondaryBackground, rgba(58,61,65,0.9));',
            '  color: var(--vscode-button-secondaryForeground, #ccc);',
            '  border-radius: 4px; font-size: 12px;',
            '  opacity: 0.7; transition: opacity 0.15s; user-select: none;',
            '}',
            '#marp-thumb-toggle:hover { opacity: 1; }',
            /* Toolbar */
            '#marp-thumb-toolbar {',
            '  position: sticky; top: 0; z-index: 3;',
            '  display: flex; gap: 2px; padding: 6px 0;',
            '  background: var(--vscode-sideBar-background, rgba(37,37,38,0.97));',
            '  border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));',
            '  margin-bottom: 6px;',
            '}',
            '#marp-thumb-toolbar .marp-toolbar-spacer { flex: 1; }',
            '.marp-toolbar-btn {',
            '  flex: 0 0 24px; display: flex; align-items: center; justify-content: center;',
            '  height: 24px; border: none; border-radius: 3px; cursor: pointer;',
            '  background: transparent;',
            '  color: var(--vscode-foreground, #ccc); opacity: 0.6;',
            '  font-size: 13px; line-height: 1; transition: opacity 0.15s, background 0.15s;',
            '}',
            '.marp-toolbar-btn:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.15)); }',
            '.marp-toolbar-btn.active { opacity: 1; background: var(--vscode-toolbar-activeBackground, rgba(128,128,128,0.25)); }',
            /* Thumbnails */
            '.marp-thumb {',
            '  position: relative; cursor: pointer; margin-bottom: 6px;',
            '  border-radius: 3px; overflow: hidden;',
            '  border: 2px solid transparent; transition: border-color 0.15s;',
            '}',
            '.marp-thumb:hover { border-color: var(--vscode-focusBorder, #007fd4); }',
            '.marp-thumb.active { border-color: var(--vscode-focusBorder, #007fd4); }',
            '.marp-thumb-num {',
            '  position: absolute; top: 2px; left: 4px;',
            '  font-size: 9px; font-weight: bold; color: #fff;',
            '  background: rgba(0,0,0,0.55); border-radius: 2px;',
            '  padding: 0 3px; z-index: 2; line-height: 1.5;',
            '  font-family: system-ui, sans-serif;',
            '}',
            '.marp-thumb-viewport {',
            '  overflow: hidden; position: relative;',
            '}',
            '.marp-thumb-slide {',
            '  position: absolute; top: 0; left: 0;',
            '  width: ' + SLIDE_W + 'px; height: ' + SLIDE_H + 'px;',
            '  overflow: hidden; box-sizing: border-box;',
            '  transform-origin: 0 0;',
            '}',
            /* Outline mode */
            '.marp-outline-item {',
            '  cursor: pointer; padding: 4px 6px; border-radius: 3px;',
            '  font-family: var(--vscode-font-family, system-ui, sans-serif);',
            '  font-size: 12px; line-height: 1.6;',
            '  color: var(--vscode-foreground, #ccc);',
            '  display: flex; align-items: baseline; gap: 6px;',
            '  transition: background 0.1s;',
            '}',
            '.marp-outline-item:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.15)); }',
            '.marp-outline-item.active { background: var(--vscode-list-activeSelectionBackground, rgba(4,57,94,0.6)); color: var(--vscode-list-activeSelectionForeground, #fff); }',
            '.marp-outline-num { opacity: 0.5; font-size: 11px; min-width: 16px; }',
            '.marp-outline-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
            /* Speaker notes panel */
            '#marp-notes-panel {',
            '  position: fixed; bottom: 0; left: 0; right: 0;',
            '  display: flex; flex-direction: column;',
            '  background: var(--vscode-panel-background, var(--vscode-sideBar-background, rgba(37,37,38,0.97)));',
            '  border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));',
            '  z-index: 10000; box-sizing: border-box;',
            '  font-family: var(--vscode-font-family, system-ui, sans-serif);',
            '  font-size: 13px; line-height: 1.5;',
            '  color: var(--vscode-foreground, #ccc);',
            '}',
            '#marp-notes-panel.collapsed { display: none; }',
            /* Drag handle sits at the very top, never scrolls */
            '#marp-notes-resize-handle {',
            '  flex-shrink: 0; height: 5px; cursor: ns-resize;',
            '  background: transparent; transition: background 0.15s;',
            '}',
            '#marp-notes-resize-handle:hover, #marp-notes-resize-handle.dragging {',
            '  background: var(--vscode-focusBorder, #007fd4);',
            '}',
            /* Scrollable inner area */
            '#marp-notes-inner {',
            '  flex: 1; overflow-y: auto; padding: 4px 16px 8px;',
            '  box-sizing: border-box; scrollbar-width: thin;',
            '}',
            '#marp-notes-header {',
            '  font-size: 11px; font-weight: bold; opacity: 0.5;',
            '  margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;',
            '}',
            '#marp-notes-content { line-height: 1.6; }',
            '#marp-notes-content p { margin: 0 0 0.5em; }',
            '#marp-notes-content p:last-child { margin-bottom: 0; }',
            '#marp-notes-content h1, #marp-notes-content h2, #marp-notes-content h3 {',
            '  margin: 0.6em 0 0.3em; font-size: 1em; font-weight: bold;',
            '}',
            '#marp-notes-content h1 { font-size: 1.15em; }',
            '#marp-notes-content h2 { font-size: 1.07em; }',
            '#marp-notes-content code {',
            '  font-family: var(--vscode-editor-font-family, monospace);',
            '  background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.2));',
            '  border-radius: 3px; padding: 0 3px; font-size: 0.9em;',
            '}',
            '#marp-notes-content pre {',
            '  background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.2));',
            '  border-radius: 4px; padding: 8px 10px; overflow-x: auto;',
            '  margin: 0.4em 0; font-size: 0.88em;',
            '}',
            '#marp-notes-content pre code { background: none; padding: 0; }',
            '#marp-notes-content ul, #marp-notes-content ol {',
            '  margin: 0.3em 0; padding-left: 1.4em;',
            '}',
            '#marp-notes-content li { margin: 0.1em 0; }',
            '#marp-notes-content table {',
            '  border-collapse: collapse; margin: 0.5em 0;',
            '  font-size: 0.93em; width: 100%;',
            '}',
            '#marp-notes-content th, #marp-notes-content td {',
            '  border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.4));',
            '  padding: 3px 8px; text-align: left;',
            '}',
            '#marp-notes-content th {',
            '  background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.15));',
            '  font-weight: bold;',
            '}',
            '#marp-notes-content a { color: var(--vscode-textLink-foreground, #4da3ff); }',
            '#marp-notes-content hr {',
            '  border: none; border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));',
            '  margin: 0.6em 0;',
            '}',
            '#marp-notes-content:empty::after {',
            '  content: "No speaker notes for this slide.";',
            '  opacity: 0.4; font-style: italic;',
            '}',
        ].join('\n');
        document.head.appendChild(styleEl);
    }

    function getSidebarWidth() { return SIDEBAR_WIDTHS[viewMode] || SIDEBAR_WIDTHS.small; }

    function applySidebarLayout() {
        var w = getSidebarWidth();
        if (sidebar) { sidebar.style.width = w + 'px'; }
        if (isVisible) {
            document.body.style.marginLeft = w + 'px';
            if (notesPanel) { notesPanel.style.left = w + 'px'; }
        }
    }

    function ensureToggle() {
        if (toggle && document.body.contains(toggle)) { return; }
        toggle = document.createElement('div');
        toggle.id = 'marp-thumb-toggle';
        toggle.title = 'Toggle slide thumbnails';
        // Restore state from isVisible
        toggle.textContent = '\u2630';
        toggle.style.display = isVisible ? 'none' : 'flex';
        toggle.addEventListener('click', function () {
            isVisible = true;
            ssSet(SIDEBAR_VISIBLE_KEY, 'true');
            if (sidebar) { sidebar.classList.remove('collapsed'); }
            toggle.style.display = 'none';
            document.body.style.marginLeft = getSidebarWidth() + 'px';
            if (notesPanel) { notesPanel.style.left = getSidebarWidth() + 'px'; }
        });
        document.body.appendChild(toggle);
    }

    function createSidebar() {
        if (sidebar && document.body.contains(sidebar)) { return sidebar; }
        sidebar = document.createElement('div');
        sidebar.id = 'marp-thumb-sidebar';
        if (!isVisible) { sidebar.classList.add('collapsed'); }
        sidebar.style.width = getSidebarWidth() + 'px';
        document.body.appendChild(sidebar);
        // Restore body margin if visible
        document.body.style.marginLeft = isVisible ? getSidebarWidth() + 'px' : '0';
        return sidebar;
    }

    function ensureToolbar(sb) {
        if (toolbar && sb.contains(toolbar)) { return; }
        toolbar = document.createElement('div');
        toolbar.id = 'marp-thumb-toolbar';

        var modes = [
            { id: 'small',   title: 'Small thumbnails', svg: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8"/></svg>' },
            { id: 'big',     title: 'Large thumbnails', svg: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="1" width="12" height="12"/></svg>' },
            { id: 'outline', title: 'Outline',          svg: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="1" y1="3.5" x2="13" y2="3.5"/><line x1="1" y1="7" x2="13" y2="7"/><line x1="1" y1="10.5" x2="13" y2="10.5"/></svg>' },
        ];
        modes.forEach(function (m) {
            var btn = document.createElement('button');
            btn.className = 'marp-toolbar-btn' + (viewMode === m.id ? ' active' : '');
            btn.innerHTML = m.svg;
            btn.title = m.title;
            btn.dataset.mode = m.id;
            btn.addEventListener('click', function () {
                if (viewMode === m.id) { return; }
                viewMode = m.id;
                ssSet(SIDEBAR_MODE_KEY, viewMode);
                var btns = toolbar.querySelectorAll('.marp-toolbar-btn[data-mode]');
                for (var j = 0; j < btns.length; j++) { btns[j].classList.toggle('active', btns[j].dataset.mode === m.id); }
                applySidebarLayout();
                rebuildContent();
            });
            toolbar.appendChild(btn);
        });

        // Speaker notes toggle button
        notesBtn = document.createElement('button');
        notesBtn.className = 'marp-toolbar-btn' + (notesVisible ? ' active' : '');
        notesBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="13" x2="21" y2="13"/></svg>';
        notesBtn.title = 'Speaker notes';
        notesBtn.addEventListener('click', function () {
            notesVisible = !notesVisible;
            ssSet(NOTES_VISIBLE_KEY, notesVisible);
            notesBtn.classList.toggle('active', notesVisible);
            if (notesPanel) { notesPanel.classList.toggle('collapsed', !notesVisible); }
            document.body.style.marginBottom = notesVisible ? notesHeight + 'px' : '0';
            if (notesVisible) {
                updateNotesContent();
                // Re-detect with new viewport size (notes panel changes visible area)
                detectAndHighlight();
            }
        });
        toolbar.appendChild(notesBtn);

        // Spacer pushes close button to the right
        var spacer = document.createElement('div');
        spacer.className = 'marp-toolbar-spacer';
        toolbar.appendChild(spacer);

        // Close button
        var closeBtn = document.createElement('button');
        closeBtn.className = 'marp-toolbar-btn';
        closeBtn.textContent = '\u2715';
        closeBtn.title = 'Close panel';
        closeBtn.addEventListener('click', function () {
            isVisible = false;
            ssSet(SIDEBAR_VISIBLE_KEY, 'false');
            if (sidebar) { sidebar.classList.add('collapsed'); }
            if (toggle) { toggle.style.display = 'flex'; }
            document.body.style.marginLeft = '0';
            if (notesPanel) { notesPanel.style.left = '0'; }
        });
        toolbar.appendChild(closeBtn);

        sb.insertBefore(toolbar, sb.firstChild);
    }

    var cachedSlides = null;

    function rebuildContent() {
        if (!sidebar || !cachedSlides || cachedSlides.length === 0) { return; }
        // Remove old content but keep toolbar
        var children = sidebar.children;
        for (var i = children.length - 1; i >= 0; i--) {
            if (children[i] !== toolbar) { sidebar.removeChild(children[i]); }
        }

        if (viewMode === 'outline') {
            buildOutline(cachedSlides, sidebar);
        } else {
            buildThumbContent(cachedSlides, sidebar);
        }
        // Scroll active thumbnail into view after rebuild
        var selector = viewMode === 'outline' ? '.marp-outline-item' : '.marp-thumb';
        var items = sidebar ? sidebar.querySelectorAll(selector) : [];
        if (items[currentSlideIdx]) {
            setTimeout(function () { smoothScrollTo(items[currentSlideIdx], sidebar, 'nearest'); }, 50);
        }
    }

    function ensureMarpUI() {
        // Show toggle as soon as any Marp content exists, even before SVGs render
        if (document.querySelector('svg[data-marpit-svg], .marpit, [data-marpit-svg]')) {
            injectStyles();
            ensureToggle();
            return true;
        }
        return false;
    }

    function buildThumbnails() {
        ensureMarpUI();

        var slides = document.querySelectorAll('svg[data-marpit-svg]');
        if (slides.length === 0) { return; }

        injectStyles();
        ensureToggle();
        var sb = createSidebar();
        ensureToolbar(sb);
        ensureNotesPanel();

        var slideCount = slides.length;
        // Always update cachedSlides to current DOM elements (old refs become detached on refresh)
        cachedSlides = slides;
        // Check if content count and mode match
        var contentCount = sb.children.length - 1;
        if (sb.dataset.slideCount === String(slideCount) && sb.dataset.viewMode === viewMode && contentCount === slideCount) {
            return;
        }
        sb.dataset.slideCount = String(slideCount);
        sb.dataset.viewMode = viewMode;
        loadNotesData();
        loadSlideLineNumbers();
        injectDataLineMarkers(slides);
        rebuildContent();
    }

    function buildThumbContent(slides, sb) {
        var isLarge = (viewMode === 'big');
        var thumbW = isLarge ? 196 : 136;
        var thumbH = Math.round(thumbW * SLIDE_H / SLIDE_W * 10) / 10;
        var scale = thumbW / SLIDE_W;

        slides.forEach(function (slide, i) {
            var thumb = document.createElement('div');
            thumb.className = 'marp-thumb' + (i === currentSlideIdx ? ' active' : '');
            thumb.title = 'Slide ' + (i + 1);

            var numBadge = document.createElement('div');
            numBadge.className = 'marp-thumb-num';
            numBadge.textContent = String(i + 1);

            var origSection = slide.querySelector('foreignObject > section');
            if (!origSection) {
                thumb.appendChild(numBadge);
                sb.appendChild(thumb);
                return;
            }

            var cs = window.getComputedStyle(origSection);

            var slideDiv = document.createElement('div');
            slideDiv.className = 'marp-thumb-slide';
            slideDiv.style.transform = 'scale(' + scale + ')';

            slideDiv.style.backgroundColor = cs.backgroundColor;
            slideDiv.style.backgroundImage = cs.backgroundImage;
            slideDiv.style.backgroundSize = cs.backgroundSize;
            slideDiv.style.backgroundPosition = cs.backgroundPosition;
            slideDiv.style.backgroundRepeat = cs.backgroundRepeat;
            slideDiv.style.color = cs.color;
            slideDiv.style.fontFamily = cs.fontFamily;
            slideDiv.style.fontSize = cs.fontSize;
            slideDiv.style.lineHeight = cs.lineHeight;
            slideDiv.style.padding = cs.padding;
            slideDiv.style.display = cs.display;
            slideDiv.style.flexDirection = cs.flexDirection;
            slideDiv.style.flexWrap = cs.flexWrap;
            slideDiv.style.justifyContent = cs.justifyContent;
            slideDiv.style.alignItems = cs.alignItems;
            slideDiv.style.alignContent = cs.alignContent;
            slideDiv.style.textAlign = cs.textAlign;
            slideDiv.style.letterSpacing = cs.letterSpacing;
            slideDiv.style.wordSpacing = cs.wordSpacing;
            // CSS Grid — needed for multi-column Marp layouts
            slideDiv.style.gridTemplateColumns = cs.gridTemplateColumns;
            slideDiv.style.gridTemplateRows = cs.gridTemplateRows;
            slideDiv.style.gridTemplateAreas = cs.gridTemplateAreas;
            slideDiv.style.gap = cs.gap;
            slideDiv.style.columnGap = cs.columnGap;
            slideDiv.style.rowGap = cs.rowGap;
            // CSS Columns
            slideDiv.style.columnCount = cs.columnCount;
            slideDiv.style.columnWidth = cs.columnWidth;

            // cloneNode preserves SVG namespaces (innerHTML round-trip can corrupt them)
            var children = origSection.childNodes;
            for (var ci = 0; ci < children.length; ci++) {
                slideDiv.appendChild(children[ci].cloneNode(true));
            }
            copyStyles(origSection, slideDiv, 10);

            var viewport = document.createElement('div');
            viewport.className = 'marp-thumb-viewport';
            viewport.style.width = thumbW + 'px';
            viewport.style.height = thumbH + 'px';
            viewport.appendChild(slideDiv);

            thumb.appendChild(numBadge);
            thumb.appendChild(viewport);

            thumb.addEventListener('click', (function (targetSlide, targetThumb, idx) {
                return function () {
                    smoothScrollTo(targetSlide, null, 'center');
                    var all = sb.querySelectorAll('.marp-thumb');
                    for (var j = 0; j < all.length; j++) { all[j].classList.remove('active'); }
                    targetThumb.classList.add('active');
                    currentSlideIdx = idx;
                    updateNotesContent();
                };
            })(slide, thumb, i));

            sb.appendChild(thumb);
        });

        setupScrollTracking();
    }

    function buildOutline(slides, sb) {
        slides.forEach(function (slide, i) {
            var item = document.createElement('div');
            item.className = 'marp-outline-item' + (i === currentSlideIdx ? ' active' : '');

            var num = document.createElement('span');
            num.className = 'marp-outline-num';
            num.textContent = String(i + 1);

            var origSection = slide.querySelector('foreignObject > section');
            var heading = '';
            var cssClass = '';
            if (origSection) {
                // Extract heading
                var h = origSection.querySelector('h1, h2, h3, h4, h5, h6');
                if (h) { heading = h.textContent.trim(); }
                // Extract class
                cssClass = origSection.getAttribute('class') || '';
            }

            var displayText = heading || 'Slide ' + (i + 1);

            var label = document.createElement('span');
            label.className = 'marp-outline-label';
            label.textContent = displayText;

            item.title = displayText;
            item.appendChild(num);
            item.appendChild(label);

            item.addEventListener('click', (function (targetSlide, targetItem, idx) {
                return function () {
                    smoothScrollTo(targetSlide, null, 'center');
                    var all = sb.querySelectorAll('.marp-outline-item');
                    for (var j = 0; j < all.length; j++) { all[j].classList.remove('active'); }
                    targetItem.classList.add('active');
                    currentSlideIdx = idx;
                    updateNotesContent();
                };
            })(slide, item, i));

            sb.appendChild(item);
        });

        setupScrollTracking();
    }

    var trackingScrollListener = null;
    var trackingDebounceTimer = null;

    /** Detect current slide by visible area, update thumbnail/outline active + notes. */
    function detectAndHighlight() {
        if (!cachedSlides || cachedSlides.length === 0) { return; }
        var viewH = window.innerHeight;
        var notesH = notesVisible ? notesHeight : 0;
        var visibleH = viewH - notesH;
        var bestIdx = currentSlideIdx;
        var bestOverlap = 0;
        for (var i = 0; i < cachedSlides.length; i++) {
            var rect = cachedSlides[i].getBoundingClientRect();
            var top = Math.max(rect.top, 0);
            var bottom = Math.min(rect.bottom, visibleH);
            var overlap = Math.max(0, bottom - top);
            if (overlap > bestOverlap) {
                bestOverlap = overlap;
                bestIdx = i;
            }
        }
        if (bestIdx !== currentSlideIdx) {
            currentSlideIdx = bestIdx;
            // Update sidebar highlight
            var selector = viewMode === 'outline' ? '.marp-outline-item' : '.marp-thumb';
            var items = sidebar ? sidebar.querySelectorAll(selector) : [];
            for (var j = 0; j < items.length; j++) { items[j].classList.remove('active'); }
            if (items[bestIdx]) {
                items[bestIdx].classList.add('active');
                smoothScrollTo(items[bestIdx], sidebar, 'nearest');
            }
            updateNotesContent();
        }
    }

    function onTrackingScroll() {
        clearTimeout(trackingDebounceTimer);
        trackingDebounceTimer = setTimeout(detectAndHighlight, 150);
    }

    function setupScrollTracking() {
        if (trackingScrollListener) { return; }
        trackingScrollListener = onTrackingScroll;
        window.addEventListener('scroll', trackingScrollListener, { passive: true });
        // Initial detection
        setTimeout(detectAndHighlight, 100);
    }

    function ensureNotesPanel() {
        if (notesPanel && document.body.contains(notesPanel)) { return; }
        notesPanel = document.createElement('div');
        notesPanel.id = 'marp-notes-panel';
        notesPanel.style.height = notesHeight + 'px';
        if (!notesVisible) { notesPanel.classList.add('collapsed'); }

        // Drag-to-resize handle at the top edge
        var resizeHandle = document.createElement('div');
        resizeHandle.id = 'marp-notes-resize-handle';
        resizeHandle.addEventListener('mousedown', function (e) {
            e.preventDefault();
            var startY = e.clientY;
            var startH = notesHeight;
            resizeHandle.classList.add('dragging');

            function onMove(e) {
                var newH = Math.round(Math.max(60, Math.min(window.innerHeight * 0.7, startH + startY - e.clientY)));
                if (newH === notesHeight) { return; }
                notesHeight = newH;
                ssSet(NOTES_HEIGHT_KEY, notesHeight);
                notesPanel.style.height = notesHeight + 'px';
                document.body.style.marginBottom = notesHeight + 'px';
                detectAndHighlight();
            }
            function onUp() {
                resizeHandle.classList.remove('dragging');
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        var inner = document.createElement('div');
        inner.id = 'marp-notes-inner';
        var header = document.createElement('div');
        header.id = 'marp-notes-header';
        header.textContent = 'Speaker Notes';
        var content = document.createElement('div');
        content.id = 'marp-notes-content';
        inner.appendChild(header);
        inner.appendChild(content);
        notesPanel.appendChild(resizeHandle);
        notesPanel.appendChild(inner);
        document.body.appendChild(notesPanel);
        // Adjust left margin to match sidebar
        if (isVisible) { notesPanel.style.left = getSidebarWidth() + 'px'; }
        if (notesVisible) {
            document.body.style.marginBottom = notesHeight + 'px';
        }
    }

    var slideNotesData = []; // Populated from extension's injected JSON

    /** Load speaker notes from data attribute injected by extension */
    function loadNotesData() {
        var el = document.querySelector('[data-marp-slide-notes]');
        if (!el) { return; }
        try {
            slideNotesData = JSON.parse(el.getAttribute('data-marp-slide-notes'));
        } catch (e) {
            slideNotesData = [];
        }
    }

    /** Load slide source line numbers from data attribute injected by extension */
    function loadSlideLineNumbers() {
        var el = document.querySelector('[data-marp-slide-lines]');
        if (!el) { return; }
        try {
            slideLineNumbers = JSON.parse(el.getAttribute('data-marp-slide-lines'));
        } catch (e) {
            slideLineNumbers = [];
        }
    }

    /**
     * Inject zero-height data-line markers before each slide SVG so VS Code's
     * built-in preview→editor scroll-sync can map the preview position to the
     * correct --- separator line in the source.
     * Temporarily disconnects the MutationObserver to avoid a rebuild loop.
     */
    function injectDataLineMarkers(slides) {
        if (observer) { observer.disconnect(); }
        try {
            var stale = document.querySelectorAll('.marp-line-marker');
            for (var i = 0; i < stale.length; i++) {
                if (stale[i].parentNode) { stale[i].parentNode.removeChild(stale[i]); }
            }
            if (slideLineNumbers.length > 0) {
                for (var si = 0; si < slides.length; si++) {
                    var lineNo = slideLineNumbers[si];
                    if (lineNo === undefined || !slides[si].parentNode) { continue; }
                    var marker = document.createElement('div');
                    marker.className = 'marp-line-marker';
                    marker.setAttribute('data-line', String(lineNo));
                    // Must remain in flow (not display:none) so VS Code can measure vertical position.
                    marker.style.cssText = 'height:0;overflow:hidden;margin:0;padding:0;border:none;line-height:0;';
                    slides[si].parentNode.insertBefore(marker, slides[si]);
                }
            }
        } finally {
            if (observer) { observer.observe(document.body, { childList: true, subtree: true }); }
        }
    }

    /** Minimal Markdown \u2192 HTML renderer (bold, italic, code, lists, tables, links, headings). */
    function renderMarkdown(src) {
        if (!src) { return ''; }
        var esc = function (s) {
            return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        };
        var inline = function (s) {
            return s
                .replace(/`([^`]+)`/g, function (_, c) { return '<code>' + esc(c) + '</code>'; })
                .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/__(.+?)__/g, '<strong>$1</strong>')
                .replace(/\*(.+?)\*/g, '<em>$1</em>')
                .replace(/_(.+?)_/g, '<em>$1</em>')
                .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
        };
        var lines = src.split('\n');
        var out = [];
        var i = 0;
        var flushPara = function (buf) {
            if (buf.length) { out.push('<p>' + inline(esc(buf.join(' '))) + '</p>'); }
            return [];
        };
        var para = [];
        while (i < lines.length) {
            var line = lines[i];
            if (/^```/.test(line)) {
                para = flushPara(para);
                var lang = line.slice(3).trim();
                var codeLines = [];
                i++;
                while (i < lines.length && !/^```/.test(lines[i])) { codeLines.push(esc(lines[i])); i++; }
                out.push('<pre><code' + (lang ? ' class="language-' + esc(lang) + '"' : '') + '>' + codeLines.join('\n') + '</code></pre>');
                i++;
                continue;
            }
            var hm = line.match(/^(#{1,3})\s+(.*)/);
            if (hm) {
                para = flushPara(para);
                var level = hm[1].length;
                out.push('<h' + level + '>' + inline(esc(hm[2])) + '</h' + level + '>');
                i++; continue;
            }
            if (/^(?:---+|___+|\*\*\*+)\s*$/.test(line)) {
                para = flushPara(para);
                out.push('<hr>');
                i++; continue;
            }
            if (/^[-*+]\s/.test(line)) {
                para = flushPara(para);
                var ulItems = [];
                while (i < lines.length && /^[-*+]\s/.test(lines[i])) {
                    ulItems.push('<li>' + inline(esc(lines[i].replace(/^[-*+]\s+/, ''))) + '</li>');
                    i++;
                }
                out.push('<ul>' + ulItems.join('') + '</ul>');
                continue;
            }
            if (/^\d+\.\s/.test(line)) {
                para = flushPara(para);
                var olItems = [];
                while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
                    olItems.push('<li>' + inline(esc(lines[i].replace(/^\d+\.\s+/, ''))) + '</li>');
                    i++;
                }
                out.push('<ol>' + olItems.join('') + '</ol>');
                continue;
            }
            if (/^\|/.test(line)) {
                para = flushPara(para);
                var tRows = [];
                while (i < lines.length && /^\|/.test(lines[i])) { tRows.push(lines[i]); i++; }
                var parseRow = function (r, tag) {
                    return '<tr>' + r.replace(/^\||\|$/g, '').split('|').map(function (c) {
                        return '<' + tag + '>' + inline(esc(c.trim())) + '</' + tag + '>';
                    }).join('') + '</tr>';
                };
                var tableHtml = '<table><thead>' + parseRow(tRows[0], 'th') + '</thead>';
                var bodyRows = tRows.slice(2);
                if (bodyRows.length) {
                    tableHtml += '<tbody>' + bodyRows.map(function (r) { return parseRow(r, 'td'); }).join('') + '</tbody>';
                }
                out.push(tableHtml + '</table>');
                continue;
            }
            if (/^\s*$/.test(line)) { para = flushPara(para); i++; continue; }
            para.push(line);
            i++;
        }
        flushPara(para);
        return out.join('\n');
    }

    function updateNotesContent() {
        if (!notesPanel || !notesVisible) { return; }
        if (slideNotesData.length === 0) { loadNotesData(); }
        var header = notesPanel.querySelector('#marp-notes-header');
        var content = notesPanel.querySelector('#marp-notes-content');
        if (header) { header.textContent = 'Speaker Notes \u2014 Slide ' + (currentSlideIdx + 1); }
        if (!content) { return; }
        var rawNote = slideNotesData[currentSlideIdx] || '';
        if (!rawNote) {
            content.innerHTML = '';
        } else {
            try {
                var rendered = renderMarkdown(rawNote);
                content.innerHTML = rendered || '<pre>' + rawNote.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</pre>';
            } catch (e) {
                content.innerHTML = '<pre>' + rawNote.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</pre>';
            }
        }
        notesPanel.style.left = isVisible ? getSidebarWidth() + 'px' : '0';
    }

    var lastToggleSeq = 0;
    function checkToggleSignal() {
        var el = document.querySelector('[data-marp-thumb-toggle]');
        if (!el) { return; }
        var seq = parseInt(el.getAttribute('data-marp-thumb-toggle'), 10);
        if (seq > lastToggleSeq) {
            lastToggleSeq = seq;
            // Apply the desired state (not a relative toggle)
            var desired = el.getAttribute('data-marp-thumb-visible') === 'true';
            if (desired === isVisible) { return; }
            isVisible = desired;
            if (sidebar) { sidebar.classList.toggle('collapsed', !isVisible); }
            if (toggle) { toggle.style.display = isVisible ? 'none' : 'flex'; }
            document.body.style.marginLeft = isVisible ? getSidebarWidth() + 'px' : '0';
        }
    }

    function init() {
        buildThumbnails();
        checkToggleSignal(); // Restore sidebar visibility if webview was recreated
        // Retry a few times in case Marp hasn't rendered SVGs yet
        var retries = [200, 500, 1000, 2000];
        retries.forEach(function (delay) {
            setTimeout(function () { ensureMarpUI(); buildThumbnails(); checkToggleSignal(); }, delay);
        });
        window.addEventListener('vscode.markdown.updateContent', function () {
            // Capture scroll anchor before content is replaced
            var scrollAnchorIdx = currentSlideIdx;
            var scrollAnchorY = window.scrollY;
            // Force full rebuild: slide content may have changed even if count is the same
            if (sidebar) { delete sidebar.dataset.slideCount; }
            setTimeout(function () {
                buildThumbnails();
                checkToggleSignal();
                // After all state logic runs, enforce isVisible onto the DOM.
                if (sidebar && document.body.contains(sidebar)) {
                    sidebar.classList.toggle('collapsed', !isVisible);
                }
                if (toggle && document.body.contains(toggle)) {
                    toggle.style.display = isVisible ? 'none' : 'flex';
                }
                document.body.style.marginLeft = isVisible ? getSidebarWidth() + 'px' : '0';
            }, 0);
            // Restore scroll if VS Code jumped to a different position during refresh.
            // Attempt at multiple delays to beat VS Code's own scroll-sync timing.
            function tryRestoreScroll() {
                if (Math.abs(window.scrollY - scrollAnchorY) > 80) {
                    var allSlides = document.querySelectorAll('svg[data-marpit-svg]');
                    if (allSlides[scrollAnchorIdx]) {
                        allSlides[scrollAnchorIdx].scrollIntoView({ block: 'start', behavior: 'instant' });
                    }
                }
            }
            setTimeout(tryRestoreScroll, 0);
            setTimeout(tryRestoreScroll, 200);
            setTimeout(tryRestoreScroll, 500);
            setTimeout(tryRestoreScroll, 1000);
        });
        var debounceTimer = null;
        observer = new MutationObserver(function (mutations) {
            // Ignore mutations from our own UI elements (sidebar, notes panel, toolbar,
            // toggle) — reacting to self-mutations causes an infinite rebuild loop
            // that makes the thumbnail pane scroll in an endless cycle.
            var hasExternalMutation = mutations.some(function (m) {
                var t = m.target;
                return (!sidebar || !sidebar.contains(t)) &&
                       (!notesPanel || !notesPanel.contains(t)) &&
                       (!toggle || !toggle.contains(t)) &&
                       (!toolbar || !toolbar.contains(t));
            });
            if (!hasExternalMutation) { return; }
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(function () {
                // Force content refresh so tikz SVGs update in thumbnails after rendering
                if (sidebar) { delete sidebar.dataset.slideCount; }
                buildThumbnails();
                checkToggleSignal();
            }, 300);
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 500);
    }
})();
