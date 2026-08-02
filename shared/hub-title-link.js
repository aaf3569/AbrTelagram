(() => {
  const SCHOOL_TITLE = "ثانوية أحمد البشر الرومي";

  function getHubPath(pathname) {
    const p = (pathname || "").toLowerCase();
    if (p.startsWith("/teachers/")) return "/teachers/user";
    if (p.startsWith("/supervisors/")) return "/supervisors/supervisor";
    if (p.startsWith("/dephead/")) return "/dephead/dptlead";
    if (p.startsWith("/admins/")) return "/admins/adminpage";
    return null;
  }

  function normalizeText(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function wireElement(el, hubPath) {
    if (!el || !hubPath) return;
    if (el.dataset.hubLinkBound === "1") return;
    el.dataset.hubLinkBound = "1";

    el.addEventListener("click", () => {
      window.location.href = hubPath;
    });
  }

  function bindHeaderTitleLink() {
    const hubPath = getHubPath(window.location.pathname);
    if (!hubPath) return;

    const candidates = new Set();
    const selectors = [
      ".site-title",
      ".school",
      "header h1",
      "header h2",
      ".site-header h1",
      ".site-header h2",
      ".site-header .school",
    ];

    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => candidates.add(el));
    });

    candidates.forEach((el) => {
      const text = normalizeText(el.textContent);
      if (text.includes(SCHOOL_TITLE)) {
        wireElement(el, hubPath);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindHeaderTitleLink, { once: true });
  } else {
    bindHeaderTitleLink();
  }
})();
