// Warms the pages this page can navigate to, so that tapping one of the
// big navigation buttons doesn't start from a cold network request.
//
// Almost all navigation here is `location.href = '/some/page.html'` inside a
// click handler rather than a real <a href>, so the browser has no idea
// where a tap is going to send it and can't speculate on its own. This
// script reads those destinations straight out of the page's own inline
// scripts (they are plain string literals already sitting in the DOM), then
// asks the browser to fetch each one at the lowest priority once the page
// has gone quiet. When the user does tap, the document is already in the
// HTTP cache and the navigation starts with the body in hand.
//
// Nothing here changes what the page looks like or how it behaves — the only
// effect is that the *next* page arrives sooner.

(() => {
  // Nothing is prefetched until the page has been idle this long, so this
  // never competes with the data the user is actually waiting for.
  const IDLE_DELAY_MS = 1500;
  // Keep the extra bandwidth bounded. These documents are ~30-50 KB each
  // over the wire (Brotli), and a page rarely has more than a handful of
  // realistic destinations anyway.
  const MAX_TARGETS = 4;

  const HREF_LITERAL = /location\s*\.\s*(?:href|assign|replace)\s*(?:=|\()\s*(['"])([^'"]+?\.html(?:[?#][^'"]*)?)\1/g;

  function connectionIsCheap() {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!c) return true; // no information — assume a normal connection
    if (c.saveData) return false; // user explicitly asked us to use less data
    const t = (c.effectiveType || "").toLowerCase();
    if (t === "slow-2g" || t === "2g") return false;
    return true;
  }

  function collectTargets() {
    const here = new URL(location.href);
    const found = new Set();

    const add = (raw) => {
      if (!raw || found.size >= MAX_TARGETS) return;
      let url;
      try {
        url = new URL(raw, here);
      } catch {
        return;
      }
      if (url.origin !== here.origin) return;
      if (!url.pathname.endsWith(".html")) return;
      if (url.pathname === here.pathname) return; // already have this one
      // Every page links back to the login screen as its sign-out target.
      // Signing out is rare and nobody minds waiting for it, so it should
      // not use up one of the few slots we allow ourselves.
      //
      // Matched on the file name rather than the whole path on purpose:
      // some of these links are written relative ("index.html"), so from a
      // page inside a folder they resolve to /that-folder/index.html, which
      // is not a real file. Skipping every index.html stops us requesting
      // one of those and logging a 404 in the console.
      if (url.pathname === "/" || /(?:^|\/)index\.html$/.test(url.pathname)) return;
      found.add(url.origin + url.pathname); // ignore query/hash for caching
    };

    // Real links, if the page has any.
    document.querySelectorAll('a[href$=".html"], a[href*=".html?"]').forEach((a) => add(a.getAttribute("href")));

    // The JS-driven navigations, read out of the inline scripts themselves.
    document.querySelectorAll("script:not([src])").forEach((s) => {
      const text = s.textContent;
      if (!text || text.indexOf("location") === -1) return;
      HREF_LITERAL.lastIndex = 0;
      let m;
      while ((m = HREF_LITERAL.exec(text)) !== null) {
        add(m[2]);
        if (found.size >= MAX_TARGETS) break;
      }
    });

    return [...found];
  }

  function prefetch(href) {
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.as = "document";
    link.href = href;
    document.head.appendChild(link);
  }

  function run() {
    if (!connectionIsCheap()) return;
    const targets = collectTargets();
    if (!targets.length) return;
    targets.forEach(prefetch);
  }

  function scheduleRun() {
    const go = () => {
      if (typeof requestIdleCallback === "function") {
        requestIdleCallback(run, { timeout: 4000 });
      } else {
        setTimeout(run, 0);
      }
    };
    setTimeout(go, IDLE_DELAY_MS);
  }

  if (document.readyState === "complete") {
    scheduleRun();
  } else {
    window.addEventListener("load", scheduleRun, { once: true });
  }
})();
