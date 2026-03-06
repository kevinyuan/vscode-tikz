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
    var isVisible = false;
    var viewMode = 'small'; // 'small' | 'big' | 'outline'
    var scrollObserver = null;
    var styleEl = null;

    // Key CSS properties to copy from computed styles
    var STYLE_PROPS = [
        'color', 'backgroundColor', 'backgroundImage', 'backgroundSize',
        'backgroundPosition', 'backgroundRepeat',
        'fontSize', 'fontFamily', 'fontWeight', 'fontStyle',
        'lineHeight', 'textAlign', 'letterSpacing', 'wordSpacing', 'textDecoration',
        'margin', 'padding',
        'display', 'flexDirection', 'flexWrap', 'justifyContent', 'alignItems',
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
            var visTop = startY;
            var visBottom = startY + viewH;
            if (relTop >= visTop && relBottom <= visBottom) { return; }
            if (relTop < visTop) {
                targetY = relTop;
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
            '  font-size: 13px; transition: opacity 0.15s, background 0.15s;',
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
        ].join('\n');
        document.head.appendChild(styleEl);
    }

    function getSidebarWidth() { return SIDEBAR_WIDTHS[viewMode] || SIDEBAR_WIDTHS.small; }

    function applySidebarLayout() {
        var w = getSidebarWidth();
        if (sidebar) { sidebar.style.width = w + 'px'; }
        if (isVisible) {
            document.body.style.marginLeft = w + 'px';
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
            if (sidebar) { sidebar.classList.remove('collapsed'); }
            toggle.style.display = 'none';
            document.body.style.marginLeft = getSidebarWidth() + 'px';
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
            { id: 'small',   icon: '\u25A6', title: 'Small thumbnails' },
            { id: 'big',     icon: '\u2B1C', title: 'Large thumbnails' },
            { id: 'outline', icon: '\u2261', title: 'Outline' },
        ];
        modes.forEach(function (m) {
            var btn = document.createElement('button');
            btn.className = 'marp-toolbar-btn' + (viewMode === m.id ? ' active' : '');
            btn.textContent = m.icon;
            btn.title = m.title;
            btn.dataset.mode = m.id;
            btn.addEventListener('click', function () {
                if (viewMode === m.id) { return; }
                viewMode = m.id;
                var btns = toolbar.querySelectorAll('.marp-toolbar-btn[data-mode]');
                for (var j = 0; j < btns.length; j++) { btns[j].classList.toggle('active', btns[j].dataset.mode === m.id); }
                applySidebarLayout();
                rebuildContent();
            });
            toolbar.appendChild(btn);
        });

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
            if (sidebar) { sidebar.classList.add('collapsed'); }
            if (toggle) { toggle.style.display = 'flex'; }
            document.body.style.marginLeft = '0';
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
        if (scrollObserver) { scrollObserver.disconnect(); scrollObserver = null; }

        if (viewMode === 'outline') {
            buildOutline(cachedSlides, sidebar);
        } else {
            buildThumbContent(cachedSlides, sidebar);
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

        var slideCount = slides.length;
        // Check if content count and mode match
        var contentCount = sb.children.length - 1;
        if (sb.dataset.slideCount === String(slideCount) && sb.dataset.viewMode === viewMode && contentCount === slideCount) {
            return;
        }
        sb.dataset.slideCount = String(slideCount);
        sb.dataset.viewMode = viewMode;
        cachedSlides = slides;
        rebuildContent();
    }

    function buildThumbContent(slides, sb) {
        var isLarge = (viewMode === 'big');
        var thumbW = isLarge ? 196 : 136;
        var thumbH = Math.round(thumbW * SLIDE_H / SLIDE_W * 10) / 10;
        var scale = thumbW / SLIDE_W;

        slides.forEach(function (slide, i) {
            var thumb = document.createElement('div');
            thumb.className = 'marp-thumb' + (i === 0 ? ' active' : '');
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
            slideDiv.style.textAlign = cs.textAlign;
            slideDiv.style.letterSpacing = cs.letterSpacing;
            slideDiv.style.wordSpacing = cs.wordSpacing;

            slideDiv.innerHTML = origSection.innerHTML;
            copyStyles(origSection, slideDiv, 10);

            var viewport = document.createElement('div');
            viewport.className = 'marp-thumb-viewport';
            viewport.style.width = thumbW + 'px';
            viewport.style.height = thumbH + 'px';
            viewport.appendChild(slideDiv);

            thumb.appendChild(numBadge);
            thumb.appendChild(viewport);

            thumb.addEventListener('click', (function (targetSlide, targetThumb) {
                return function () {
                    smoothScrollTo(targetSlide, null, 'center');
                    var all = sb.querySelectorAll('.marp-thumb');
                    for (var j = 0; j < all.length; j++) { all[j].classList.remove('active'); }
                    targetThumb.classList.add('active');
                };
            })(slide, thumb));

            sb.appendChild(thumb);
        });

        setupScrollTracking(slides, sb);
    }

    function buildOutline(slides, sb) {
        slides.forEach(function (slide, i) {
            var item = document.createElement('div');
            item.className = 'marp-outline-item' + (i === 0 ? ' active' : '');

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

            item.addEventListener('click', (function (targetSlide, targetItem) {
                return function () {
                    smoothScrollTo(targetSlide, null, 'center');
                    var all = sb.querySelectorAll('.marp-outline-item');
                    for (var j = 0; j < all.length; j++) { all[j].classList.remove('active'); }
                    targetItem.classList.add('active');
                };
            })(slide, item));

            sb.appendChild(item);
        });

        setupOutlineScrollTracking(slides, sb);
    }

    function setupOutlineScrollTracking(slides, sb) {
        if (!window.IntersectionObserver) { return; }
        scrollObserver = new IntersectionObserver(function (entries) {
            var bestIdx = -1, bestRatio = 0;
            for (var i = 0; i < entries.length; i++) {
                if (entries[i].isIntersecting && entries[i].intersectionRatio > bestRatio) {
                    bestRatio = entries[i].intersectionRatio;
                    var idx = Array.prototype.indexOf.call(slides, entries[i].target);
                    if (idx >= 0) { bestIdx = idx; }
                }
            }
            if (bestIdx >= 0) {
                var items = sb.querySelectorAll('.marp-outline-item');
                for (var j = 0; j < items.length; j++) { items[j].classList.remove('active'); }
                if (items[bestIdx]) {
                    items[bestIdx].classList.add('active');
                    smoothScrollTo(items[bestIdx], sidebar, 'nearest');
                }
            }
        }, { threshold: [0.3, 0.5, 0.7] });
        for (var i = 0; i < slides.length; i++) { scrollObserver.observe(slides[i]); }
    }

    function setupScrollTracking(slides, sb) {
        if (!window.IntersectionObserver) { return; }
        scrollObserver = new IntersectionObserver(function (entries) {
            var bestIdx = -1, bestRatio = 0;
            for (var i = 0; i < entries.length; i++) {
                if (entries[i].isIntersecting && entries[i].intersectionRatio > bestRatio) {
                    bestRatio = entries[i].intersectionRatio;
                    var idx = Array.prototype.indexOf.call(slides, entries[i].target);
                    if (idx >= 0) { bestIdx = idx; }
                }
            }
            if (bestIdx >= 0) {
                var thumbs = sb.querySelectorAll('.marp-thumb');
                for (var j = 0; j < thumbs.length; j++) { thumbs[j].classList.remove('active'); }
                if (thumbs[bestIdx]) {
                    thumbs[bestIdx].classList.add('active');
                    smoothScrollTo(thumbs[bestIdx], sidebar, 'nearest');
                }
            }
        }, { threshold: [0.3, 0.5, 0.7] });
        for (var i = 0; i < slides.length; i++) { scrollObserver.observe(slides[i]); }
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
        // Retry a few times in case Marp hasn't rendered SVGs yet
        var retries = [200, 500, 1000, 2000];
        retries.forEach(function (delay) {
            setTimeout(function () { ensureMarpUI(); buildThumbnails(); }, delay);
        });
        window.addEventListener('vscode.markdown.updateContent', function () {
            setTimeout(buildThumbnails, 300);
        });
        var debounceTimer = null;
        var observer = new MutationObserver(function () {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(function () {
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
