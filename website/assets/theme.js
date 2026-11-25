/* Theme manager: defaults to OS prefers-color-scheme, with manual toggle override. */
(function () {
  const STORAGE_KEY = "suiteleaf-theme";
  const mq = window.matchMedia("(prefers-color-scheme: dark)");

  function getStoredTheme() {
    try {
      const val = localStorage.getItem(STORAGE_KEY);
      return val === "dark" || val === "light" ? val : null;
    } catch {
      return null;
    }
  }

  function resolveTheme() {
    return getStoredTheme() || (mq.matches ? "dark" : "light");
  }

  const SUN_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
  const MOON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const btn = document.getElementById("theme-toggle");
    if (!btn) return;
    const isDark = theme === "dark";
    btn.setAttribute("aria-pressed", String(isDark));
    btn.setAttribute(
      "aria-label",
      isDark ? "Switch to light theme" : "Switch to dark theme"
    );
    btn.innerHTML =
      (isDark ? SUN_SVG : MOON_SVG) +
      '<span class="theme-label">' +
      (isDark ? "Light" : "Dark") +
      "</span>";
  }

  function init() {
    applyTheme(resolveTheme());

    const btn = document.getElementById("theme-toggle");
    if (btn) {
      btn.addEventListener("click", () => {
        const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
        const next = current === "dark" ? "light" : "dark";
        try {
          localStorage.setItem(STORAGE_KEY, next);
        } catch {
          // Ignore storage errors in restricted environments.
        }
        applyTheme(next);
      });
    }

    // Follow OS theme changes when the user hasn't explicitly chosen a theme.
    mq.addEventListener("change", (e) => {
      if (!getStoredTheme()) {
        applyTheme(e.matches ? "dark" : "light");
      }
    });

    // Mobile nav menu toggle
    const menuBtn = document.getElementById("nav-menu-btn");
    const navLinks = document.getElementById("nav-links");
    if (menuBtn && navLinks) {
      menuBtn.addEventListener("click", () => {
        const open = navLinks.classList.toggle("open");
        menuBtn.setAttribute("aria-expanded", String(open));
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
