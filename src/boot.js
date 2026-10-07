// La misma secuencia y duración de Eclipse-Web, independiente de la carga del app.
(() => {
  const html = document.documentElement;
  const el = document.querySelector(".loader");
  const start = window.__eclipseLoaderAt;
  if (el?.getAnimations) for (const animation of el.getAnimations({ subtree: true })) animation.startTime = start;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const events = ["pointerdown", "keydown", "wheel", "touchstart"];
  let ended = false;
  function end(skip = false) {
    if (ended) return;
    ended = true;
    for (const name of events) window.removeEventListener(name, onSkip, true);
    if (skip) html.dataset.loader = "skip";
    setTimeout(() => { html.dataset.loader = "done"; }, skip ? 220 : 0);
  }
  function onSkip() { end(true); }
  for (const name of events) window.addEventListener(name, onSkip, { capture: true, passive: true });
  setTimeout(() => end(), Math.max(0, start + (reduced ? 380 : 1790) - performance.now()));
})();
