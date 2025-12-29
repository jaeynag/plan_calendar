/* PlanCal app.js v36
   - Wrapped in IIFE to prevent 'already declared' even if loaded twice
   - Console banner to verify correct version is running
*/
(() => {
  "use strict";
  console.log("[PlanCal] app.js v39 loaded");

/* global supabase */
(() => {
  const { createClient } = supabase;

  const SUPABASE_URL = window.__SUPABASE_URL__;
  const SUPABASE_ANON_KEY = window.__SUPABASE_ANON_KEY__;
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const q = (sel) => document.querySelector(sel);
  const qa = (sel) => Array.from(document.querySelectorAll(sel));
  const pick = (...sels) => {
    for (const s of sels) { const el = q(s); if (el) return el; }
    return null;
  };

  const $ = (sel) => q(sel);
  const $$ = (sel) => qa(sel);

  const setText = (elOrSel, text) => {
    const el = typeof elOrSel === "string" ? q(elOrSel) : elOrSel;
    if (el) el.textContent = text ?? "";
  };

  const show = (elOrSel) => {
    const el = typeof elOrSel === "string" ? q(elOrSel) : elOrSel;
    if (el) el.classList.remove("hidden");
  };

  const hide = (elOrSel) => {
    const el = typeof elOrSel === "string" ? q(elOrSel) : elOrSel;
    if (el) el.classList.add("hidden");
  };

  function on(sel, type, handler) {
    const el = q(sel);
    if (!el) { console.warn("[bind] missing", sel); return null; }
    el.addEventListener(type, handler);
    return el;
  }

  function onAny(selectors, type, handler) {
    for (const sel of selectors) {
      const el = q(sel);
      if (el) { el.addEventListener(type, handler); return el; }
    }
    console.warn("[bind] missing all", selectors.join(", "));
    return null;
  }
  const state = {
    session: null,
    year: null,
    month: null, // 1-12
    habits: [],
    logsByDate: {}, // { 'YYYY-MM-DD': [habit_id,...] }
    activeDate: null,
  };

  // -----------------------------
  // Utils
  // -----------------------------
  const pad2 = (n) => String(n).padStart(2, "0");

  function isoDate(y, m, d) {
    return `${y}-${pad2(m)}-${pad2(d)}`;
  }

  function monthRange(y, m) {
    // [startISO, endISO)
    const start = `${y}-${pad2(m)}-01`;
    const end = m === 12 ? `${y + 1}-01-01` : `${y}-${pad2(m + 1)}-01`;
    return [start, end];
  }

  function openModal(idSel) { const el = q(idSel); if (el) el.classList.remove("hidden"); }
  function closeAllModals() { $$(".modal").forEach((m) => m.classList.add("hidden")); }
  // -----------------------------
  // Auth
  // -----------------------------
  async function refreshSession() {
    const { data } = await sb.auth.getSession();
    state.session = data.session || null;
    return state.session;
  }

  async function ensureAuthedOrShowLogin() {
  const sess = await refreshSession();

  const loginCard = pick("#loginCard","#loginSection","#authCard");
  const appShell = pick("#appShell","#app","#main","#appRoot");
  const btnLogout = pick("#btnLogout","#logoutBtn","#btnSignOut");
  const userBadge = pick("#userBadge","#userEmailBadge","#userEmail");
  const settingsEmail = pick("#settingsEmail","#accountEmail");

  const email = sess?.user?.email || "";

  if (!sess) {
    show(loginCard);
    hide(appShell);
    hide(btnLogout);
    setText(userBadge, "");
    setText(settingsEmail, "-");
    return false;
  }

  hide(loginCard);
  show(appShell);
  show(btnLogout);

  setText(userBadge, email ? `로그인: ${email}` : "로그인됨");
  setText(settingsEmail, email || "-");
  return true;
}

  function bindLogin() {
    onAny(["#btnSignIn","#btnLogin","#loginBtn"], "click", async () => {
      setText("#msg", "");
      const email = (pick("#email","#loginEmail")?.value || "").trim();
      const password = (pick("#password","#loginPassword")?.value || "");

      if (!email || !password) {
        setText("#msg", "이메일/비번부터 넣어.");
        return;
      }

      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) { setText("#msg", error.message); return; }
      await afterLogin();
    });

    // ✅ 회원가입: Confirm email OFF 기준(가입 즉시 로그인 기대)
    onAny(["#btnSignUp","#btnRegister","#signupBtn"], "click", async () => {
      setText("#msg", "");
      const email = (pick("#email","#loginEmail")?.value || "").trim();
      const password = (pick("#password","#loginPassword")?.value || "");

      if (!email || !password) {
        setText("#msg", "이메일/비번부터 넣어.");
        return;
      }

      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) { setText("#msg", error.message); return; }

      // Confirm email OFF면 대부분 session이 바로 생김
      if (data?.session) {
        $("#msg").textContent = "가입 완료. 바로 로그인됨.";
        await afterLogin();
        return;
      }

      $("#msg").textContent = "가입 완료. 이제 로그인 버튼 눌러.";
    });

    onAny(["#btnLogout","#logoutBtn","#btnSignOut"], "click", async () => {
      await sb.auth.signOut();
      await ensureAuthedOrShowLogin();
    });
  }

  // -----------------------------
  // Calendar
  // -----------------------------
  function initYearMonth() {
    const now = new Date();
    state.year = now.getFullYear();
    state.month = now.getMonth() + 1;
  }

  function setTitle() {
  setText(pick("#ymTitle","#monthTitle","#monthLabel"), `${state.month}월`);
  setText(pick("#yearLabel","#yearText","#yyLabel"), String(state.year));
}

  function renderCalendarGrid() {
    setTitle();

    const grid = pick("#calGrid","#calendarGrid");
    if (!grid) { console.warn("[ui] missing calendar grid"); return; }
    grid.innerHTML = "";
    grid.style.gridAutoRows = `minmax(var(--rowMin, 96px), auto)`;

    const y = state.year;
    const m = state.month;

    const first = new Date(y, m - 1, 1);
    const firstDow = first.getDay(); // 0 sun
    const lastDay = new Date(y, m, 0).getDate();

    // 6주(42칸) 고정
    const totalCells = 42;
    for (let i = 0; i < totalCells; i++) {
      const cell = document.createElement("div");

      const dayNum = i - firstDow + 1;
      if (dayNum < 1 || dayNum > lastDay) {
        cell.className = "day empty";
        grid.appendChild(cell);
        continue;
      }

      cell.className = "day";
      cell.setAttribute("data-day", String(dayNum));

      const top = document.createElement("div");
      top.className = "day-num";
      top.textContent = String(dayNum);

      const dots = document.createElement("div");
      dots.className = "day-dots";
      const date = isoDate(y, m, dayNum);
      cell.setAttribute("data-iso", date);
      dots.setAttribute("data-date", date);

      cell.appendChild(top);
      cell.appendChild(dots);

      cell.addEventListener("click", () => onClickDay(dayNum));
      grid.appendChild(cell);
    }

    renderDots();
  }

  function applyIconSizingVars() {
    const grid = pick("#calendarGrid","#calGrid");
    const first = grid ? grid.querySelector(".day") : null;
    if (!first) return;
    const w = Math.round(first.getBoundingClientRect().width);
    if (!w || w < 20) return;

    // Base cell height: slightly taller than width; rows can grow when icons increase
    const rowMin = Math.max(96, Math.min(132, Math.round(w * 1.18)));

    // Icon sizes: 1 icon fills, 2 icons stack, 3+ uses 2-col grid smaller
    const icon1 = Math.max(34, Math.min(72, w - 18));
    const icon2 = Math.max(30, Math.min(64, w - 20));
    const iconS = Math.max(22, Math.min(46, Math.floor((w - 22) / 2)));

    const root = document.documentElement;
    root.style.setProperty("--rowMin", rowMin + "px");
    root.style.setProperty("--icon1", icon1 + "px");
    root.style.setProperty("--icon2", icon2 + "px");
    root.style.setProperty("--iconS", iconS + "px");
  }

  function renderDots() {
    const habitsById = new Map(state.habits.map(h => [h.id, h]));

    $$(".day").forEach((dayEl) => {
      const iso = dayEl.getAttribute("data-iso");
      const dotsEl = dayEl.querySelector(".day-dots");
      if (!dotsEl) return;

      // reset
      dotsEl.textContent = "";
      dotsEl.classList.remove("count-1", "count-2", "count-3p");

      const ids = iso ? (state.logsByDate[iso] || []) : [];
      const shown = ids.slice(0, 6);

      if (!shown.length) return;

      if (shown.length === 1) dotsEl.classList.add("count-1");
      else if (shown.length === 2) dotsEl.classList.add("count-2");
      else dotsEl.classList.add("count-3p");

      for (const habitId of shown) {
        const h = habitsById.get(habitId);
        if (!h) continue;

        // Prefer photo/icon_url, fallback to emoji
        if (h.icon_url) {
          const img = document.createElement("img");
          img.className = "icon-img";
          img.alt = "";
          img.loading = "lazy";
          img.decoding = "async";
          img.referrerPolicy = "no-referrer";
          img.src = h.icon_url;
          dotsEl.appendChild(img);
        } else {
          const span = document.createElement("span");
          span.className = "icon-emoji";
          span.textContent = h.emoji || "✅";
          dotsEl.appendChild(span);
        }
      }
    });

    // After DOM updates, compute sizing vars (and keep it responsive)
    requestAnimationFrame(applyIconSizingVars);
  }

  // -----------------------------
  // Supabase direct CRUD
  // -----------------------------
  async function loadHabits() {
    const { data, error } = await sb
      .from("habits")
      .select("id,title,emoji,icon,color,period_unit,period_value,target_count,frequency_days,is_active,created_at")
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (error) throw error;

    state.habits = (data || []).map((h) => ({
      ...h,
      emoji: h.emoji || h.icon || "✅",
      color: h.color || "#FF9500",
      period_unit: h.period_unit || "day",
      period_value: h.period_value || 1,
      target_count: h.target_count || 1,
    }));
  }

  async function loadLogsForMonth() {
    const [startISO, endISO] = monthRange(state.year, state.month);

    const { data, error } = await sb
      .from("habit_logs")
      .select("check_date,habit_id")
      .gte("check_date", startISO)
      .lt("check_date", endISO)
      .order("check_date", { ascending: true });

    if (error) throw error;

    const map = {};
    for (const r of (data || [])) {
      const d = r.check_date;
      if (!map[d]) map[d] = [];
      map[d].push(r.habit_id);
    }
    state.logsByDate = map;
  }

  async function reloadAll() {
    await loadHabits();
    await loadLogsForMonth();
    renderDots();
  }

  // -----------------------------
  // Habit / Log modals
  // -----------------------------
  function renderHabitChecklist(date) {
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

  async function onClickDay(dayNum) {
    if (!state.session) return;
    const date = isoDate(state.year, state.month, dayNum);
    state.activeDate = date;
    $("#modalDateTitle").textContent = date;
    renderHabitChecklist(date);
    openModal("#checkModal");
  }

  async function saveLogsForActiveDate() {
    if (!state.session || !state.activeDate) return;

    const userId = state.session.user.id;
    const date = state.activeDate;

    const incoming = new Set(gatherCheckedHabitIds());
    const existing = new Set(state.logsByDate[date] || []);

    const toDelete = [...existing].filter((x) => !incoming.has(x));
    const toUpsert = [...incoming];

    if (toDelete.length) {
      const { error } = await sb
        .from("habit_logs")
        .delete()
        .eq("check_date", date)
        .eq("user_id", userId)
        .in("habit_id", toDelete);

      if (error) throw error;
    }

    if (toUpsert.length) {
      const payload = toUpsert.map((hid) => ({ habit_id: hid, check_date: date, user_id: userId }));
      const { error } = await sb
        .from("habit_logs")
        .upsert(payload, { onConflict: "habit_id,check_date" });

      if (error) throw error;
    }

    state.logsByDate[date] = [...incoming];
    renderDots();
    closeAllModals();
  }

  async function createHabit() {
  if (!state.session) return;

  const userId = state.session.user.id;

  const title = (q("#habitTitle")?.value || "").trim();
  const emoji = (q("#habitIcon")?.value || "✅").trim() || "✅";

  // index.html에는 상세 옵션 UI가 없어서, DB 컬럼 기본값으로 박는다.
  const payload = {
    user_id: userId,
    title,
    emoji,
    icon: emoji, // icon NOT NULL 대응
    color: "#FF9500",
    period_unit: "day",
    period_value: 1,
    target_count: 1,
    frequency_days: 1,
    is_active: true,
  };

  if (!title) { alert("제목부터 써라."); return; }

  const { error } = await sb.from("habits").insert(payload);
  if (error) throw error;

  const titleEl = q("#habitTitle");
  if (titleEl) titleEl.value = "";
  closeAllModals();
  await reloadAll();
}

// -----------------------------
// Month nav
  // -----------------------------
  async function gotoPrevMonth() {
    if (state.month === 1) { state.month = 12; state.year -= 1; }
    else state.month -= 1;
    renderCalendarGrid();
    if (state.session) await reloadAll();
  }

  async function gotoNextMonth() {
    if (state.month === 12) { state.month = 1; state.year += 1; }
    else state.month += 1;
    renderCalendarGrid();
    if (state.session) await reloadAll();
  }

  // -----------------------------
  // Bind UI
  // -----------------------------
  function bindUI() {
    $$(".modal [data-close='1']").forEach((el) => el.addEventListener("click", () => closeAllModals()));

    on("#btnSettings", "click", () => openModal("#settingsModal"));
    on("#btnOpenProgress", "click", () => { closeAllModals(); openModal("#progressModal"); });

    onAny(["#btnSaveDay","#btnSave"], "click", () => {
      saveLogsForActiveDate().catch((e) => {
        console.error(e);
        alert("저장 실패. 콘솔 보자.");
      });
    });

    onAny(["#btnOpenHabit","#btnAddHabit","#btnAddGoal","#btnAdd","#btnAddTarget"], "click", () => { closeAllModals(); openModal("#habitModal"); });

    on("#btnCreateHabit", "click", () => {
      createHabit().catch((e) => {
        console.error(e);
        alert("목표 추가 실패. 콘솔 보자.");
      });
    });

    $("#btnPrev").addEventListener("click", () => {
      gotoPrevMonth().catch((e) => { console.error(e); alert("이동 실패"); });
    });

    $("#btnNext").addEventListener("click", () => {
      gotoNextMonth().catch((e) => { console.error(e); alert("이동 실패"); });
    });
  }

  async function afterLogin() {
    const ok = await ensureAuthedOrShowLogin();
    if (!ok) return;
    await reloadAll();
  }

  // -----------------------------
  // Boot
  // -----------------------------
  async function main() {
    initYearMonth();
    bindLogin();
    bindUI();
    renderCalendarGrid();

    const ok = await ensureAuthedOrShowLogin();
    if (!ok) return;
    await reloadAll();
  }

  document.addEventListener("DOMContentLoaded", () => {

    // Responsive sizing (cell width -> icon sizes / row min height)
    try {
      const grid = pick("#calendarGrid","#calGrid");
      if (grid && "ResizeObserver" in window) {
        const ro = new ResizeObserver(() => applyIconSizingVars());
        ro.observe(grid);
      }
      window.addEventListener("orientationchange", () => setTimeout(applyIconSizingVars, 150));
      window.addEventListener("resize", () => applyIconSizingVars(), { passive: true });
    } catch {}
    main().catch((e) => {
      console.error(e);
      alert("초기화 실패. 콘솔 보자.");
    });
  });
})();

})();
