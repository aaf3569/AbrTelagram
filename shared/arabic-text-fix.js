// Keeps Arabic names from rendering broken apart (e.g. "حس ی ن" instead of
// "حسين").
//
// Tajawal only ships the core Arabic letters. Text typed on a Persian/Urdu
// keyboard, or copied from a PDF, often contains look-alike code points that
// Tajawal has no glyph for: Persian yeh "ی" (U+06CC) instead of "ي", Persian
// kaf "ک" instead of "ك", the heh variants, Persian digits, presentation-form
// letters, stray zero-width joiners. The browser has to draw those single
// characters from another font, and Arabic letters can't join across a font
// change, so the word visibly splits at that letter.
//
// This script fixes it on every page, without touching stored data:
//   1. Look-alikes are swapped for the Arabic letter Tajawal does have, in
//      every text node as it is added/changed, before it is painted.
//   2. If text still contains an Arabic-script letter Tajawal lacks entirely
//      (e.g. "چ", "گ"), that text is switched as a whole to a fallback font
//      that has every letter, so the word stays joined.
//   3. Text fields get the same swap, so new names are saved in the
//      standard Arabic spelling.
(() => {
  const CHAR_MAP = {
    "ی": "ي", // ی Persian yeh        -> ي
    "ۍ": "ي", // ۍ yeh with tail       -> ي
    "ٸ": "ئ", // ٸ high hamza yeh      -> ئ
    "ک": "ك", // ک Persian kaf         -> ك
    "ڪ": "ك", // ڪ swash kaf           -> ك
    "ہ": "ه", // ہ heh goal            -> ه
    "ھ": "ه", // ھ heh doachashmee     -> ه
    "ە": "ه", // ە ae                  -> ه
    "ۀ": "هٔ", // ۀ heh with yeh above -> هٔ
    "ۃ": "ة", // ۃ teh marbuta goal    -> ة
    "ٱ": "ا", // ٱ alef wasla          -> ا
    "ٲ": "أ", // ٲ alef wavy hamza     -> أ
    "ٳ": "إ", // ٳ alef wavy hamza below -> إ
    "٫": ".",      // ٫ Arabic decimal separator
    "٬": ",",      // ٬ Arabic thousands separator
  };
  // Persian digits ۰-۹ -> Arabic-Indic digits ٠-٩
  for (let i = 0; i < 10; i += 1) {
    CHAR_MAP[String.fromCharCode(0x06f0 + i)] = String.fromCharCode(0x0660 + i);
  }

  const MAPPED_RE = /[یۍٸکڪہھەۀۃٱ-ٳ٫٬۰-۹]/g;
  // Presentation forms (mostly from PDF copy/paste). FDF0-FDFF is left alone:
  // those are standalone word-symbols like ﷺ, not letters inside a word.
  const PRESENTATION_RE = /[ﭐ-﷯ﹰ-ﻼ]/g;
  // Zero-width characters next to an Arabic letter split the word in two.
  // (ZWJ elsewhere is left alone — emoji sequences need it.)
  const ZERO_WIDTH_RE = /([؀-ۿ]?)[​-‍⁠﻿]+([؀-ۿ]?)/g;

  // Arabic-script characters Tajawal has no glyph for. Its whole Arabic
  // coverage is: 060C 061B 061F 0621-063A 0640-0655 0660-066A 066D-066E 0670
  // 067E 06A4 (U+061C, an invisible bidi mark, is never drawn so it's fine).
  const UNSUPPORTED_RE = /[؀-؋؍-ؚ؝؞ؠػ-ؿٖ-ٟ٫٬ٯٱ-ٽٿ-ڣڥ-ۿݐ-ݿࡰ-ࣿﭐ-﷿ﹰ-ﻼ]/;
  // Cheap pre-check: anything that might need work at all.
  const NEEDS_WORK_RE = /[؀-؋؍-ؚ؝؞ؠػ-ؿٖ-ٟ٫٬ٯٱ-ٽٿ-ڣڥ-ۿݐ-ݿࡰ-ࣿﭐ-﷿ﹰ-ﻼ​-‍⁠﻿]/;

  function normalizeArabicText(text) {
    if (typeof text !== "string" || !NEEDS_WORK_RE.test(text)) return text;
    return text
      .replace(MAPPED_RE, (ch) => CHAR_MAP[ch])
      .replace(PRESENTATION_RE, (ch) => {
        const plain = ch.normalize("NFKC");
        // Isolated-harakat forms decompose to " " + mark; keep just the mark.
        return plain.length > 1 && plain[0] === " " ? plain.slice(1) : plain;
      })
      .replace(ZERO_WIDTH_RE, (match, before, after) => (before || after ? before + after : match));
  }

  globalThis.normalizeArabicText = normalizeArabicText;
  globalThis.hasArabicTajawalCantDraw = (text) => typeof text === "string" && UNSUPPORTED_RE.test(text);

  if (typeof document === "undefined") return;

  const FALLBACK_CLASS = "ar-font-fallback";
  const FALLBACK_FONT_URL =
    "https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@300..900&display=swap";
  const SKIP_PARENTS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "TEMPLATE"]);
  const XHTML_NS = "http://www.w3.org/1999/xhtml";

  let fallbackFontLoaded = false;
  const styledRoots = new WeakSet();
  // The font itself only needs loading once, in the document (@font-face is
  // global), but the class rule has to be added to each shadow root it's
  // used in, since document styles don't reach inside them.
  function ensureFallbackFont(root) {
    if (!fallbackFontLoaded) {
      fallbackFontLoaded = true;
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = FALLBACK_FONT_URL;
      document.head.appendChild(link);
    }
    const target = root instanceof ShadowRoot ? root : document;
    if (styledRoots.has(target)) return;
    styledRoots.add(target);
    const style = document.createElement("style");
    style.textContent =
      `.${FALLBACK_CLASS}{font-family:"Noto Kufi Arabic","Tajawal",system-ui,-apple-system,"Segoe UI",sans-serif!important}`;
    (target === document ? document.head : target).appendChild(style);
  }

  function useFallbackFont(textNode) {
    const parent = textNode.parentElement;
    if (!parent || parent.closest(`.${FALLBACK_CLASS}`)) return;
    ensureFallbackFont(textNode.getRootNode());
    // Elements that can't hold a <span> (or render one) get the class directly.
    if (parent.namespaceURI !== XHTML_NS || parent.tagName === "OPTION" || parent.tagName === "TITLE") {
      parent.classList.add(FALLBACK_CLASS);
      return;
    }
    // Move the existing text node into the span (rather than copying its
    // text) so any code holding a reference to it keeps working.
    const span = document.createElement("span");
    span.className = FALLBACK_CLASS;
    parent.insertBefore(span, textNode);
    span.appendChild(textNode);
  }

  function fixTextNode(node) {
    if (!node.parentNode) return;
    // parentElement is null for text sitting directly in a shadow root.
    const parent = node.parentElement;
    if (parent && (SKIP_PARENTS.has(parent.tagName) || parent.isContentEditable)) return;
    const value = node.nodeValue;
    if (!value || !NEEDS_WORK_RE.test(value)) return;
    const fixed = normalizeArabicText(value);
    if (fixed !== value) node.nodeValue = fixed;
    if (UNSUPPORTED_RE.test(fixed)) useFallbackFont(node);
  }

  // --- Text fields ----------------------------------------------------------

  const nativeValue = new Map();
  for (const Ctor of [HTMLInputElement, HTMLTextAreaElement]) {
    const desc = Object.getOwnPropertyDescriptor(Ctor.prototype, "value");
    if (!desc || !desc.set) continue;
    nativeValue.set(Ctor.prototype, desc);
    // Values set from code (edit forms pre-filled with a stored name) never
    // fire an event, so normalize on the way in.
    Object.defineProperty(Ctor.prototype, "value", {
      ...desc,
      set(v) {
        desc.set.call(this, isFixableField(this) ? normalizeArabicText(v) : v);
      },
    });
  }

  function isFixableField(el) {
    if (el instanceof HTMLTextAreaElement) return true;
    return el instanceof HTMLInputElement && (el.type === "text" || el.type === "search");
  }

  function fixField(el) {
    if (!isFixableField(el)) return;
    const desc = nativeValue.get(
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    );
    if (!desc) return;
    const value = desc.get.call(el);
    const fixed = normalizeArabicText(value);
    if (fixed === value) return;
    // getRootNode() so a focused field inside a shadow root is recognised.
    const focused = el.getRootNode().activeElement === el;
    const start = focused ? el.selectionStart : null;
    const end = focused ? el.selectionEnd : null;
    desc.set.call(el, fixed);
    if (focused && start !== null) {
      // Some swaps change length (e.g. a removed zero-width char), so map the
      // caret through the same normalization.
      el.setSelectionRange(
        normalizeArabicText(value.slice(0, start)).length,
        normalizeArabicText(value.slice(0, end)).length
      );
    }
  }

  // For a field inside a shadow root, e.target is retargeted to the host;
  // composedPath()[0] is the field itself.
  const fieldOf = (e) => (e.composedPath ? e.composedPath()[0] : e.target);
  document.addEventListener("input", (e) => {
    if (!e.isComposing) fixField(fieldOf(e));
  }, true);
  document.addEventListener("compositionend", (e) => fixField(fieldOf(e)), true);

  // --- DOM scanning ----------------------------------------------------------

  function scan(root) {
    if (root.nodeType === Node.TEXT_NODE) {
      fixTextNode(root);
      return;
    }
    // DOCUMENT_FRAGMENT_NODE covers shadow roots.
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;

    if (root.tagName === "INPUT" || root.tagName === "TEXTAREA") fixField(root);
    else if (root.firstElementChild) root.querySelectorAll("input, textarea").forEach(fixField);

    if (!NEEDS_WORK_RE.test(root.textContent)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(fixTextNode);
  }

  // Runs as a microtask after each DOM change, so fixed text is in place
  // before the browser paints it.
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") {
        fixTextNode(mutation.target);
        continue;
      }
      mutation.addedNodes.forEach(scan);
    }
  });
  const OBSERVE_OPTIONS = { subtree: true, childList: true, characterData: true };
  observer.observe(document.documentElement, OBSERVE_OPTIONS);

  // Some sheets (the absence pages) render into shadow roots, which the
  // observer above can't see into. Watch each one as it's created — this
  // script loads in <head>, before any page code attaches one.
  const nativeAttachShadow = Element.prototype.attachShadow;
  if (nativeAttachShadow) {
    Element.prototype.attachShadow = function attachShadow(init) {
      const shadowRoot = nativeAttachShadow.call(this, init);
      observer.observe(shadowRoot, OBSERVE_OPTIONS);
      return shadowRoot;
    };
  }

  if (document.body) scan(document.body);
  else document.addEventListener("DOMContentLoaded", () => scan(document.body), { once: true });
})();
