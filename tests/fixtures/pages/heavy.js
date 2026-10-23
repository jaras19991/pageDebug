// E2 AC-5.3: blocks the main thread for 200 ms, once at load and on every click on #work (see longtask.html).
function heavyWork() {
  const end = performance.now() + 200;
  while (performance.now() < end) { /* busy */ }
}
window.heavyWork = heavyWork;
heavyWork();
document.addEventListener('click', (event) => {
  if (event.target && event.target.id === 'work') {
    heavyWork();
    document.getElementById('result').textContent = 'gotowe';
  }
});
