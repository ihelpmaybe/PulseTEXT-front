const rowsEl = document.getElementById("boardRows");
const refreshBtn = document.getElementById("refreshBtn");
const rangeBtns = [...document.querySelectorAll(".board-range-btn")];

/** @type {"all" | "today"} */
let range = "all";

function short(addr) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setRange(next) {
  range = next === "today" ? "today" : "all";
  rangeBtns.forEach((btn) => {
    const on = btn.getAttribute("data-range") === range;
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
}

(function hideDeskOnly() {
  const host = location.hostname;
  const local = host === "127.0.0.1" || host === "localhost";
  if (local && !new URLSearchParams(location.search).get("api")) return;
  document.querySelectorAll(".desk-only").forEach((el) => el.remove());
})();

function apiBase() {
  const q = new URLSearchParams(location.search).get("api");
  if (q) return String(q).replace(/\/+$/, "");
  const meta = document.querySelector('meta[name="pulsetext-api"]');
  const fromMeta = meta?.getAttribute("content")?.trim();
  if (fromMeta) return fromMeta.replace(/\/+$/, "");
  if (typeof window.__PULSETEXT_API__ === "string" && window.__PULSETEXT_API__.trim()) {
    return window.__PULSETEXT_API__.trim().replace(/\/+$/, "");
  }
  return "";
}

async function loadBoard() {
  const res = await fetch(
    `${apiBase()}/v1/leaderboard?range=${encodeURIComponent(range)}`,
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);

  if (!data.board?.length) {
    rowsEl.innerHTML = `<tr><td colspan="4" class="muted">${
      range === "today" ? "No callers today yet" : "No callers yet"
    }</td></tr>`;
    return;
  }

  rowsEl.innerHTML = data.board
    .map(
      (r) => `<tr class="${r.rank <= 3 ? `rank-${r.rank}` : ""}">
        <td class="rank-cell">${r.rank}</td>
        <td>
          <div class="caller-name">${escapeHtml(r.name)}</div>
          <div class="mono small muted">${short(r.address)}</div>
        </td>
        <td>${r.lines}</td>
        <td>$${r.spentUsd}</td>
      </tr>`,
    )
    .join("");
}

rangeBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    setRange(btn.getAttribute("data-range"));
    loadBoard().catch((e) => {
      rowsEl.innerHTML = `<tr><td colspan="4" class="muted">${escapeHtml(e.message)}</td></tr>`;
    });
  });
});

refreshBtn.addEventListener("click", () => {
  loadBoard().catch((e) => {
    rowsEl.innerHTML = `<tr><td colspan="4" class="muted">${escapeHtml(e.message)}</td></tr>`;
  });
});

loadBoard().catch((e) => {
  rowsEl.innerHTML = `<tr><td colspan="4" class="muted">${escapeHtml(e.message)}</td></tr>`;
});
