(() => {
  const TARGET_NAME_PATTERN = "عبد\\s*الله\\s+عبد\\s+المحسن\\s+فاضل\\s+الصايغ";
  const STYLE_ID = "name-glow-effect-style";
  const GLOW_CLASS = "name-glow-effect";
  const NAME_CHAR_REGEX = /[\u0600-\u06FF\u0750-\u077FA-Za-z0-9]/;

  function isNameChar(ch) {
    return !!ch && NAME_CHAR_REGEX.test(ch);
  }

  function containsTargetName(text) {
    return !!text && new RegExp(TARGET_NAME_PATTERN).test(text);
  }

  // Returns {index, length} of the next match whose surrounding characters
  // aren't themselves name characters (so this can't match as a substring
  // of some other, longer name), or null.
  function findNextExactNameMatch(text, fromIndex) {
    const re = new RegExp(TARGET_NAME_PATTERN, "g");
    re.lastIndex = fromIndex;
    let m;
    while ((m = re.exec(text))) {
      const idx = m.index;
      const length = m[0].length;
      const before = idx > 0 ? text[idx - 1] : "";
      const afterPos = idx + length;
      const after = afterPos < text.length ? text[afterPos] : "";

      if (!isNameChar(before) && !isNameChar(after)) {
        return { index: idx, length };
      }

      re.lastIndex = idx + 1;
    }
    return null;
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
.${GLOW_CLASS}{
  color:#3b82f6;
  font-weight:900;
  text-shadow:
    0 0 4px rgba(59,130,246,.7),
    0 0 10px rgba(14,165,233,.55),
    0 0 16px rgba(56,189,248,.45);
  animation:nameGlowBlueCycle .65s linear infinite;
}
@keyframes nameGlowBlueCycle{
  0%{
    color:#1d4ed8;
    text-shadow:
      0 0 4px rgba(29,78,216,.8),
      0 0 10px rgba(29,78,216,.6),
      0 0 16px rgba(29,78,216,.45);
  }
  25%{
    color:#0369a1;
    text-shadow:
      0 0 4px rgba(3,105,161,.85),
      0 0 10px rgba(3,105,161,.65),
      0 0 16px rgba(3,105,161,.5);
  }
  50%{
    color:#0ea5e9;
    text-shadow:
      0 0 4px rgba(14,165,233,.9),
      0 0 10px rgba(14,165,233,.7),
      0 0 16px rgba(14,165,233,.55);
  }
  75%{
    color:#38bdf8;
    text-shadow:
      0 0 4px rgba(56,189,248,.95),
      0 0 10px rgba(56,189,248,.75),
      0 0 16px rgba(56,189,248,.6);
  }
  100%{
    color:#1d4ed8;
    text-shadow:
      0 0 4px rgba(29,78,216,.8),
      0 0 10px rgba(29,78,216,.6),
      0 0 16px rgba(29,78,216,.45);
  }
}
`;
    document.head.appendChild(style);
  }

  function wrapNameInTextNode(textNode) {
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return;
    if (!containsTargetName(textNode.nodeValue)) return;

    const parent = textNode.parentElement;
    if (!parent) return;
    if (parent.classList.contains(GLOW_CLASS)) return;
    if (parent.closest("script, style, noscript, textarea")) return;

    const original = textNode.nodeValue;
    const fragment = document.createDocumentFragment();
    let start = 0;
    let match = findNextExactNameMatch(original, 0);

    while (match) {
      if (match.index > start) {
        fragment.appendChild(document.createTextNode(original.slice(start, match.index)));
      }

      const glowSpan = document.createElement("span");
      glowSpan.className = GLOW_CLASS;
      // Use the actual matched text, not a fixed canonical spelling — the
      // pattern accepts more than one real spacing/joining of this name,
      // and this preserves whichever one the source record actually uses.
      glowSpan.textContent = original.slice(match.index, match.index + match.length);
      fragment.appendChild(glowSpan);

      start = match.index + match.length;
      match = findNextExactNameMatch(original, start);
    }

    if (start < original.length) {
      fragment.appendChild(document.createTextNode(original.slice(start)));
    }

    textNode.replaceWith(fragment);
  }

  function scanForName(root) {
    if (!root || !root.isConnected) return;

    // Cheap native pre-check before the walker. Building textContent is one
    // C++ string concatenation; the TreeWalker below runs a JS callback for
    // every text node in the subtree. In the overwhelmingly common case (the
    // name is nowhere in this subtree) this returns here and the walker,
    // which is the expensive part, never runs at all.
    const text = root.nodeType === Node.TEXT_NODE ? root.nodeValue : root.textContent;
    if (!containsTargetName(text)) return;

    if (root.nodeType === Node.TEXT_NODE) {
      wrapNameInTextNode(root);
      return;
    }

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (parent.classList.contains(GLOW_CLASS)) return NodeFilter.FILTER_REJECT;
          if (!containsTargetName(node.nodeValue)) return NodeFilter.FILTER_SKIP;
          if (parent.closest("script, style, noscript, textarea")) return NodeFilter.FILTER_REJECT;
          if (!findNextExactNameMatch(node.nodeValue, 0)) return NodeFilter.FILTER_SKIP;
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    const targets = [];
    while (walker.nextNode()) targets.push(walker.currentNode);
    targets.forEach(wrapNameInTextNode);
  }

  // --- Deferred, batched scanning -----------------------------------------
  //
  // Previously the observer scanned synchronously inside its own callback,
  // so every appendChild during a list render paid for a full subtree walk
  // before the browser could get back to painting. Rendering a class of
  // students meant hundreds of walks queued ahead of the next frame, which
  // is what made opening a section feel like it hung.
  //
  // Now a mutation only records which root needs looking at; the actual
  // scanning happens later, in idle time, off the render path. The end
  // result on screen is identical.

  // Past this many queued roots it is cheaper to forget the individual nodes
  // and do a single pass over the whole body than to keep tracking them.
  const MAX_PENDING_ROOTS = 64;

  const pending = new Set();
  let scheduled = false;

  const scheduleIdle =
    typeof window.requestIdleCallback === "function"
      ? (fn) => window.requestIdleCallback(fn, { timeout: 500 })
      : (fn) => setTimeout(() => fn(null), 100);

  function flush(deadline) {
    scheduled = false;
    let budget = MAX_PENDING_ROOTS;

    for (const root of pending) {
      pending.delete(root);
      scanForName(root);
      budget -= 1;
      const outOfTime =
        budget <= 0 ||
        (deadline && typeof deadline.timeRemaining === "function" && deadline.timeRemaining() <= 1);
      if (outOfTime && pending.size) {
        schedule();
        return;
      }
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    scheduleIdle(flush);
  }

  function queue(node) {
    if (!node) return;
    if (pending.has(document.body)) return;
    // A big list render fires one mutation per row. Once enough have piled
    // up, collapse the batch into one body scan — tracking them all
    // individually would cost more than simply re-walking once.
    if (pending.size >= MAX_PENDING_ROOTS) {
      pending.clear();
      pending.add(document.body);
      schedule();
      return;
    }
    pending.add(node);
    schedule();
  }

  function observeChanges() {
    if (!document.body) return;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          queue(mutation.target);
          continue;
        }
        for (const addedNode of mutation.addedNodes) {
          if (addedNode.nodeType === Node.TEXT_NODE || addedNode.nodeType === Node.ELEMENT_NODE) {
            queue(addedNode);
          }
        }
      }
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  }

  function start() {
    injectStyle();
    scanForName(document.body);
    observeChanges();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
