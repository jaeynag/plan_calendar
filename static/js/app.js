/* global supabase, Cropper */
(() => {
  const { createClient } = supabase;

  const SUPABASE_URL = window.__SUPABASE_URL__;
  const SUPABASE_ANON_KEY = window.__SUPABASE_ANON_KEY__;
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // ✅ 버킷 이름: 사용자 말대로 habit_icon
  const ICON_BUCKET = "habit_icons";

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

    // photo/crop
    pendingPhotoBlob: null,
    cropper: null,
    cropObjectUrl: null,
    bucketOk: null, // true/false/unknown
  };

  // ---------- HTML escape ----------
  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  // ---------- date utils ----------
  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDate = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;

  function toDateOnlyStr(d) {
    return isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  function parseYmd(ymd) {
    const [y, m, d] = String(ymd).split("-").map((x) => parseInt(x, 10));
    return new Date(y, (m || 1) - 1, d || 1);
  }
  function daysInclusive(startYmd, endYmd) {
    const a = parseYmd(startYmd);
    const b = parseYmd(endYmd);
    const ms = 24 * 60 * 60 * 1000;
    const diff = Math.floor((b.getTime() - a.getTime()) / ms);
    return Math.max(1, diff + 1);
  }

  // ---------- color utils ----------
  function clamp01(x) { return Math.min(1, Math.max(0, x)); }
  function hexToRgb(hex) {
    const h = String(hex || "").replace("#", "").trim();
    if (h.length === 3) {
      return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16) };
    }
    if (h.length === 6) {
      return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
    }
    return { r: 17, g: 17, b: 17 };
  }
  function rgbToHex({ r, g, b }) {
    const to = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
    return "#" + to(r) + to(g) + to(b);
  }
  function mix(a, b, t) {
    t = clamp01(t);
    return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
  }
  function rgba({ r, g, b }, a) {
    a = clamp01(a);
    return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
  }
  function luminance({ r, g, b }) {
    const f = (c) => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const R = f(r), G = f(g), B = f(b);
    return 0.2126 * R + 0.7152 * G + 0.0722 * B;
  }

  // -----------------------------
  // Theme
  // -----------------------------
  function applyTheme(bgHex, textHex) {
    const bg = (bgHex || THEME_DEFAULT_BG).trim();
    const text = (textHex || THEME_DEFAULT_TEXT).trim();

    state.themeBg = bg;
    state.themeText = text;

    const bgRgb = hexToRgb(bg);
    const textRgb = hexToRgb(text);
    const isDarkBg = luminance(bgRgb) < 0.35;

    const white = { r: 255, g: 255, b: 255 };
    const surface = mix(bgRgb, white, isDarkBg ? 0.10 : 0.35);
    const surface2 = mix(bgRgb, white, isDarkBg ? 0.06 : 0.22);
    const cellTop = mix(surface, textRgb, isDarkBg ? 0.10 : 0.06);
    const cellBottom = mix(surface, bgRgb, isDarkBg ? 0.25 : 0.35);

    const border = rgba(textRgb, isDarkBg ? 0.18 : 0.10);
    const border2 = rgba(textRgb, isDarkBg ? 0.26 : 0.16);
    const muted = rgba(textRgb, isDarkBg ? 0.72 : 0.55);
    const shadow = isDarkBg ? "0 10px 26px rgba(0,0,0,0.35)" : "0 8px 22px rgba(0,0,0,0.06)";

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

    try {
      localStorage.setItem(THEME_KEY_BG, bg);
      localStorage.setItem(THEME_KEY_TEXT, text);
    } catch (_) { }
  }

  function loadTheme() {
    let bg = THEME_DEFAULT_BG;
    let text = THEME_DEFAULT_TEXT;
    try {
      const b = localStorage.getItem(THEME_KEY_BG);
      const t = localStorage.getItem(THEME_KEY_TEXT);
      if (b && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(b)) bg = b;
      if (t && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(t)) text = t;
    } catch (_) { }
    applyTheme(bg, text);
  }

  // -----------------------------
  // Holidays (KR)
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
    } catch (_) { }

    try {
      const url = `https://date.nager.at/api/v3/PublicHolidays/${year}/KR`;
      const res = await fetch(url);
      if (!res.ok) throw new Error();
      const data = await res.json();
      const dates = (data || []).map((x) => x?.date).filter((x) => typeof x === "string");
      state.holidaySet = new Set(dates);
      state.holidayYearLoaded = year;
      try { localStorage.setItem(cacheKey, JSON.stringify(dates)); } catch (_) { }
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

    $("#settingsEmail").textContent = sess.user?.email || "-";
    return true;
  }

  // -----------------------------
  // Modal helpers
  // -----------------------------
  function openModal(sel) { const el = $(sel); if (el) el.classList.remove("hidden"); }
  function closeAllModals() { $$(".modal").forEach((m) => m.classList.add("hidden")); }
  function isOpenModal(sel) { const el = $(sel); return !!(el && !el.classList.contains("hidden")); }

  // -----------------------------
  // Auth UI
  // -----------------------------
  function bindAuthUI() {
    $("#btnSignIn").addEventListener("click", async () => {
      $("#msg").textContent = "";
      const email = ($("#email").value || "").trim();
      const password = $("#password").value || "";
      if (!email || !password) { $("#msg").textContent = "이메일/비번부터 넣어."; return; }

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
  // Settings UI
  // -----------------------------
  function bindSettingsUI() {
    $("#btnSettings").addEventListener("click", async () => {
      await refreshSession();
      $("#settingsEmail").textContent = state.session?.user?.email || "-";
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
      resetHabitIconUI();
      $("#habitMsg").textContent = "";
      openModal("#habitModal");
      renderHabitManageList();
setTimeout(() => $("#habitTitle")?.focus(), 0);
    });

    $("#btnOpenProgress").addEventListener("click", async () => {
      closeAllModals();
      await openProgress();
    });

    $("#btnLogout").addEventListener("click", async () => {
      await sb.auth.signOut();
      closeAllModals();
      await ensureAuthedOrShowLogin();
    });
  }

  // -----------------------------
  // Progress
  // -----------------------------
  async function openProgress() {
    $("#progressMsg").textContent = "";
    $("#progressList").innerHTML = "";

    if (!state.session) {
      $("#progressMsg").textContent = "로그인부터 해.";
      openModal("#progressModal");
      return;
    }

    try {
      const { data: habits, error: he } = await sb
        .from("habits")
        .select("id,title,emoji,icon,icon_url,start_date,created_at,is_active")
        .eq("is_active", true)
        .order("created_at", { ascending: true });
      if (he) throw he;

      const list = (habits || []).map((h) => ({
        id: h.id,
        title: h.title,
        emoji: (h.emoji || h.icon || "✅").trim() || "✅",
        icon_url: h.icon_url || null,
        start_date: h.start_date || (h.created_at ? String(h.created_at).slice(0, 10) : null),
      }));

      if (!list.length) {
        $("#progressMsg").textContent = "목표가 없다. 목표부터 추가해.";
        openModal("#progressModal");
        return;
      }

      const today = toDateOnlyStr(new Date());
      const minStart = list
        .map((h) => h.start_date)
        .filter(Boolean)
        .sort()[0] || today;

      const { data: logs, error: le } = await sb
        .from("habit_logs")
        .select("habit_id,check_date")
        .gte("check_date", minStart)
        .lte("check_date", today);
      if (le) throw le;

      const counts = new Map();
      for (const r of (logs || [])) {
        const hid = r.habit_id;
        counts.set(hid, (counts.get(hid) || 0) + 1);
      }

      const wrap = $("#progressList");
      wrap.innerHTML = "";
      for (const h of list) {
        const start = h.start_date || today;
        const totalDays = daysInclusive(start, today);
        const done = counts.get(h.id) || 0;

        const row = document.createElement("div");
        row.className = "progress-row";

        const left = document.createElement("div");
        left.className = "progress-left";

        const iconWrap = document.createElement("div");
        iconWrap.className = "habit-icon";
        if (h.icon_url) {
          const img = document.createElement("img");
          img.src = h.icon_url;
          img.alt = "";
          iconWrap.appendChild(img);
        } else {
          const span = document.createElement("span");
          span.className = "icon-emoji";
          span.textContent = h.emoji;
          iconWrap.appendChild(span);
        }

        const title = document.createElement("div");
        title.className = "progress-title";
        title.textContent = h.title;

        left.appendChild(iconWrap);
        left.appendChild(title);

        const right = document.createElement("div");
        right.className = "progress-right";

        const count = document.createElement("div");
        count.className = "progress-count";
        count.textContent = `${done} / ${totalDays}`;

        const sub = document.createElement("div");
        sub.className = "progress-sub";
        sub.textContent = `${start} ~ ${today}`;

        right.appendChild(count);
        right.appendChild(sub);

        row.appendChild(left);
        row.appendChild(right);

        wrap.appendChild(row);
      }

      openModal("#progressModal");
    } catch (e) {
      console.error(e);
      $("#progressMsg").textContent = "진행상황 불러오다 터졌다. 콘솔 봐.";
      openModal("#progressModal");
    }
  }

  // -----------------------------
  // Calendar
  // -----------------------------
  function initYearMonth() {
    const now = new Date();
    state.year = now.getFullYear();
    state.month = now.getMonth() + 1;
  }

  function monthRange(y, m) {
    const start = `${y}-${pad2(m)}-01`;
    const end = m === 12 ? `${y + 1}-01-01` : `${y}-${pad2(m + 1)}-01`;
    return [start, end];
  }

  function setHeader() {
    $("#yearLabel").textContent = String(state.year);
    $("#ymTitle").textContent = `${state.month}월`;
  }

  function computeWeeksInMonth(y, m) {
    const first = new Date(y, m - 1, 1);
    const firstDow = first.getDay();
    const lastDay = new Date(y, m, 0).getDate();
    const cells = firstDow + lastDay;
    return Math.ceil(cells / 7);
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

  

function calcIconSize(count, cellW) {
  // cellW: .day 카드의 실제 너비(px)
  const root = getComputedStyle(document.documentElement);
  const iconGap = parseInt(root.getPropertyValue("--icon-gap")) || 2;

  // .day padding(좌/우) 반영 (기본 3~4px, 안전하게 8px 정도 여유)
  const innerW = Math.max(10, Math.floor(cellW - 8));

  if (count <= 1) {
    // 1개: 칸 너비에 최대한 꽉 차게
    return Math.min(46, innerW);
  }
  if (count === 2) {
    // 2개: 위/아래로 큼지막하게
    return Math.min(34, innerW);
  }
  // 3개 이상: 2열 래핑이므로 반으로 쪼갬
  return Math.min(22, Math.max(14, Math.floor((innerW - iconGap) / 2)));
}

function applyUniformRowHeight(weeks) {
  const grid = $("#calGrid");
  const anyDay = grid.querySelector(".day:not(.empty)");
  if (!anyDay) return;

  const dayStyle = getComputedStyle(anyDay);
  const padTop = parseFloat(dayStyle.paddingTop) || 0;
  const padBottom = parseFloat(dayStyle.paddingBottom) || 0;
  const gap = parseFloat(dayStyle.gap) || 0;

  const root = getComputedStyle(document.documentElement);
  const iconGap = parseInt(root.getPropertyValue("--icon-gap")) || 2;

  const cellW = anyDay.getBoundingClientRect().width;
  const size2 = calcIconSize(2, cellW);

  // day-num은 CSS에서 height:14px로 고정(없으면 14로 가정)
  const dayNumH = 14;

  // 2개(세로2개) 기준으로 모든 주 높이를 통일
  const iconAreaH = (size2 * 2) + iconGap + 3;
  const rowH = Math.ceil(padTop + padBottom + dayNumH + gap + iconAreaH + 2); // +2 buffer

  grid.style.gridTemplateRows = `repeat(${weeks}, ${rowH}px)`;
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

    const weeks = computeWeeksInMonth(y, m);
    const totalCells = weeks * 7;

    grid.style.gridTemplateRows = `repeat(${weeks}, auto)`;
for (let i = 0; i < totalCells; i++) {
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

      const icons = document.createElement("div");
      icons.className = "day-dots";
      icons.setAttribute("data-date", isoDate(y, m, dayNum));

      cell.appendChild(top);
      cell.appendChild(icons);
      cell.addEventListener("click", () => onClickDay(dayNum));
      grid.appendChild(cell);
    }

    renderIcons();
    applyUniformRowHeight(weeks);
    markTodaySelectedHoliday();
  }

  function getHabitById(habitId) {
    return state.habits.find((x) => x.id === habitId) || null;
  }

  function renderIcons() {
    $$(".day-dots").forEach((el) => {
      el.className = "day-dots";
      const date = el.getAttribute("data-date");
      const ids = state.logsByDate[date] || [];
      if (!ids.length) { el.innerHTML = ""; return; }

      const uniqIds = Array.from(new Set(ids));
      const shown = uniqIds.slice(0, 6); // 2열 * 3줄

// 개수별 클래스(레이아웃/센터링용)
if (shown.length === 1) el.classList.add("single");
else if (shown.length === 2) el.classList.add("double");
else el.classList.add("multi");

// 개수별 아이콘 사이즈: 1개는 꽉, 2개는 큼직, 3개부터는 2열 래핑
const dayEl = el.closest(".day");
const cellW = dayEl ? dayEl.getBoundingClientRect().width : 40;

const size = calcIconSize(shown.length, cellW);
el.style.setProperty("--icon-size", `${size}px`);

// 2줄까지만 허용해서 3번째부터 오른쪽으로 넘어가게(1·3 / 2·4)
const root = getComputedStyle(document.documentElement);
const iconGap = parseInt(root.getPropertyValue("--icon-gap")) || 2;
el.style.setProperty("--icon-area-limit", `${(size * 2) + iconGap + 3}px`);

// 1개일 때는 중앙에 딱 보이게
if (shown.length === 1) {
  el.style.maxHeight = "none";
} else {
  el.style.maxHeight = "var(--icon-area-limit)";
}


      const parts = [];
      for (const hid of shown) {
        const h = getHabitById(hid);
        if (h?.icon_url) {
          parts.push(`<img class="icon-img" src="${escapeHtml(h.icon_url)}" alt="" />`);
        } else {
          const emo = (h?.emoji || "✅").trim() || "✅";
          parts.push(`<span class="icon-emoji" aria-hidden="true">${escapeHtml(emo)}</span>`);
        }
      }
      el.innerHTML = parts.join("");
    });
  }

  // -----------------------------
  // Supabase CRUD
  // -----------------------------
  async function loadHabits() {
    const { data, error } = await sb
      .from("habits")
      .select("id,title,emoji,icon,icon_url,start_date,created_at,is_active")
      .eq("is_active", true)
      .order("created_at", { ascending: true });
    if (error) throw error;

    state.habits = (data || []).map((h) => ({
      id: h.id,
      title: h.title,
      emoji: (h.emoji || h.icon || "✅").trim() || "✅",
      icon_url: h.icon_url || null,
      start_date: h.start_date || (h.created_at ? String(h.created_at).slice(0, 10) : null),
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
    renderIcons();
    markTodaySelectedHoliday();
      if (isOpenModal("#habitModal")) renderHabitManageList();
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

      const iconWrap = document.createElement("span");
      iconWrap.className = "habit-icon";

      if (h.icon_url) {
        const img = document.createElement("img");
        img.src = h.icon_url;
        img.alt = "";
        iconWrap.appendChild(img);
      } else {
        const emo = document.createElement("span");
        emo.className = "icon-emoji";
        emo.textContent = h.emoji;
        iconWrap.appendChild(emo);
      }

      const title = document.createElement("span");
      title.className = "habit-title";
      title.textContent = h.title;

      left.appendChild(iconWrap);
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
    renderIcons();
    markTodaySelectedHoliday();
    closeAllModals();
  }

  // -----------------------------
  // Storage: bucket check
  // -----------------------------
  async function checkIconBucket() {
    // 정확히 "존재한다/없다"를 100% 확정하기 어렵다(정책/퍼미션 영향).
    // 그래도 흔한 오류 메시지로 구분해서 UX 개선.
    try {
      const userId = state.session?.user?.id;
      if (!userId) { state.bucketOk = null; return; }
      const { error } = await sb.storage.from(ICON_BUCKET).list(userId, { limit: 1 });
      if (error) {
        const m = (error.message || "").toLowerCase();
        if (m.includes("bucket not found") || m.includes("no such bucket")) state.bucketOk = false;
        else state.bucketOk = null; // 권한 문제일 수도
        return;
      }
      state.bucketOk = true;
    } catch (_) {
      state.bucketOk = null;
    }
  }

  function prettyStorageError(e) {
    const msg = (e && (e.message || e.error_description || e.toString())) || "unknown";
    const lower = msg.toLowerCase();

    if (lower.includes("bucket not found") || lower.includes("no such bucket")) {
      return `버킷(${ICON_BUCKET}) 못 찾는다. Supabase Storage에 버킷 이름 정확히 확인해.`;
    }
    if (lower.includes("row level security") || lower.includes("rls") || lower.includes("permission")) {
      return "Storage RLS에 막혔다. storage.objects INSERT/SELECT 정책 필요.";
    }
    if (lower.includes("jwt") || lower.includes("auth")) {
      return "인증이 꼬였다. 로그아웃 후 다시 로그인해봐.";
    }
    return msg;
  }

  // -----------------------------
  // Habit icon exclusivity + crop
  // -----------------------------
  function setEmojiEnabled(enabled) {
    const sel = $("#habitIcon");
    if (sel) sel.disabled = !enabled;
  }
  function setPhotoEnabled(enabled) {
    const inp = $("#habitPhoto");
    if (inp) inp.disabled = !enabled;
  }

  function clearPhotoState() {
    state.pendingPhotoBlob = null;

    if (state.cropper) {
      try { state.cropper.destroy(); } catch (_) {}
      state.cropper = null;
    }
    if (state.cropObjectUrl) {
      try { URL.revokeObjectURL(state.cropObjectUrl); } catch (_) {}
      state.cropObjectUrl = null;
    }

    const input = $("#habitPhoto");
    if (input) input.value = "";
    $("#habitPhotoPreview")?.classList.add("hidden");
    const img = $("#habitPhotoImg");
    if (img) img.removeAttribute("src");
    $("#cropMsg").textContent = "";
  }

  function resetHabitIconUI() {
    clearPhotoState();
    setEmojiEnabled(true);
    setPhotoEnabled(true);
  }

  function openCropModal() {
    openModal("#cropModal");
  }

  function closeCropModal() {
    $("#cropModal").classList.add("hidden");
  }

  function setZoomFromRange(value) {
    if (!state.cropper) return;
    // 0~100 => 0.2~3.0 정도로 매핑
    const t = Math.max(0, Math.min(100, Number(value)));
    const zoom = 0.2 + (t / 100) * 2.8;
    // 현재 scale 대비 덮어쓰기 방식으로: reset + zoomTo
    try {
      state.cropper.zoomTo(zoom);
    } catch (_) {}
  }

  async function openCropperForFile(file) {
    $("#cropMsg").textContent = "";

    // Cropper 준비
    const imgEl = $("#cropImage");

    // object URL로 넣기
    if (state.cropObjectUrl) {
      try { URL.revokeObjectURL(state.cropObjectUrl); } catch (_) {}
      state.cropObjectUrl = null;
    }
    state.cropObjectUrl = URL.createObjectURL(file);
    imgEl.src = state.cropObjectUrl;

    openCropModal();

    // 이미지 로드 후 cropper 생성
    await new Promise((resolve) => {
      imgEl.onload = () => resolve();
      imgEl.onerror = () => resolve();
    });

    if (state.cropper) {
      try { state.cropper.destroy(); } catch (_) {}
      state.cropper = null;
    }

    // square crop, movable/zoomable, viewMode 1로 과한 밖으로 못나가게
    state.cropper = new Cropper(imgEl, {
      aspectRatio: 1,
      viewMode: 1,
      autoCropArea: 0.9,
      background: false,
      movable: true,
      zoomable: true,
      rotatable: true,
      scalable: false,
      guides: false,
      center: true,
    });

    // 초기 줌 맞추기
    $("#zoomRange").value = "30";
    setTimeout(() => setZoomFromRange(30), 0);
  }

  async function getCroppedBlob(size = 128) {
    if (!state.cropper) throw new Error("cropper missing");
    const canvas = state.cropper.getCroppedCanvas({ width: size, height: size, imageSmoothingEnabled: true, imageSmoothingQuality: "high" });
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png", 0.92));
    if (!blob) throw new Error("blob fail");
    return blob;
  }

  // -----------------------------
  // Create Habit
  // -----------------------------
  async function uploadIconBlob(userId, blob) {
    const now = new Date();
    const stamp = `${now.getFullYear()}${pad2(now.getMonth()+1)}${pad2(now.getDate())}${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
    const rand = Math.random().toString(16).slice(2, 10);
    const path = `${userId}/${stamp}-${rand}.png`;

    const { error: upErr } = await sb
      .storage
      .from(ICON_BUCKET)
      .upload(path, blob, { contentType: "image/png", upsert: false });

    if (upErr) throw upErr;

    const { data } = sb.storage.from(ICON_BUCKET).getPublicUrl(path);
    const url = data?.publicUrl;
    if (!url) throw new Error("public url fail");
    return url;
  }

  async function createHabit() {
    if (!state.session) return;

    const userId = state.session.user.id;
    const title = ($("#habitTitle").value || "").trim();
    const emoji = ($("#habitIcon").value || "💪").trim() || "💪";

    if (!title) { $("#habitMsg").textContent = "목표 이름부터 써라."; return; }

    let iconUrl = null;

    // ✅ 사진 선택한 경우만 업로드
    if (state.pendingPhotoBlob) {
      try {
        if (state.bucketOk === false) {
          $("#habitMsg").textContent = `버킷(${ICON_BUCKET})이 없는 것 같다. Storage에서 버킷 이름 확인해.`;
          return;
        }
        iconUrl = await uploadIconBlob(userId, state.pendingPhotoBlob);
      } catch (e) {
        console.error(e);
        $("#habitMsg").textContent = prettyStorageError(e);
        return;
      }
    }

    const payload = {
      user_id: userId,
      title,
      emoji,       // fallback
      icon: emoji,
      icon_url: iconUrl,
      color: state.themeText || "#111111",
      is_active: true
    };

    const { error } = await sb.from("habits").insert(payload);
    if (error) throw error;

    $("#habitTitle").value = "";
    $("#habitMsg").textContent = "";
    resetHabitIconUI();
    closeAllModals();
    await reloadAll();
  }

  // -----------------------------
  // Habit delete (manage list in 목표 추가)
  // -----------------------------
  function renderHabitManageList() {
    const wrap = $("#habitManageList");
    if (!wrap) return;

    wrap.innerHTML = "";

    if (!state.habits || state.habits.length === 0) {
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = "등록된 목표가 없다. 위에서 하나 추가해.";
      wrap.appendChild(empty);
      return;
    }

    state.habits.forEach((h) => {
      const row = document.createElement("div");
      row.className = "habit-manage-row";

      const left = document.createElement("div");
      left.className = "habit-left";

      const iconWrap = document.createElement("span");
      iconWrap.className = "habit-icon";

      if (h.icon_url) {
        const img = document.createElement("img");
        img.src = h.icon_url;
        img.alt = "";
        iconWrap.appendChild(img);
      } else {
        const emo = document.createElement("span");
        emo.className = "icon-emoji";
        emo.textContent = h.emoji;
        iconWrap.appendChild(emo);
      }

      const title = document.createElement("span");
      title.className = "habit-title";
      title.textContent = h.title;

      left.appendChild(iconWrap);
      left.appendChild(title);

      const right = document.createElement("div");
      right.className = "habit-manage-right";

      const del = document.createElement("button");
      del.type = "button";
      del.className = "delbtn";
      del.textContent = "삭제";
      del.addEventListener("click", () => {
        deleteHabit(h.id).catch((e) => {
          console.error(e);
          alert("삭제 실패. 콘솔 봐라.");
        });
      });

      right.appendChild(del);

      row.appendChild(left);
      row.appendChild(right);
      wrap.appendChild(row);
    });
  }

  function extractStoragePathFromPublicUrl(url) {
    if (!url) return null;
    const needle = `/storage/v1/object/public/${ICON_BUCKET}/`;
    const idx = url.indexOf(needle);
    if (idx === -1) return null;
    return url.slice(idx + needle.length);
  }

  async function deleteHabit(habitId) {
    if (!state.session) return;

    const h = (state.habits || []).find((x) => x.id === habitId);
    const title = h?.title || "이 목표";

    if (!confirm(`${title} 진짜 지울거냐? 기록도 같이 지워진다.`)) return;

    $("#habitMsg").textContent = "";

    // 1) icon file best-effort delete (ignore errors)
    if (h?.icon_url) {
      try {
        const path = extractStoragePathFromPublicUrl(h.icon_url);
        if (path) {
          await sb.storage.from(ICON_BUCKET).remove([path]);
        }
      } catch (e) {
        console.warn("icon remove failed (ignored):", e);
      }
    }

    // 2) delete habit row (habit_logs cascade)
    const { error } = await sb.from("habits").delete().eq("id", habitId);
    if (error) {
      $("#habitMsg").textContent = `삭제 권한이 없다. Supabase RLS(delete policy) 확인해. (${error.message})`;
      throw error;
    }

    await reloadAll();

    // If modals are open, re-render them
    if (isOpenModal("#habitModal")) renderHabitManageList();
    if (isOpenModal("#checkModal") && state.activeDate) renderHabitChecklist(state.activeDate);
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
    $$(".modal [data-close='1']").forEach((el) => el.addEventListener("click", () => {
      closeAllModals();
      closeCropModal();
    }));

    $("#btnSaveDay").addEventListener("click", () => {
      saveLogsForActiveDate().catch((e) => { console.error(e); alert("저장 실패. 콘솔 보자."); });
    });

    $("#btnCreateHabit").addEventListener("click", () => {
      createHabit().catch((e) => { console.error(e); alert("목표 추가 실패. 콘솔 보자."); });
    });

    $("#btnPrev").addEventListener("click", () => gotoPrevMonth().catch((e) => { console.error(e); alert("이동 실패"); }));
    $("#btnNext").addEventListener("click", () => gotoNextMonth().catch((e) => { console.error(e); alert("이동 실패"); }));

    // ✅ 사진 고르면 이모지 잠그고(중복 방지), 크롭 모달 오픈
    $("#habitPhoto").addEventListener("change", async (e) => {
      $("#habitMsg").textContent = "";
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      try {
        // 사진 고른 순간: 이모지 선택 비활성화
        setEmojiEnabled(false);
        await openCropperForFile(file);
      } catch (err) {
        console.error(err);
        $("#habitMsg").textContent = "사진 열기 실패. 다른 사진으로 해봐.";
        setEmojiEnabled(true);
      }
    });

    // ✅ 사진 지우면: 이모지 다시 활성화
    $("#btnClearPhoto").addEventListener("click", () => {
      clearPhotoState();
      setEmojiEnabled(true);
    });

    // Cropper controls
    $("#btnRotateLeft").addEventListener("click", () => {
      if (state.cropper) state.cropper.rotate(-90);
    });
    $("#btnRotateRight").addEventListener("click", () => {
      if (state.cropper) state.cropper.rotate(90);
    });
    $("#zoomRange").addEventListener("input", (e) => setZoomFromRange(e.target.value));

    $("#btnCropCancel").addEventListener("click", () => {
      // 취소면 사진 선택 자체를 취소 처리
      closeCropModal();
      clearPhotoState();
      setEmojiEnabled(true);
    });

    $("#btnCropApply").addEventListener("click", async () => {
      $("#cropMsg").textContent = "";
      try {
        const blob = await getCroppedBlob(128);
        state.pendingPhotoBlob = blob;

        // preview
        const previewUrl = URL.createObjectURL(blob);
        $("#habitPhotoImg").src = previewUrl;
        $("#habitPhotoPreview").classList.remove("hidden");

        // crop modal 닫고 종료
        closeCropModal();
      } catch (e) {
        console.error(e);
        $("#cropMsg").textContent = "크롭 적용 실패. 다시 해봐.";
      }
    });

    // 이모지 바꾸면 사진 제거(중복 방지)
    $("#habitIcon").addEventListener("change", () => {
      if (state.pendingPhotoBlob) {
        // 사진이 이미 설정된 상태면 이모지 변경 불가로 유지하는게 UX가 더 일관됨
        // (사진 쓰기로 했으면 사진만)
        return;
      }
    });
  }

  async function afterLogin() {
    const ok = await ensureAuthedOrShowLogin();
    if (!ok) return;

    await ensureHolidays(state.year);
    renderCalendarGrid();

    // bucket 존재/권한 체크 (확정은 아니지만 UX용)
    await checkIconBucket();

    await reloadAll();
  }

  async function main() {
    loadTheme();
    initYearMonth();
    bindAuthUI();
    bindSettingsUI();
    bindUI();

    await ensureHolidays(state.year);
    renderCalendarGrid();

    const ok = await ensureAuthedOrShowLogin();
    if (!ok) return;

    await checkIconBucket();
    await reloadAll();
  }

  document.addEventListener("DOMContentLoaded", () => {
    main().catch((e) => { console.error(e); alert("초기화 실패. 콘솔 보자."); });
  });
})();
