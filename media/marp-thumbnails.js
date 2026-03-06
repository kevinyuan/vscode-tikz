// Injected into VS Code's markdown preview via markdown.previewScripts.
// Detects Marp slides and creates a thumbnail sidebar on the left.
// Uses CSS transform:scale() on cloned section HTML.
(function () {
    'use strict';

    var SIDEBAR_WIDTH = 172;
    var SLIDE_W = 1280;
    var SLIDE_H = 720;
    var sidebar = null;
    var toggle = null;
    var isVisible = false;
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
        'width', 'height', 'minHeight', 'maxWidth',
        'listStyleType', 'listStylePosition',
        'verticalAlign', 'whiteSpace', 'overflow',
        'opacity',
    ];

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
            '  position: fixed; top: 0; left: 0; width: 160px; height: 100vh;',
            '  overflow-y: auto; overflow-x: hidden; padding: 8px 12px;',
            '  box-sizing: border-box; background: rgba(37,37,38,0.97);',
            '  border-right: 1px solid rgba(128,128,128,0.35);',
            '  z-index: 10000; scrollbar-width: thin;',
            '}',
            '#marp-thumb-sidebar.collapsed { display: none; }',
            '#marp-thumb-toggle {',
            '  position: fixed; top: 8px; left: 8px;',
            '  width: 28px; height: 28px; display: flex;',
            '  align-items: center; justify-content: center;',
            '  cursor: pointer; z-index: 10001;',
            '  background: rgba(58,61,65,0.9); color: #ccc;',
            '  border-radius: 4px; font-size: 12px;',
            '  opacity: 0.7; transition: opacity 0.15s; user-select: none;',
            '}',
            '#marp-thumb-toggle:hover { opacity: 1; }',
            '.marp-thumb {',
            '  position: relative; cursor: pointer; margin-bottom: 6px;',
            '  border-radius: 3px; overflow: hidden;',
            '  border: 2px solid transparent; transition: border-color 0.15s;',
            '}',
            '.marp-thumb:hover { border-color: #007fd4; }',
            '.marp-thumb.active { border-color: #007fd4; }',
            '.marp-thumb-num {',
            '  position: absolute; top: 2px; left: 4px;',
            '  font-size: 9px; font-weight: bold; color: #fff;',
            '  background: rgba(0,0,0,0.55); border-radius: 2px;',
            '  padding: 0 3px; z-index: 2; line-height: 1.5;',
            '  font-family: system-ui, sans-serif;',
            '}',
            '.marp-thumb-viewport {',
            '  width: 136px; height: 76.5px; overflow: hidden; position: relative;',
            '}',
            '.marp-thumb-slide {',
            '  position: absolute; top: 0; left: 0;',
            '  width: ' + SLIDE_W + 'px; height: ' + SLIDE_H + 'px;',
            '  overflow: hidden; box-sizing: border-box;',
            '  transform-origin: 0 0;',
            '}',
        ].join('\n');
        document.head.appendChild(styleEl);
    }

    function ensureToggle() {
        if (toggle && document.body.contains(toggle)) { return; }
        toggle = document.createElement('div');
        toggle.id = 'marp-thumb-toggle';
        toggle.title = 'Toggle slide thumbnails';
        toggle.textContent = '\u25B6';
        toggle.addEventListener('click', function () {
            isVisible = !isVisible;
            if (sidebar) { sidebar.classList.toggle('collapsed', !isVisible); }
            toggle.textContent = isVisible ? '\u25C0' : '\u25B6';
            toggle.style.left = isVisible ? (SIDEBAR_WIDTH + 8) + 'px' : '8px';
            document.body.style.marginLeft = isVisible ? SIDEBAR_WIDTH + 'px' : '0';
        });
        document.body.appendChild(toggle);
    }

    function createSidebar() {
        if (sidebar && document.body.contains(sidebar)) { return sidebar; }
        sidebar = document.createElement('div');
        sidebar.id = 'marp-thumb-sidebar';
        sidebar.classList.add('collapsed');
        document.body.appendChild(sidebar);
        return sidebar;
    }

    function buildThumbnails() {
        var slides = document.querySelectorAll('svg[data-marpit-svg]');
        if (slides.length === 0) { return; }

        injectStyles();
        ensureToggle();
        var sb = createSidebar();

        var slideCount = slides.length;
        if (sb.dataset.slideCount === String(slideCount) && sb.children.length === slideCount) {
            return;
        }
        sb.dataset.slideCount = String(slideCount);
        sb.innerHTML = '';

        if (scrollObserver) { scrollObserver.disconnect(); scrollObserver = null; }

        var thumbW = 136;
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

            // Recursively copy computed styles from original to clone
            copyStyles(origSection, slideDiv, 10);

            var viewport = document.createElement('div');
            viewport.className = 'marp-thumb-viewport';
            viewport.appendChild(slideDiv);

            thumb.appendChild(numBadge);
            thumb.appendChild(viewport);

            thumb.addEventListener('click', (function (targetSlide, targetThumb) {
                return function () {
                    targetSlide.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    var all = sb.querySelectorAll('.marp-thumb');
                    for (var j = 0; j < all.length; j++) { all[j].classList.remove('active'); }
                    targetThumb.classList.add('active');
                };
            })(slide, thumb));

            sb.appendChild(thumb);
        });

        setupScrollTracking(slides, sb);
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
                    thumbs[bestIdx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }
        }, { threshold: [0.3, 0.5, 0.7] });
        for (var i = 0; i < slides.length; i++) { scrollObserver.observe(slides[i]); }
    }

    function init() {
        buildThumbnails();
        window.addEventListener('vscode.markdown.updateContent', function () {
            setTimeout(buildThumbnails, 300);
        });
        var debounceTimer = null;
        var observer = new MutationObserver(function () {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(buildThumbnails, 300);
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 500);
    }
})();
