/* global document, window */
// Loaded as an external script, allowed by script-src 'self'.
window.__cspScriptRan = true;
console.log('csp-strict fixture loaded');
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('status').textContent = 'Skrypt załadowany.';
});
