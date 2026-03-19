/**
 * TikZJax Patching Utility
 * 
 * This module provides patches for the TikZJax library to work correctly
 * within the VS Code Webview environment with proper timeout and error handling.
 * 
 * Requirements: 11.2, 11.3, 11.4
 */

/**
 * Generates JavaScript code that patches the TikZJax library.
 * This code should be injected into the webview after TikZJax is loaded.
 * 
 * @param timeout - Timeout in milliseconds for rendering operations
 * @returns JavaScript code as a string that applies the patches
 */
export function generateTikzJaxPatches(timeout: number = 15000): string {
    return `
(function() {
  // Store original texify function if it exists
  if (typeof window.texify === 'function') {
    const originalTexify = window.texify;
    
    // Patch 1: Add timeout mechanism (Requirement 11.2)
    // Wrap texify with Promise.race to enforce timeout
    window.texify = function(element, options) {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('TikZ rendering timeout exceeded'));
        }, ${timeout});
      });
      
      const renderPromise = originalTexify.call(this, element, options);
      
      return Promise.race([renderPromise, timeoutPromise]);
    };
    
    // Preserve any properties from the original function
    Object.keys(originalTexify).forEach(key => {
      if (!window.texify.hasOwnProperty(key)) {
        window.texify[key] = originalTexify[key];
      }
    });
  }
  
  // Patch 2: Expose cleanup function (Requirement 11.3)
  // This function terminates the TeX Worker and disconnects observers
  window.__tikzjaxCleanup = function() {
    // Terminate any active workers
    if (window.texWorker) {
      try {
        window.texWorker.terminate();
        window.texWorker = null;
      } catch (e) {
        console.warn('Failed to terminate TeX worker:', e);
      }
    }
    
    // Disconnect any mutation observers
    if (window.tikzjaxObserver) {
      try {
        window.tikzjaxObserver.disconnect();
        window.tikzjaxObserver = null;
      } catch (e) {
        console.warn('Failed to disconnect TikZJax observer:', e);
      }
    }
    
    // Clear any cached state
    if (window.tikzjaxCache) {
      window.tikzjaxCache = null;
    }
  };
  
  // Patch 3: Replace broken image error with styled error div (Requirement 11.4)
  // Override the error display mechanism
  const originalCreateElement = document.createElement.bind(document);
  document.createElement = function(tagName, options) {
    const element = originalCreateElement(tagName, options);
    
    // Intercept img elements that might be used for error display
    if (tagName.toLowerCase() === 'img') {
      const originalOnError = element.onerror;
      element.onerror = function(event) {
        // Replace broken image with styled error div
        const errorDiv = originalCreateElement('div');
        errorDiv.className = 'tikzjax-error';
        errorDiv.style.cssText = \`
          border: 2px solid #ff4444;
          background-color: #ffeeee;
          color: #cc0000;
          padding: 12px;
          margin: 8px 0;
          border-radius: 4px;
          font-family: monospace;
          font-size: 12px;
          white-space: pre-wrap;
          word-wrap: break-word;
        \`;
        
        // Extract error message if available
        const errorMessage = element.alt || element.title || 'TikZ rendering failed';
        errorDiv.textContent = '❌ ' + errorMessage;
        
        // Replace the img element with the error div
        if (element.parentNode) {
          element.parentNode.replaceChild(errorDiv, element);
        }
        
        // Call original error handler if it exists
        if (originalOnError) {
          originalOnError.call(element, event);
        }
      };
    }
    
    return element;
  };
  
  console.log('TikZJax patches applied successfully');
})();
`;
}

/**
 * Generates the complete script tag with TikZJax patches.
 * This should be injected after the TikZJax library is loaded.
 * 
 * @param timeout - Timeout in milliseconds for rendering operations
 * @returns HTML script tag as a string
 */
export function generatePatchScriptTag(timeout: number = 15000): string {
    return `<script>${generateTikzJaxPatches(timeout)}</script>`;
}

/**
 * Type definitions for the patched TikZJax window object
 */
declare global {
    interface Window {
        texify?: (element: any, options?: any) => Promise<void>;
        __tikzjaxCleanup?: () => void;
        texWorker?: any;
        tikzjaxObserver?: any;
        tikzjaxCache?: any;
    }
}

export { };
