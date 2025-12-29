/* global supabase */
(() => {
  const { createClient } = supabase;

  const SUPABASE_URL = window.__SUPABASE_URL__;
  const SUPABASE_ANON_KEY = window.__SUPABASE_ANON_KEY__;
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const THEME_DEFAULT_BG = "#f6f7fb";
  const THEME_DEFAULT_TEXT = "#111111";
  const THEME_KEY_BG = "theme_bg";
  const THEME_KEY_TEXT = "theme_text";

  const state = {
    session: null,
    year: null,
    month: null,
    habits: [],
    logsByDate: {},
    activeDate: null,
    holidaySet: new Set(),
    holidayYearLoaded: null,
    themeBg: THEME_DEFAULT_BG,
    themeText: THEME_DEFAULT_TEXT,
  };

  // ---------- color utils ----------
  function clamp01(x){ return Math.min(1, Math.max(0, x)); }
  function hexToRgb(hex){
    const h = String(hex || "").replace("#","").trim();
    if (h.length === 3){
      const r = parseInt(h[0]+h[0], 16);
      const g = parseInt(h[1]+h[1], 16);
      const b = parseInt(h[2]+h[2], 16);
      return {r,g,b};
    }
    if (h.length === 6){
      const r = parseInt(h.slice(0,2), 16);
      const g = parseInt(h.slice(2,4), 16);
      const b = parseInt(h.slice(4,6), 16);
      return {r,g,b};
    }
    return {r:17,g:17,b:17};
  }
  function rgbToHex({r,g,b}){
    const to = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2,"0");
    return "#" + to(r) + to(g) + to(b);
  }
  function mix(a,b,t){
    t = clamp01(t);
    return { r: a.r + (b.r-a.r)*t, g: a.g + (b.g-a.g)*t, b: a.b + (b.b-a.b)*t };
  }
  function rgba({r,g,b}, a){
    a = clamp01(a);
    return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
  }
  function luminance({r,g,b}){
    // relative luminance (sRGB)
    const f = (c) => {
      c /= 255;
      return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4);
    };
    const R = f(r), G = f(g), B = f(b);
    return 0.2126*R + 0.7152*G + 0.0722*B;
  }

  // -----------------------------
  // Theme (apply to whole UI, not only title)
  // -----------------------------
  function applyTheme(bgHex, textHex) {
    const bg = (bgHex || THEME_DEFAULT_BG).trim();
    const text = (textHex || THEME_DEFAULT_TEXT).trim();

    state.themeBg = bg;
    state.themeText = text;

    const bgRgb = hexToRgb(bg);
    const textRgb = hexToRgb(text);
    const isDarkBg = luminance(bgRgb) < 0.35;

    // Surfaces: slightly lifted from bg
    const lift = isDarkBg ? 0.10 : 0.35; // move toward white
    const lift2 = isDarkBg ? 0.06 : 0.22;
    const white = {r:255,g:255,b:255};

    const surface = mix(bgRgb, white, lift);
    const surface2 = mix(bgRgb, white, lift2);

    // Day split: top a touch stronger (toward text), bottom a touch more airy (toward bg)
    const cellTop = mix(surface, textRgb, isDarkBg ? 0.10 : 0.06);
    const cellBottom = mix(surface, bgRgb, isDarkBg ? 0.25 : 0.35);

    // Borders/muted derived from text color
    const border = rgba(textRgb, isDarkBg ? 0.18 : 0.10);
    const border2 = rgba(textRgb, isDarkBg ? 0.26 : 0.16);
    const muted = rgba(textRgb, isDarkBg ? 0.72 : 0.55);

    // Shadow
    const shadow = isDarkBg ? "0 10px 26px rgba(0,0,0,0.35)" : "0 8px 22px rgba(0,0,0,0.06)";

    // Apply CSS vars
    const root = document.documentElement;
    root.style.setProperty("--bg", bg);
    root.style.setProperty("--text", text);
    root.style.setProperty("--surface", rgbToHex(surface));
    root.style.setProperty("--surface2", rgbToHex(surface2));
    root.style.setProperty("--cell-top", rgbToHex(cellTop));
    root.style.setProperty("--cell-bottom", rgbToHex(cellBottom));
    root.style.setProperty("--border", border);
    root.style.setProperty("--border2", border2);
    root.style.setProperty("--muted", muted);
    root.style.setProperty("--shadow", shadow);

    // Also tune gear icon fill via currentColor? easiest: set to text color alpha
    root.style.setProperty("--gear", rgba(textRgb, isDarkBg ? 0.85 : 0.72));

    try {
      localStorage.setItem(THEME_KEY_BG, bg);
      localStorage.setItem(THEME_KEY_TEXT, text);
    } catch (_) {}
  }

  function loadTheme() {
    let bg = THEME_DEFAULT_BG;
    let text = THEME_DEFAULT_TEXT;
    try {
      const b = localStorage.getItem(THEME_KEY_BG);
      const t = localStorage.getItem(THEME_KEY_TEXT);
      if (b && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(b)) bg = b;
      if (t && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(t)) text = t;
    } catch (_) {}
    applyTheme(bg, text);
  }

  // -----------------------------
  // Holidays (KR) - best effort
  // -----------------------------
  async function ensureHolidays(year) {
    if (state.holidayYearLoaded === year && state.holidaySet.size) return;

    const cacheKey = `holidays_kr_${year}`;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const arr = JSON.parse(cached);
        state.holidaySet = new Set(arr);
        state.holidayYearLoaded = year;
        return;
      }
    } catch (_) {}

    try {
      const url = `https://date.nager.at/api/v3/PublicHolidays/${year}/KR`;
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const dates = (data || []).map((x) => x?.date).filter((x) => typeof x === "string");
      state.holidaySet = new Set(dates);
      state.holidayYearLoaded = year;
      try { localStorage.setItem(cacheKey, JSON.stringify(dates)); } catch (_) {}
    } catch (_) {
      state.holidaySet = new Set();
      state.holidayYearLoaded = year;
    }
  }

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
    const loginCard = $("#loginCard");
    const appShell = $("#appShell");

    if (!sess) {
      loginCard.classList.remove("hidden");
      appShell.classList.add("hidden");
      return false;
    }

    loginCard.classList.add("hidden");
    appShell.classList.remove("hidden");

    const email = sess.user?.email || "-";
    const emailEl = $("#settingsEmail");
    if (emailEl) emailEl.textContent = email;

    return true;
  }

  function bindAuthUI() {
    $("#btnSignIn").addEventListener("click", async () => {
      $("#msg").textContent = "";
      const email = ($("#email").value || "").trim();
      const password = $("#password").value || "";

      if (!email || !password) {
        $("#msg").textContent = "이메일/비번부터 넣어.";
        return;
      }

      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) { $("#msg").textContent = error.message; return; }
      await afterLogin();
    });

    $("#btnSignUp").addEventListener("click", () => {
      const currentEmail = ($("#email").value || "").trim();
      $("#signupMsg").textContent = "";
      $("#signupEmail").value = currentEmail || "";
      $("#signupPassword").value = "";
      $("#signupPassword2").value = "";
      openModal("#signupModal");
      setTimeout(() => $("#signupEmail")?.focus(), 0);
    });

    $("#btnDoSignUp").addEventListener("click", async () => {
      $("#signupMsg").textContent = "";
      const email = ($("#signupEmail").value || "").trim();
      const password = $("#signupPassword").value || "";
      const password2 = $("#signupPassword2").value || "";

      if (!email || !password || !password2) { $("#signupMsg").textContent = "메일/비번/비번확인까지 다 넣어."; return; }
      if (password.length < 6) { $("#signupMsg").textContent = "비번은 6자 이상으로."; return; }
      if (password !== password2) { $("#signupMsg").textContent = "비번이랑 비번확인이 안 맞는다."; return; }

      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) { $("#signupMsg").textContent = error.message; return; }

      if (data?.session) {
        closeAllModals();
        await afterLogin();
        return;
      }

      $("#signupMsg").textContent = "가입은 됐는데 세션이 없다. Confirm email OFF 확인. 일단 로그인 눌러.";
      $("#email").value = email;
      $("#password").value = "";
    });
  }

  // -----------------------------
  // Modal helpers
  // -----------------------------
  function openModal(sel){ const el = $(sel); if (el) el.classList.remove("hidden"); }
  function closeAllModals(){ $$(".modal").forEach((m) => m.classList.add("hidden")); }

  // -----------------------------
  // Settings UI
  // -----------------------------
  function bindSettingsUI() {
    $("#btnSettings").addEventListener("click", async () => {
      await refreshSession();
      const email = state.session?.user?.email || "-";
      const emailEl = $("#settingsEmail");
      if (emailEl) emailEl.textContent = email;

      $("#themeBg").value = state.themeBg || THEME_DEFAULT_BG;
      $("#themeText").value = state.themeText || THEME_DEFAULT_TEXT;
      openModal("#settingsModal");
    });

    $("#themeBg").addEventListener("input", (e) => applyTheme(e.target.value, state.themeText));
    $("#themeText").addEventListener("input", (e) => applyTheme(state.themeBg, e.target.value));

    $("#btnThemeReset").addEventListener("click", () => {
      applyTheme(THEME_DEFAULT_BG, THEME_DEFAULT_TEXT);
      $("#themeBg").value = THEME_DEFAULT_BG;
      $("#themeText").value = THEME_DEFAULT_TEXT;
    });

    $("#btnOpenHabit").addEventListener("click", () => {
      closeAllModals();
      $("#habitMsg").textContent = "";
      openModal("#habitModal");
      setTimeout(() => $("#habitTitle")?.focus(), 0);
    });

    $("#btnLogout").addEventListener("click", async () => {
      await sb.auth.signOut();
      closeAllModals();
      await ensureAuthedOrShowLogin();
    });
  }

  // -----------------------------
  // Calendar render
  // -----------------------------
  function initYearMonth() {
    const now = new Date();
    state.year = now.getFullYear();
    state.month = now.getMonth() + 1;
  }

  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDate = (y,m,d) => `${y}-${pad2(m)}-${pad2(d)}`;

  function monthRange(y, m) {
    const start = `${y}-${pad2(m)}-01`;
    const end = m === 12 ? `${y + 1}-01-01` : `${y}-${pad2(m + 1)}-01`;
    return [start, end];
  }

  function setHeader() {
    $("#yearLabel").textContent = String(state.year);
    $("#ymTitle").textContent = `${state.month}월`;
  }

  function markTodaySelectedHoliday() {
    const now = new Date();
    const ty = now.getFullYear();
    const tm = now.getMonth() + 1;
    const td = now.getDate();

    $$("#calGrid .day").forEach((cell) => {
      if (cell.classList.contains("empty")) return;
      const dayNum = parseInt(cell.getAttribute("data-day"), 10);
      const date = isoDate(state.year, state.month, dayNum);
      cell.classList.toggle("today", ty === state.year && tm === state.month && dayNum === td);
      cell.classList.toggle("selected", state.activeDate === date);
      cell.classList.toggle("holiday", state.holidaySet.has(date));
    });
  }

  function renderCalendarGrid() {
    setHeader();
    const grid = $("#calGrid");
    grid.innerHTML = "";

    const y = state.year;
    const m = state.month;

    const first = new Date(y, m - 1, 1);
    const firstDow = first.getDay();
    const lastDay = new Date(y, m, 0).getDate();

    for (let i = 0; i < 42; i++) {
      const cell = document.createElement("div");
      const dayNum = i - firstDow + 1;

      if (dayNum < 1 || dayNum > lastDay) {
        cell.className = "day empty";
        grid.appendChild(cell);
        continue;
      }

      const dow = new Date(y, m - 1, dayNum).getDay();
      cell.className = "day";
      if (dow === 0) cell.classList.add("sun");
      if (dow === 6) cell.classList.add("sat");
      cell.setAttribute("data-day", String(dayNum));

      const top = document.createElement("div");
      top.className = "day-num";
      top.textContent = String(dayNum);

      const emojis = document.createElement("div");
      emojis.className = "day-dots";
      emojis.setAttribute("data-date", isoDate(y, m, dayNum));

      cell.appendChild(top);
      cell.appendChild(emojis);
      cell.addEventListener("click", () => onClickDay(dayNum));
      grid.appendChild(cell);
    }

    renderEmojis();
    markTodaySelectedHoliday();
  }

  function getEmojiByHabitId(habitId) {
    const h = state.habits.find((x) => x.id === habitId);
    return (h?.emoji || "✅").trim() || "✅";
  }

  function renderEmojis() {
    $$(".day-dots").forEach((el) => {
      el.className = "day-dots";
      const date = el.getAttribute("data-date");
      const ids = state.logsByDate[date] || [];
      if (!ids.length) { el.innerHTML = ""; return; }

      const uniq = Array.from(new Set(ids));
      const emojis = uniq.map(getEmojiByHabitId);
      const clamp = Math.min(Math.max(emojis.length, 1), 15);
      el.classList.add(`emoji-count-${clamp}`);
      el.innerHTML = emojis.map((e) => `<span class="e" aria-hidden="true">${escapeHtml(e)}</span>`).join("");
    });
  }

  // -----------------------------
  // Supabase CRUD
  // -----------------------------
  async function loadHabits() {
    const { data, error } = await sb
      .from("habits")
      .select("id,title,emoji,icon,is_active,created_at")
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (error) throw error;

    state.habits = (data || []).map((h) => ({
      id: h.id,
      title: h.title,
      emoji: (h.emoji || h.icon || "✅").trim() || "✅",
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
    await ensureHolidays(state.year);
    await loadHabits();
    await loadLogsForMonth();
    renderEmojis();
    markTodaySelectedHoliday();
  }

  // -----------------------------
  // Checklist modal
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
    markTodaySelectedHoliday();
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
    renderEmojis();
    markTodaySelectedHoliday();
    closeAllModals();
  }

  async function createHabit() {
    if (!state.session) return;

    const userId = state.session.user.id;
    const title = ($("#habitTitle").value || "").trim();
    const emoji = ($("#habitIcon").value || "💪").trim() || "💪";

    if (!title) {
      $("#habitMsg").textContent = "목표 이름부터 써라.";
      return;
    }

    const payload = { user_id: userId, title, emoji, icon: emoji, color: state.themeText || "#111111", is_active: true };
    const { error } = await sb.from("habits").insert(payload);
    if (error) throw error;

    $("#habitTitle").value = "";
    $("#habitMsg").textContent = "";
    closeAllModals();
    await reloadAll();
  }

  // Month nav
  async function gotoPrevMonth() {
    if (state.month === 1) { state.month = 12; state.year -= 1; } else state.month -= 1;
    await ensureHolidays(state.year);
    renderCalendarGrid();
    if (state.session) await reloadAll();
  }
  async function gotoNextMonth() {
    if (state.month === 12) { state.month = 1; state.year += 1; } else state.month += 1;
    await ensureHolidays(state.year);
    renderCalendarGrid();
    if (state.session) await reloadAll();
  }

  // Bind UI
  function bindUI() {
    $$(".modal [data-close='1']").forEach((el) => el.addEventListener("click", () => closeAllModals()));

    $("#btnSaveDay").addEventListener("click", () => {
      saveLogsForActiveDate().catch((e) => { console.error(e); alert("저장 실패. 콘솔 보자."); });
    });

    $("#btnCreateHabit").addEventListener("click", () => {
      createHabit().catch((e) => { console.error(e); alert("목표 추가 실패. 콘솔 보자."); });
    });

    $("#btnPrev").addEventListener("click", () => gotoPrevMonth().catch((e) => { console.error(e); alert("이동 실패"); }));
    $("#btnNext").addEventListener("click", () => gotoNextMonth().catch((e) => { console.error(e); alert("이동 실패"); }));
  }

  async function afterLogin() {
    const ok = await ensureAuthedOrShowLogin();
    if (!ok) return;
    await ensureHolidays(state.year);
    renderCalendarGrid();
    await reloadAll();
  }

  async function main() {
    loadTheme(); // login before too
    initYearMonth();
    bindAuthUI();
    bindSettingsUI();
    bindUI();

    await ensureHolidays(state.year);
    renderCalendarGrid();

    const ok = await ensureAuthedOrShowLogin();
    if (!ok) return;
    await reloadAll();
  }

  document.addEventListener("DOMContentLoaded", () => {
    main().catch((e) => { console.error(e); alert("초기화 실패. 콘솔 보자."); });
  });
})();
