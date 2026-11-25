/* Features page: renders all narrated storyboard videos with filtering & theater modal. */
(async function () {
  const grid = document.getElementById("storyboard-grid");
  const countEl = document.getElementById("results-count");
  const searchInput = document.getElementById("storyboard-search");
  const pillsContainer = document.getElementById("category-pills");
  const aiToggle = document.getElementById("filter-ai");

  const modal = document.getElementById("video-modal");
  const modalClose = document.getElementById("modal-close");
  const modalMeta = document.getElementById("modal-meta");
  const modalTitle = document.getElementById("modal-title");
  const modalVideo = document.getElementById("modal-video");
  const modalTrack = document.getElementById("modal-track");
  const modalTranscript = document.getElementById("modal-transcript");
  const modalScenes = document.getElementById("modal-scenes");
  const modalVariantTabs = document.getElementById("modal-variant-tabs");
  const modalPrev = document.getElementById("modal-prev");
  const modalNext = document.getElementById("modal-next");

  let catalog = null;
  let allItems = [];
  let filteredItems = [];
  let activeCategory = "All";
  let onlyAi = false;
  let query = "";
  let currentIndex = -1;

  function formatDuration(sec) {
    if (!sec || !Number.isFinite(sec)) return "0:20";
    const s = Math.round(sec);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, "0")}`;
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function badgeClass(cat) {
    const c = (cat || "").toLowerCase();
    if (c === "docs") return "badge badge-docs";
    if (c === "sheets") return "badge badge-sheets";
    if (c === "slides") return "badge badge-slides";
    return "badge";
  }

  function buildCategoryPills() {
    const counts = new Map();
    for (const item of allItems) {
      counts.set(item.category, (counts.get(item.category) || 0) + 1);
    }
    const preferredOrder = ["Docs", "Sheets", "Slides", "Files", "Forms", "Home", "Admin"];
    const categories = ["All", ...preferredOrder.filter((c) => counts.has(c))];
    for (const c of counts.keys()) {
      if (!categories.includes(c)) categories.push(c);
    }

    pillsContainer.innerHTML = categories
      .map((cat) => {
        const n = cat === "All" ? allItems.length : counts.get(cat);
        const active = cat === activeCategory ? " active" : "";
        return `<button type="button" class="pill${active}" data-cat="${escapeHtml(cat)}">${escapeHtml(cat)} (${n})</button>`;
      })
      .join("");

    pillsContainer.querySelectorAll(".pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeCategory = btn.dataset.cat;
        pillsContainer.querySelectorAll(".pill").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        applyFilters();
      });
    });
  }

  function applyFilters() {
    const q = query.trim().toLowerCase();
    filteredItems = allItems.filter((item) => {
      if (activeCategory !== "All" && item.category !== activeCategory) return false;
      if (onlyAi && !item.aiVideo) return false;
      if (!q) return true;
      const haystack = `${item.number} ${item.title} ${item.app} ${item.mode} ${item.summary} ${item.narration}`.toLowerCase();
      return haystack.includes(q);
    });
    renderGrid();
  }

  function renderGrid() {
    countEl.textContent = `Showing ${filteredItems.length} of ${allItems.length} narrated storyboards`;
    if (filteredItems.length === 0) {
      grid.innerHTML = `<p style="color:var(--text-secondary);grid-column:1/-1;">No storyboards match your filter. Try clearing the search box or switching categories.</p>`;
      return;
    }

    grid.innerHTML = filteredItems
      .map((item, idx) => {
        const aiBadge = item.aiVideo
          ? `<span class="badge badge-ai">AI Agent Video</span>`
          : "";
        const modeBadge = item.isCluster
          ? `<span class="badge">Cluster</span>`
          : `<span class="badge">Local</span>`;
        return `
          <article class="sb-card" data-index="${idx}">
            <div class="sb-meta">
              <span class="badge">#${String(item.number).padStart(2, "0")}</span>
              <span class="${badgeClass(item.category)}">${escapeHtml(item.app)}</span>
              ${modeBadge}
              ${aiBadge}
            </div>
            <h3 class="sb-title">${escapeHtml(item.title)}</h3>
            <p class="sb-summary">${escapeHtml(item.summary || item.narration)}</p>
            <div class="sb-footer">
              <span class="sb-duration">Narrated · ${formatDuration(item.duration)}</span>
              <button type="button" class="btn btn-primary btn-sm" data-open="${idx}">
                ▶ Watch
              </button>
            </div>
          </article>
        `;
      })
      .join("");

    grid.querySelectorAll("[data-open]").forEach((btn) => {
      btn.addEventListener("click", () => {
        openModal(Number(btn.dataset.open), "standard");
      });
    });
  }

  function loadModalVideo(item, variant) {
    const src = variant === "ai" && item.aiVideo ? item.aiVideo : item.video;
    modalVideo.pause();
    modalVideo.src = src;
    modalTrack.src = item.captions;
    modalVideo.load();
    if (modalVideo.textTracks && modalVideo.textTracks[0]) {
      modalVideo.textTracks[0].mode = "showing";
    }
    modalVideo.play().catch(() => {});

    modalVariantTabs.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("active", b.dataset.variant === variant);
    });
  }

  function openModal(index, variant = "standard") {
    if (index < 0 || index >= filteredItems.length) return;
    currentIndex = index;
    const item = filteredItems[index];

    modalMeta.innerHTML = `
      <span class="badge">#${String(item.number).padStart(2, "0")}</span>
      <span class="${badgeClass(item.category)}">${escapeHtml(item.app)}</span>
      <span class="badge">${escapeHtml(item.mode)}</span>
    `;
    modalTitle.textContent = item.title;
    modalTranscript.textContent = item.narration;

    if (item.scenes && item.scenes.length > 0) {
      modalScenes.innerHTML = item.scenes
        .map((s) =>
          s.heading
            ? `<li><strong>${escapeHtml(s.heading)}.</strong> ${escapeHtml(s.text)}</li>`
            : `<li>${escapeHtml(s.text)}</li>`
        )
        .join("");
    } else {
      modalScenes.innerHTML = `<li>${escapeHtml(item.summary || item.narration)}</li>`;
    }

    if (item.aiVideo) {
      modalVariantTabs.innerHTML = `
        <button type="button" class="pill active" data-variant="standard">Narrated Walkthrough (${formatDuration(item.duration)})</button>
        <button type="button" class="pill pill-ai" data-variant="ai">On-Device AI Agent (${formatDuration(item.aiDuration)})</button>
      `;
      modalVariantTabs.querySelectorAll("button").forEach((btn) => {
        btn.addEventListener("click", () => loadModalVideo(item, btn.dataset.variant));
      });
    } else {
      modalVariantTabs.innerHTML = `<span class="badge">Narrated Walkthrough (${formatDuration(item.duration)})</span>`;
    }

    modalPrev.disabled = index === 0;
    modalNext.disabled = index === filteredItems.length - 1;

    modal.classList.add("open");
    document.body.style.overflow = "hidden";
    history.replaceState(null, "", `#${item.id}`);
    loadModalVideo(item, variant);
  }

  function closeModal() {
    modal.classList.remove("open");
    modalVideo.pause();
    modalVideo.removeAttribute("src");
    document.body.style.overflow = "";
    if (location.hash) {
      history.replaceState(null, "", location.pathname + location.search);
    }
  }

  modalClose.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
  modalPrev.addEventListener("click", () => openModal(currentIndex - 1, "standard"));
  modalNext.addEventListener("click", () => openModal(currentIndex + 1, "standard"));

  document.addEventListener("keydown", (e) => {
    if (!modal.classList.contains("open")) return;
    if (e.key === "Escape") closeModal();
    else if (e.key === "ArrowLeft" && currentIndex > 0) openModal(currentIndex - 1, "standard");
    else if (e.key === "ArrowRight" && currentIndex < filteredItems.length - 1) openModal(currentIndex + 1, "standard");
  });

  searchInput.addEventListener("input", (e) => {
    query = e.target.value;
    applyFilters();
  });

  aiToggle.addEventListener("click", () => {
    onlyAi = !onlyAi;
    aiToggle.classList.toggle("active", onlyAi);
    aiToggle.setAttribute("aria-pressed", String(onlyAi));
    applyFilters();
  });

  try {
    const res = await fetch("data/storyboards.json");
    catalog = await res.json();
    allItems = catalog.storyboards || [];
    const totalBadge = document.getElementById("hero-total-count");
    if (totalBadge) totalBadge.textContent = String(allItems.length);
    const aiBadgeCount = document.getElementById("hero-ai-count");
    if (aiBadgeCount) aiBadgeCount.textContent = String(catalog.aiCount || 0);

    buildCategoryPills();
    applyFilters();

    // Open direct hash link if present (e.g. features.html#09-household-budget-with-formulas)
    const hashId = location.hash.replace(/^#/, "");
    if (hashId) {
      const idx = filteredItems.findIndex((x) => x.id === hashId);
      if (idx >= 0) openModal(idx, "standard");
    }
  } catch (err) {
    grid.innerHTML = `<p style="color:var(--text-secondary);">Could not load storyboard catalog: ${escapeHtml(err.message)}</p>`;
  }
})();
