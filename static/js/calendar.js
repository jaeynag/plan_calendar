/* global supabase */
(() => {
  const { createClient } = supabase;

  const SUPABASE_URL = window.__SUPABASE_URL__;
  const SUPABASE_ANON_KEY = window.__SUPABASE_ANON_KEY__;
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const state = {
    jwt: null,
    userEmail: null,
    year: null,
    month: null,
    habits: [],
    logsByDate: {},
    activeDate: null,
  };

  function getYearMonthFromBody() {
    const body = document.body;
    state.year = parseInt(body.getAttribute("data-year"), 10);
    state.month = parseInt(body.getAttribute("data-month"), 10);
  }

  function isoDateOfDay(dayNum) {
    const y = state.year;
    const m = String(state.month).padStart(2, "0");
    const d = String(dayNum).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function openModal(modalId) { $(modalId).classList.remove("hidden"); }
  function closeAllModals() { $$(".modal").forEach((m) => m.classList.add("hidden")); }

  function renderDots() {
    $$(".day-dots").forEach((el) => {
      const date = el.getAttribute("data-date");
      const ids = state.logsByDate[date] || [];
      el.textContent = ids.length ? "•".repeat(Math.min(ids.length, 6)) : "";
    });
  }

  function renderHabitListForDate(date) {
    const checked = new Set(state.logsByDate[date] || []);
    const wrap = $("#habitList");
    wrap.innerHTML = "";

    state.habits.forEach((h) => {
      const row = document.createElement("label");
      row.className = "habit-row";
      row.setAttribute("data-habit-id", h.id);

      const left = document.createElement("div");
      left.className = "habit-left";

      const emoji = document.createElement("span");
      emoji.className = "habit-emoji";
      emoji.textContent = h.emoji || "✅";

      const title = document.createElement("span");
      title.className = "habit-title";
      title.textContent = h.title;

      left.appendChild(emoji);
      left.appendChild(title);

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = checked.has(h.id);

      row.appendChild(left);
      row.appendChild(cb);
      wrap.appendChild(row);
    });
  }

  function gatherCheckedHabitIds() {
    return $$("#habitList .habit-row")
      .filter((row) => row.querySelector("input[type=checkbox]")?.checked)
      .map((row) => row.getAttribute("data-habit-id"));
  }

  async function apiFetch(path, { method = "GET", body = null } = {}) {
    const headers = { "Content-Type": "application/json", "Authorization": `Bearer ${state.jwt}` };
    const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : null });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`API ${method} ${path} failed: ${res.status} ${t}`);
    }
    return res.json();
  }

  async function loadData() {
    const habitsRes = await apiFetch("/api/habits");
    state.habits = habitsRes.habits || [];

    const logsRes = await apiFetch(`/api/logs?year=${state.year}&month=${state.month}`);
    state.logsByDate = logsRes.logs_by_date || {};

    renderDots();
  }

  async function requireSessionOrRedirect() {
    const { data } = await sb.auth.getSession();
    if (!data.session) { location.href = "/login"; return false; }
    state.jwt = data.session.access_token;
    state.userEmail = data.session.user?.email || "";
    const badge = $("#userBadge");
    if (badge) badge.textContent = state.userEmail ? `로그인: ${state.userEmail}` : "로그인됨";
    return true;
  }

  function bindUI() {
    $$(".day[data-day]").forEach((cell) => {
      cell.addEventListener("click", () => {
        const dayNum = parseInt(cell.getAttribute("data-day"), 10);
        const date = isoDateOfDay(dayNum);
        state.activeDate = date;
        $("#modalDateTitle").textContent = date;
        renderHabitListForDate(date);
        openModal("#checkModal");
      });
    });

    $$(".modal [data-close='1']").forEach((el) => el.addEventListener("click", () => closeAllModals()));

    $("#btnSaveDay").addEventListener("click", async () => {
      if (!state.activeDate) return;
      const habitIds = gatherCheckedHabitIds();
      await apiFetch("/api/save_log", { method: "POST", body: { date: state.activeDate, habit_ids: habitIds } });
      state.logsByDate[state.activeDate] = habitIds;
      renderDots();
      closeAllModals();
    });

    $("#btnAddHabit").addEventListener("click", () => openModal("#habitModal"));

    $("#btnCreateHabit").addEventListener("click", async () => {
      const title = ($("#habitTitle").value || "").trim();
      const emoji = ($("#habitEmoji").value || "").trim() || "✅";
      const color = ($("#habitColor").value || "").trim() || "#FF9500";
      const period_unit = $("#habitUnit").value;
      const period_value = Math.max(1, parseInt($("#habitUnitValue").value, 10) || 1);
      const target_count = Math.max(1, parseInt($("#habitTarget").value, 10) || 1);

      if (!title) { alert("제목부터 써라."); return; }

      await apiFetch("/api/habits", {
        method: "POST",
        body: { title, emoji, color, period_unit, period_value, target_count },
      });

      $("#habitTitle").value = "";
      closeAllModals();
      await loadData();
    });

    $("#btnLogout")?.addEventListener("click", async () => {
      await sb.auth.signOut();
      location.href = "/login";
    });
  }

  async function main() {
    getYearMonthFromBody();
    const ok = await requireSessionOrRedirect();
    if (!ok) return;
    bindUI();
    await loadData();
  }

  document.addEventListener("DOMContentLoaded", () => {
    main().catch((e) => { console.error(e); alert("에러 났다. 콘솔 보고 와."); });
  });
})();
