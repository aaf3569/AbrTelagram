(() => {
  const TARGET_NAME = "عبدالله عبدالمحسن فاضل الصايغ";
  const STYLE_ID = "name-glow-effect-style";
  const GLOW_CLASS = "name-glow-effect";
  const NAME_CHAR_REGEX = /[\u0600-\u06FF\u0750-\u077FA-Za-z0-9]/;

  function isNameChar(ch) {
    return !!ch && NAME_CHAR_REGEX.test(ch);
  }

  function findNextExactNameIndex(text, fromIndex) {
    let idx = text.indexOf(TARGET_NAME, fromIndex);
    while (idx !== -1) {
      const before = idx > 0 ? text[idx - 1] : "";
      const afterPos = idx + TARGET_NAME.length;
      const after = afterPos < text.length ? text[afterPos] : "";

      if (!isNameChar(before) && !isNameChar(after)) {
        return idx;
      }

      idx = text.indexOf(TARGET_NAME, idx + 1);
    }
    return -1;
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
    if (!textNode.nodeValue || !textNode.nodeValue.includes(TARGET_NAME)) return;

    const parent = textNode.parentElement;
    if (!parent) return;
    if (parent.classList.contains(GLOW_CLASS)) return;
    if (parent.closest("script, style, noscript, textarea")) return;

    const original = textNode.nodeValue;
    const fragment = document.createDocumentFragment();
    let start = 0;
    let index = findNextExactNameIndex(original, 0);

    while (index !== -1) {
      if (index > start) {
        fragment.appendChild(document.createTextNode(original.slice(start, index)));
      }

      const glowSpan = document.createElement("span");
      glowSpan.className = GLOW_CLASS;
      glowSpan.textContent = TARGET_NAME;
      fragment.appendChild(glowSpan);

      start = index + TARGET_NAME.length;
      index = findNextExactNameIndex(original, start);
    }

    if (start < original.length) {
      fragment.appendChild(document.createTextNode(original.slice(start)));
    }

    textNode.replaceWith(fragment);
  }

  function scanForName(root) {
    if (!root) return;

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (parent.classList.contains(GLOW_CLASS)) return NodeFilter.FILTER_REJECT;
          if (parent.closest("script, style, noscript, textarea")) return NodeFilter.FILTER_REJECT;
          if (!node.nodeValue || !node.nodeValue.includes(TARGET_NAME)) return NodeFilter.FILTER_SKIP;
          if (findNextExactNameIndex(node.nodeValue, 0) === -1) return NodeFilter.FILTER_SKIP;
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    const targets = [];
    while (walker.nextNode()) targets.push(walker.currentNode);
    targets.forEach(wrapNameInTextNode);
  }

  function observeChanges() {
    if (!document.body) return;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          wrapNameInTextNode(mutation.target);
          continue;
        }

        for (const addedNode of mutation.addedNodes) {
          if (addedNode.nodeType === Node.TEXT_NODE) {
            wrapNameInTextNode(addedNode);
            continue;
          }

          if (addedNode.nodeType === Node.ELEMENT_NODE) {
            scanForName(addedNode);
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
