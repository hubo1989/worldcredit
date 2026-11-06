// support.js - WorldCredit Settings Canvas Support Utilities
console.log('WorldCredit Settings Canvas runtime loaded');

// Fallback for standalone preview when DC runtime is not attached
if (typeof window !== 'undefined' && !window.__DC_RUNTIME__) {
  const style = document.createElement('style');
  style.textContent = `
    sc-if { display: none !important; }
    .toast-pill { display: none !important; }
  `;
  document.head.appendChild(style);
}
