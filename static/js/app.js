/* global supabase, Cropper */
(() => {
  const { createClient } = supabase;

  const SUPABASE_URL = window.__SUPABASE_URL__;
  const SUPABASE_ANON_KEY = window.__SUPABASE_ANON_KEY__;
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // 상태 메시지 출력(없으면 콘솔로만)
  function setFoot(msg) {
    const el =
      document.getElementById("settingsMsg") ||
      document.getElementById("footStatus") ||
      document.querySelector(".foot-status");
    if (el) el.textContent = String(msg || "");
    else console.log("[status]", msg);
  }


  // ✅ 버킷 이름: 사용자 말대로 habit_icon
  const ICON_BUCKET = "habit_icons";

  console.log("[PlanCal] app.js v36 loaded");

  const THEME_DEFAULT_BG = "#f6f7fb";
  const THEME_DEFAULT_TEXT = "#111111";

  // 테마 저장: user_id별 localStorage 키
  function themeKeyBg(uid) { return `theme_bg_${uid || "anon"}`; }
  function themeKeyText(uid) { return `theme_text_${uid || "anon"}`; }

  // 테마 저장: Supabase (저장 버튼 눌렀을 때만 upsert)
  async function loadThemeFromDb(uid) {
    if (!uid) return null;
    const { data, error } = await sb
      .from("user_settings")
      .select("theme_bg, theme_text")
      .eq("user_id", uid)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function saveThemeToDb(uid, bg, text) {
    if (!uid) return;
    const payload = {
      user_id: uid,
      theme_bg: bg,
      theme_text: text,
      updated_at: new Date().toISOString(),
    };
    const { error } = await sb.from("user_settings").upsert(payload);
    if (error) throw error;
  }

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

    // habit icon edit
    editingHabitId: null,
    editingHasExistingPhoto: false,
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
  function formatDateKR(ymd) {
    const dt = parseYmd(ymd);
    if (Number.isNaN(dt.getTime())) return String(ymd || "");
    return `${dt.getFullYear()}년 ${dt.getMonth() + 1}월 ${dt.getDate()}일`;
  }

  function normalizeStartDate(row) {
    // created_at은 보통 timestamptz(UTC)라 KST 기준으로 하루 전으로 보일 수 있음.
    // start_date가 없으면 created_at을 "로컬 날짜"로 변환해서 사용한다.
    const sd = row && row.start_date;
    if (sd && typeof sd === "string") return sd.slice(0, 10);

    const ca = row && row.created_at;
    if (ca) {
      const d = new Date(ca);
      if (!Number.isNaN(d.getTime())) return toDateOnlyStr(d);
    }
    return null;
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
  function applyTheme(bgHex, textHex, uidForStorage = null) {
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
      localStorage.setItem(themeKeyBg(uidForStorage), bg);
      localStorage.setItem(themeKeyText(uidForStorage), text);
    } catch (_) { }
  }

  function loadThemeLocal(uidForStorage = null) {
    let bg = THEME_DEFAULT_BG;
    let text = THEME_DEFAULT_TEXT;
    try {
      const b = localStorage.getItem(themeKeyBg(uidForStorage));
      const t = localStorage.getItem(themeKeyText(uidForStorage));
      if (b && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(b)) bg = b;
      if (t && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(t)) text = t;
    } catch (_) { }
    applyTheme(bg, text, uidForStorage);
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
    const btnSignIn = $("#btnSignIn");
    if (!btnSignIn) { console.error("[auth] #btnSignIn not found"); return; }
    btnSignIn.addEventListener("click", async () => {
      console.log("[auth] sign-in clicked");
      const msgEl = $("#msg");
      if (msgEl) msgEl.textContent = "";
      const email = ($("#email").value || "").trim();
      const password = $("#password").value || "";
      if (!email || !password) { if (msgEl) msgEl.textContent = "이메일과 비밀번호를 입력해 주세요."; return; }

      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) { if (msgEl) msgEl.textContent = error.message; return; }
      await afterLogin();
    });

    const btnSignUp = $("#btnSignUp");
    if (!btnSignUp) { console.error("[auth] #btnSignUp not found"); return; }
    btnSignUp.addEventListener("click", () => {
      const currentEmail = ($("#email").value || "").trim();
      const signupMsgEl = $("#signupMsg");
      if (signupMsgEl) signupMsgEl.textContent = "";
      $("#signupEmail").value = currentEmail || "";
      $("#signupPassword").value = "";
      $("#signupPassword2").value = "";
      openModal("#signupModal");
      setTimeout(() => $("#signupEmail")?.focus(), 0);
    });

    const btnDoSignUp = $("#btnDoSignUp");
    if (!btnDoSignUp) { console.error("[auth] #btnDoSignUp not found"); return; }
    btnDoSignUp.addEventListener("click", async () => {
      const signupMsgEl = $("#signupMsg");
      if (signupMsgEl) signupMsgEl.textContent = "";
      const email = ($("#signupEmail").value || "").trim();
      const password = $("#signupPassword").value || "";
      const password2 = $("#signupPassword2").value || "";
      if (!email || !password || !password2) { if (signupMsgEl) signupMsgEl.textContent = "이메일, 비밀번호, 비밀번호 확인을 모두 입력해 주세요."; return; }
      if (password.length < 6) { if (signupMsgEl) signupMsgEl.textContent = "비밀번호는 6자 이상으로 입력해 주세요."; return; }
      if (password !== password2) { if (signupMsgEl) signupMsgEl.textContent = "비밀번호와 비밀번호 확인이 일치하지 않습니다."; return; }

      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) { if (signupMsgEl) signupMsgEl.textContent = error.message; return; }

      if (data?.session) {
        closeAllModals();
        await afterLogin();
        return;
      }

      $("#signupMsg").textContent = "회원가입은 완료되었지만 세션이 없습니다. Supabase Auth의 Confirm email 설정을 확인해 주세요. 우선 로그인해 주세요.";
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
      const uid = state.session?.user?.id || null;
      $("#settingsEmail").textContent = state.session?.user?.email || "-";
      $("#themeBg").value = state.themeBg || THEME_DEFAULT_BG;
      $("#themeText").value = state.themeText || THEME_DEFAULT_TEXT;
      // uid 기준 localStorage 키로도 저장되게 일단 동기화
      applyTheme(state.themeBg, state.themeText, uid);
      openModal("#settingsModal");
    });

    $("#themeBg").addEventListener("input", (e) => {
      const uid = state.session?.user?.id || null;
      applyTheme(e.target.value, state.themeText, uid);
    });
    $("#themeText").addEventListener("input", (e) => {
      const uid = state.session?.user?.id || null;
      applyTheme(state.themeBg, e.target.value, uid);
    });

    $("#btnThemeReset").addEventListener("click", () => {
      const uid = state.session?.user?.id || null;
      applyTheme(THEME_DEFAULT_BG, THEME_DEFAULT_TEXT, uid);
      $("#themeBg").value = THEME_DEFAULT_BG;
      $("#themeText").value = THEME_DEFAULT_TEXT;
    });


    $("#btnThemeSave").addEventListener("click", async () => {
      await refreshSession();
      const uid = state.session?.user?.id || null;
      if (!uid) {
        setFoot("로그인 후 저장할 수 있어");
        return;
      }
      const btn = $("#btnThemeSave");
      btn.disabled = true;
      setFoot("테마 저장중...");
      try {
        await saveThemeToDb(uid, state.themeBg, state.themeText);
        setFoot("테마 저장 완료");
      } catch (e) {
        console.warn("theme save db failed:", e);
        setFoot("테마 저장 실패");
      } finally {
        btn.disabled = false;
      }
    });

    $("#btnOpenHabit").addEventListener("click", () => {
      closeAllModals();
      clearHabitEditMode();
      resetHabitIconUI();
      $("#habitMsg").textContent = "";
      setHabitModalTitle("목표 추가");
      setHabitPrimaryButton("추가");
      setHabitTitleEditable(true);
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
  // Progress panel (bottom, collapsible)
  // -----------------------------
  function setProgressPanelExpanded(expanded) {
    const panel = $("#progressPanel");
    const btn = $("#btnProgressToggle");
    if (!panel || !btn) return;

    panel.classList.toggle("collapsed", !expanded);
    btn.setAttribute("aria-expanded", expanded ? "true" : "false");

    const body = panel.querySelector(".progress-body");
    if (body) body.setAttribute("aria-hidden", expanded ? "false" : "true");
  }

  function parseISODate(iso) {
    // local midnight to avoid TZ drift
    return new Date(`${iso}T00:00:00`);
  }

  function diffDaysInclusive(startISO, endISO) {
    const a = parseISODate(startISO);
    const b = parseISODate(endISO);
    const ms = b.getTime() - a.getTime();
    const days = Math.floor(ms / 86400000);
    return days + 1; // inclusive
  }

  function addDaysISO(iso, days) {
    const d = parseISODate(iso);
    d.setDate(d.getDate() + days);
    return toDateOnlyStr(d);
  }


function isProgressPanelExpanded() {
  const panel = $("#progressPanel");
  return !!(panel && !panel.classList.contains("collapsed"));
}

function formatProgressLine(it) {
  return `${it.title} · ${formatDateKR(it.start)} 시작 · 오늘까지 ${it.totalDays}일 중 ${it.done}회`;
}

function applyProgressDeltas(addedIds, removedIds) {
  if (!isProgressPanelExpanded()) return;

  if (!Array.isArray(state.progressItems) || state.progressItems.length === 0) {
    // 캐시가 없으면 전체 리렌더
    renderProgressPanel();
    return;
  }

  const byId = new Map(state.progressItems.map((x) => [x.id, x]));
  let touched = false;

  for (const id of (addedIds || [])) {
    const it = byId.get(id);
    if (!it) continue;
    it.done = (it.done || 0) + 1;
    touched = true;
  }
  for (const id of (removedIds || [])) {
    const it = byId.get(id);
    if (!it) continue;
    it.done = Math.max(0, (it.done || 0) - 1);
    touched = true;
  }

  if (!touched) return;

  const rows = $$("#progressPanelList .progress-item");
  const affected = new Set([...(addedIds || []), ...(removedIds || [])]);

  for (const rid of affected) {
    const it = byId.get(rid);
    if (!it) continue;

    const row = rows.find((r) => r.getAttribute("data-habit-id") === rid);
    if (!row) continue;

    const txt = row.querySelector(".pi-text");
    if (txt) txt.textContent = formatProgressLine(it);
  }
}

  async function fetchProgressSummaries() {
    // state.habits는 reloadAll()에서 이미 채워짐. 그래도 안전하게 세션 갱신.
    await refreshSession();

    // state.habits 항목은 reloadAll()에서 emoji를 정규화해둠(emoji || icon || ✅)
    // 하지만 등록 아이콘이 '이미지(icon_url)'일 수도 있으니 progress에서도 동일 규칙으로 렌더링한다.
    const list = (state.habits || []).map((h) => ({
      id: h.id,
      title: h.title,
      emoji: (h.emoji || "✅").trim() || "✅",
      icon_url: h.icon_url || null,
      start_date: normalizeStartDate(h),
    }));

    if (!list.length) return [];

    const today = toDateOnlyStr(new Date());
    const minStart = list
      .map((h) => h.start_date)
      .filter(Boolean)
      .sort()[0] || today;

    // today 포함하려면 end를 tomorrow로 잡는 게 깔끔함
    const endISO = addDaysISO(today, 1);

    let q = sb
      .from("habit_logs")
      .select("habit_id,check_date")
      .gte("check_date", minStart)
      .lt("check_date", endISO);

    const userId = state.session?.user?.id;
    if (userId) q = q.eq("user_id", userId);

    const { data: logs, error: le } = await q;
    if (le) throw le;

    const counts = {};
    for (const r of (logs || [])) {
      const hid = r.habit_id;
      counts[hid] = (counts[hid] || 0) + 1;
    }

    return list.map((h) => {
      const start = h.start_date || today;
      const totalDays = diffDaysInclusive(start, today);
      const done = counts[h.id] || 0;
      return {
        id: h.id,
        title: h.title,
        emoji: h.emoji,
        icon_url: h.icon_url,
        start,
        totalDays,
        done,
      };
    });
  }

  async function renderProgressPanel() {
    const wrap = $("#progressPanelList");
    if (!wrap) return;

    wrap.innerHTML = "";

    try {
      const items = await fetchProgressSummaries();
      state.progressItems = items;
      if (!items.length) {
        state.progressItems = [];
        const empty = document.createElement("div");
        empty.className = "progress-empty";
        empty.textContent = "등록된 목표가 없습니다. 먼저 목표를 추가해 주세요.";
        wrap.appendChild(empty);
        return;
      }

      for (const it of items) {
        const row = document.createElement("div");
        row.className = "progress-item";
        row.setAttribute("data-habit-id", it.id);

        const emo = document.createElement("div");
        emo.className = "pi-emoji";
        // 등록 아이콘과 동일하게: icon_url 있으면 이미지, 아니면 emoji
        if (it.icon_url) {
          const img = document.createElement("img");
          img.className = "icon-img";
          img.src = it.icon_url;
          img.alt = "";
          emo.appendChild(img);
        } else {
          const span = document.createElement("span");
          span.className = "icon-emoji";
          span.textContent = it.emoji;
          emo.appendChild(span);
        }

        const txt = document.createElement("div");
        txt.className = "pi-text";
        txt.textContent = formatProgressLine(it);

        row.appendChild(emo);
        row.appendChild(txt);
        wrap.appendChild(row);
      }
    } catch (e) {
      console.error(e);
      const empty = document.createElement("div");
      empty.className = "progress-empty";
      empty.textContent = "진행 상황을 불러오는 중 오류가 발생했습니다. 콘솔을 확인해 주세요.";
      wrap.appendChild(empty);
    }
  }

  async function toggleProgressPanel() {
    const panel = $("#progressPanel");
    if (!panel) return;

    const isCollapsed = panel.classList.contains("collapsed");
    if (isCollapsed) {
      setProgressPanelExpanded(true);
      await renderProgressPanel();
    } else {
      setProgressPanelExpanded(false);
    }
  }


  // -----------------------------
  // Progress
  // -----------------------------
  async function openProgress() {
    $("#progressMsg").textContent = "";
    $("#progressList").innerHTML = "";

    if (!state.session) {
      $("#progressMsg").textContent = "먼저 로그인해 주세요.";
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
        start_date: normalizeStartDate(h),
      }));

      if (!list.length) {
        $("#progressMsg").textContent = "등록된 목표가 없습니다. 먼저 목표를 추가해 주세요.";
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
        sub.textContent = `${formatDateKR(start)} ~ ${formatDateKR(today)}`;

        right.appendChild(count);
        right.appendChild(sub);

        row.appendChild(left);
        row.appendChild(right);

        wrap.appendChild(row);
      }

      openModal("#progressModal");
    } catch (e) {
      console.error(e);
      $("#progressMsg").textContent = "진행 상황을 불러오는 중 오류가 발생했습니다. 콘솔을 확인해 주세요.";
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
    // NOTE(v35): 주차(week) 행 높이를 강제로 동일하게 만들지 않습니다.
    // 한 날짜칸이 커져도 해당 줄만 커지도록, CSS grid-auto-rows(minmax)로 처리합니다.
    grid.style.gridTemplateRows = "";

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
    markTodaySelectedHoliday();
    if (isProgressPanelExpanded()) { renderProgressPanel().catch(console.error); }
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

      if (shown.length === 1) el.classList.add("single");
      else if (shown.length === 2) el.classList.add("double");

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
      start_date: normalizeStartDate(h),
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
    $("#modalDateTitle").textContent = formatDateKR(date);
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

    const toInsert = [...incoming].filter((x) => !existing.has(x));

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
    applyProgressDeltas(toInsert, toDelete);
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
      return `버킷(${ICON_BUCKET})을(를) 찾을 수 없습니다. Supabase Storage에서 버킷 이름을 확인해 주세요.`;
    }
    if (lower.includes("row level security") || lower.includes("rls") || lower.includes("permission")) {
      return "Storage RLS로 인해 차단되었습니다. storage.objects INSERT/SELECT 정책을 확인해 주세요.";
    }
    if (lower.includes("jwt") || lower.includes("auth")) {
      return "인증 상태에 문제가 있습니다. 로그아웃 후 다시 로그인해 주세요.";
    }
    return msg;
  }

  
  // -----------------------------
  // Custom Emoji (v26)
  // -----------------------------
  const CUSTOM_EMOJI_KEY = "custom_emojis_v1";
  const CUSTOM_EMOJI_MAX = 60;

  function loadCustomEmojis() {
    try {
      const raw = localStorage.getItem(CUSTOM_EMOJI_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) return [];
      return arr
        .filter((x) => typeof x === "string")
        .map((x) => x.trim())
        .filter((x) => x.length);
    } catch (_) {
      return [];
    }
  }

  function saveCustomEmojis(list) {
    try {
      const uniq = [];
      const seen = new Set();
      for (const e of list || []) {
        const v = String(e || "").trim();
        if (!v) continue;
        if (seen.has(v)) continue;
        seen.add(v);
        uniq.push(v);
        if (uniq.length >= CUSTOM_EMOJI_MAX) break;
      }
      localStorage.setItem(CUSTOM_EMOJI_KEY, JSON.stringify(uniq));
    } catch (_) { }
  }

  function segmentGraphemes(str) {
    try {
      if (window.Intl && Intl.Segmenter) {
        const seg = new Intl.Segmenter("en", { granularity: "grapheme" });
        return Array.from(seg.segment(str), (x) => x.segment);
      }
    } catch (_) { }
    return null; // fallback
  }

  function validateSingleEmoji(input) {
    const s = String(input || "").trim();
    if (!s) return { ok: false, reason: "입력값이 비어 있습니다." };

    const clusters = segmentGraphemes(s);
    const g = clusters ? clusters.join("") : s;

    // 하나만 허용
    if (clusters && clusters.length !== 1) return { ok: false, reason: "이모지는 1개만 입력해 주세요." };

    // 키캡(1️⃣, #️⃣ 등) 허용
    const keycap = /^[0-9#*]\uFE0F?\u20E3$/u;
    if (keycap.test(g)) return { ok: true, value: g };

    // 대표적인 이모지/깃발(Regional Indicator) 체크
    const hasEmoji = /(\p{Extended_Pictographic}|\p{Regional_Indicator})/u;
    if (!hasEmoji.test(g)) return { ok: false, reason: "이모지 형식이 아닙니다." };

    // 문자 섞이면 컷
    if (/[A-Za-z\uAC00-\uD7A3]/u.test(g)) return { ok: false, reason: "문자(글자)는 섞지 말아 주세요." };

    // 너무 길면 컷(ZWJ/VS 포함해서도 보통 8~12 안쪽)
    if (g.length > 16) return { ok: false, reason: "입력값이 너무 깁니다. 이모지 1개만 입력해 주세요." };

    return { ok: true, value: g };
  }

  function ensureEmojiOptions() {
    const sel = $("#habitIcon");
    if (!sel) return;

    const existing = new Set(Array.from(sel.options).map((o) => o.value));
    const customs = loadCustomEmojis();
    // 최신이 위로 오게: 저장된 순서 그대로(앞이 최신)
    const toAdd = customs.filter((e) => e && !existing.has(e));

    for (let i = toAdd.length - 1; i >= 0; i--) {
      const e = toAdd[i];
      const opt = document.createElement("option");
      opt.value = e;
      opt.textContent = e;
      sel.insertBefore(opt, sel.firstChild);
      existing.add(e);
    }
  }

  function addCustomEmojiFromInput() {
    const input = $("#habitIconCustom");
    const sel = $("#habitIcon");
    const hint = $("#emojiHint");
    if (!input || !sel) return;

    if (state.pendingPhotoBlob) {
      if (hint) hint.textContent = "현재 사진 아이콘을 사용 중입니다. 사진을 제거하신 뒤 이모지를 선택해 주세요.";
      return;
    }

    const v = validateSingleEmoji(input.value);
    if (!v.ok) {
      if (hint) hint.textContent = v.reason || "처리할 수 없습니다.";
      return;
    }

    const emoji = v.value;
    // 저장(최신 앞으로)
    const arr = loadCustomEmojis().filter((x) => x !== emoji);
    arr.unshift(emoji);
    saveCustomEmojis(arr);

    // 셀렉트에 추가
    const exists = Array.from(sel.options).some((o) => o.value === emoji);
    if (!exists) {
      const opt = document.createElement("option");
      opt.value = emoji;
      opt.textContent = emoji;
      sel.insertBefore(opt, sel.firstChild);
    }
    sel.value = emoji;

    input.value = "";
    if (hint) hint.textContent = `추가됨: ${emoji}`;
    // 너무 오래 남지 않게 원복
    if (hint) {
      setTimeout(() => {
        // 모달 닫혔을 수도 있으니 존재 체크
        const h = $("#emojiHint");
        if (h) h.textContent = "이모지 1개만 입력하신 뒤 “추가”를 눌러 주세요. (예: 🥊, 🧠, 🧯, 📌)";
      }, 1600);
    }
  }

// -----------------------------
  // Habit icon exclusivity + crop
  // -----------------------------
  function setEmojiEnabled(enabled) {
    const sel = $("#habitIcon");
    if (sel) sel.disabled = !enabled;
    const inp = $("#habitIconCustom");
    if (inp) inp.disabled = !enabled;
    const btn = $("#btnAddEmoji");
    if (btn) btn.disabled = !enabled;
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
    const inp = $("#habitIconCustom");
    if (inp) inp.value = "";
    const hint = $("#emojiHint");
    if (hint) hint.textContent = "이모지 1개만 입력하신 뒤 “추가”를 눌러 주세요. (예: 🥊, 🧠, 🧯, 📌)";
    ensureEmojiOptions();
  }
  function clearHabitEditMode() {
    state.editingHabitId = null;
    state.editingHasExistingPhoto = false;
    // 편집 중 사진/크롭 상태는 같이 정리
    clearPhotoState();
    setEmojiEnabled(true);
  }

  function setHabitModalTitle(text) {
    const t = document.querySelector("#habitModal .modal-title");
    if (t) t.textContent = String(text || "");
  }

  function setHabitPrimaryButton(text) {
    const b = $("#btnCreateHabit");
    if (b) b.textContent = String(text || "");
  }

  function setHabitTitleEditable(editable) {
    const inp = $("#habitTitle");
    if (!inp) return;
    inp.disabled = !editable;
    if (editable && !inp.placeholder) inp.placeholder = "예: 운동, 독서, 공부";
  }

  function ensureEmojiOptionExists(emoji) {
    const sel = $("#habitIcon");
    if (!sel) return;
    const v = (emoji || "").trim();
    if (!v) return;
    const exists = Array.from(sel.options).some((o) => o.value === v);
    if (!exists) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      sel.insertBefore(opt, sel.firstChild);
    }
    sel.value = v;
  }

  function openEditHabitIcon(habit) {
    if (!habit) return;

    // 모달은 이미 열려 있을 수 있으니, 상태만 편집 모드로 전환
    state.editingHabitId = habit.id;
    state.editingHasExistingPhoto = !!habit.icon_url;

    $("#habitMsg").textContent = "";
    setHabitModalTitle("아이콘 변경");
    setHabitPrimaryButton("저장");
    setHabitTitleEditable(false);

    // 제목은 보여주기만
    $("#habitTitle").value = habit.title || "";

    // 아이콘 UI 초기화 후 기존 값 반영
    resetHabitIconUI();

    if (habit.icon_url) {
      // 기존이 사진 아이콘이면: 프리뷰 보여주고 이모지는 잠금
      setEmojiEnabled(false);
      state.editingHasExistingPhoto = true;

      const img = $("#habitPhotoImg");
      if (img) img.src = habit.icon_url;
      $("#habitPhotoPreview")?.classList.remove("hidden");
    } else {
      // 기존이 이모지면: 해당 이모지를 선택
      state.editingHasExistingPhoto = false;
      setEmojiEnabled(true);
      ensureEmojiOptionExists(habit.emoji || "✅");
    }

    // 사진 입력은 항상 가능(새 사진으로 교체 가능)
    setPhotoEnabled(true);

    // 모달이 닫혀 있으면 열기
    if (!isOpenModal("#habitModal")) openModal("#habitModal");
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

  
  async function updateHabitIcon() {
    if (!state.session || !state.editingHabitId) return;

    const userId = state.session.user.id;
    const habitId = state.editingHabitId;

    const current = (state.habits || []).find((x) => x.id === habitId) || null;

    // 이모지는 fallback으로 항상 유지
    const emoji = ($("#habitIcon").value || current?.emoji || "✅").trim() || "✅";

    let newIconUrl = null;

    // 1) 새 사진을 선택해서 크롭 적용한 경우
    if (state.pendingPhotoBlob) {
      try {
        if (state.bucketOk === false) {
          $("#habitMsg").textContent = `버킷(${ICON_BUCKET})이 없는 것 같습니다. Storage에서 버킷 이름을 확인해 주세요.`;
          return;
        }
        newIconUrl = await uploadIconBlob(userId, state.pendingPhotoBlob);
      } catch (e) {
        console.error(e);
        $("#habitMsg").textContent = prettyStorageError(e);
        return;
      }
    } else if (state.editingHasExistingPhoto && current?.icon_url) {
      // 2) 기존 사진을 그대로 유지
      newIconUrl = current.icon_url;
    } else {
      // 3) 이모지 사용(사진 없음)
      newIconUrl = null;
    }

    // DB 업데이트
    const payload = { emoji, icon: emoji, icon_url: newIconUrl };

    let q = sb.from("habits").update(payload).eq("id", habitId);
    // RLS가 user_id 조건을 요구할 수 있으니 같이 걸어둔다.
    q = q.eq("user_id", userId);

    const { error } = await q;
    if (error) throw error;

    // 기존 파일은 best-effort로 제거 (아이콘 교체/삭제 시)
    if (current?.icon_url && current.icon_url !== newIconUrl) {
      try {
        const path = extractStoragePathFromPublicUrl(current.icon_url);
        if (path) await sb.storage.from(ICON_BUCKET).remove([path]);
      } catch (e) {
        console.warn("icon remove failed (ignored):", e);
      }
    }

    // 마무리
    $("#habitMsg").textContent = "";
    clearHabitEditMode();
    resetHabitIconUI();
    closeAllModals();
    await reloadAll();
  }

async function createHabit() {
    if (!state.session) return;

    // 편집 모드: 등록된 목표 아이콘 변경
    if (state.editingHabitId) {
      await updateHabitIcon();
      return;
    }

    const userId = state.session.user.id;
    const title = ($("#habitTitle").value || "").trim();
    const emoji = ($("#habitIcon").value || "💪").trim() || "💪";

    if (!title) { $("#habitMsg").textContent = "목표 이름을 입력해 주세요."; return; }

    let iconUrl = null;

    // ✅ 사진 선택한 경우만 업로드
    if (state.pendingPhotoBlob) {
      try {
        if (state.bucketOk === false) {
          $("#habitMsg").textContent = `버킷(${ICON_BUCKET})이 없는 것 같습니다. Storage에서 버킷 이름을 확인해 주세요.`;
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
      start_date: toDateOnlyStr(new Date()),
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
  
  // -----------------------------
  // Habit manage (목표 추가 모달 내)
  //  - 이름 수정: 연필 버튼
  //  - 아이콘 변경/삭제: 톱니(⚙︎) 메뉴에서
  // -----------------------------

  let _openHabitMenuEl = null;
  let _openHabitMenuCleanup = null;

  function closeHabitRowMenu() {
    try {
      if (_openHabitMenuCleanup) _openHabitMenuCleanup();
    } catch (_) { }
    _openHabitMenuCleanup = null;
    if (_openHabitMenuEl && _openHabitMenuEl.parentNode) {
      _openHabitMenuEl.parentNode.removeChild(_openHabitMenuEl);
    }
    _openHabitMenuEl = null;
  }

  function openHabitRowMenu(habit, anchorBtn) {
    closeHabitRowMenu();

    const menu = document.createElement("div");
    menu.className = "habit-row-menu";
    menu.setAttribute("role", "menu");

    const btnIcon = document.createElement("button");
    btnIcon.type = "button";
    btnIcon.className = "habit-row-menu-btn";
    btnIcon.textContent = "아이콘 변경";
    btnIcon.addEventListener("click", () => {
      closeHabitRowMenu();
      openEditHabitIcon(habit);
    });

    const btnDel = document.createElement("button");
    btnDel.type = "button";
    btnDel.className = "habit-row-menu-btn danger";
    btnDel.textContent = "삭제";
    btnDel.addEventListener("click", () => {
      closeHabitRowMenu();
      deleteHabit(habit.id).catch((e) => {
        console.error(e);
        alert("삭제에 실패했습니다. 콘솔을 확인해 주세요.");
      });
    });

    menu.appendChild(btnIcon);
    menu.appendChild(btnDel);

    document.body.appendChild(menu);

    // position (fixed)
    const r = anchorBtn.getBoundingClientRect();
    const pad = 8;
    const w = 180;
    const left = Math.min(window.innerWidth - w - pad, Math.max(pad, r.right - w));
    const top = Math.min(window.innerHeight - 10, r.bottom + 8);

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    _openHabitMenuEl = menu;

    const onDocDown = (ev) => {
      if (!menu.contains(ev.target) && ev.target !== anchorBtn) {
        closeHabitRowMenu();
      }
    };
    const onEsc = (ev) => {
      if (ev.key === "Escape") closeHabitRowMenu();
    };
    const onResize = () => closeHabitRowMenu();

    document.addEventListener("pointerdown", onDocDown, true);
    document.addEventListener("keydown", onEsc, true);
    window.addEventListener("resize", onResize, true);
    window.addEventListener("scroll", onResize, true);

    _openHabitMenuCleanup = () => {
      document.removeEventListener("pointerdown", onDocDown, true);
      document.removeEventListener("keydown", onEsc, true);
      window.removeEventListener("resize", onResize, true);
      window.removeEventListener("scroll", onResize, true);
    };
  }

  async function updateHabitTitle(habitId, newTitle) {
    if (!state.session) return;
    const userId = state.session.user.id;
    const title = (newTitle || "").trim();
    if (!title) throw new Error("empty title");

    // RLS 대비: user_id 조건 같이
    const { error } = await sb
      .from("habits")
      .update({ title })
      .eq("id", habitId)
      .eq("user_id", userId);

    if (error) throw error;

    await reloadAll();
  }

  function renderHabitManageList() {
    const wrap = $("#habitManageList");
    if (!wrap) return;

    closeHabitRowMenu();
    wrap.innerHTML = "";

    if (!state.habits || state.habits.length === 0) {
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = "등록된 목표가 없습니다. 위에서 목표를 추가해 주세요.";
      wrap.appendChild(empty);
      return;
    }

    const makeIconBtn = (text, aria) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "habit-iconbtn";
      b.textContent = text;
      b.setAttribute("aria-label", aria || "");
      return b;
    };

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

      // title + pencil
      const titleWrap = document.createElement("div");
      titleWrap.className = "habit-title-wrap";

      const title = document.createElement("span");
      title.className = "habit-title";
      title.textContent = h.title;

      const pencil = makeIconBtn("✎", "이름 수정");
      pencil.classList.add("pencil");

      pencil.addEventListener("click", () => {
        // 이미 편집중이면 무시
        if (titleWrap.querySelector("input")) return;

        const input = document.createElement("input");
        input.type = "text";
        input.maxLength = 40;
        input.className = "habit-title-input";
        input.value = h.title || "";

        const btnSave = makeIconBtn("✓", "저장");
        btnSave.classList.add("save");
        const btnCancel = makeIconBtn("×", "취소");
        btnCancel.classList.add("cancel");

        const exit = () => {
          closeHabitRowMenu();
          titleWrap.innerHTML = "";
          titleWrap.appendChild(title);
          titleWrap.appendChild(pencil);
        };

        const doSave = async () => {
          const next = (input.value || "").trim();
          if (!next) { alert("목표 이름을 입력해 주세요."); return; }

          btnSave.disabled = true;
          btnCancel.disabled = true;
          input.disabled = true;

          try {
            await updateHabitTitle(h.id, next);
            // reloadAll로 state.habits 갱신됨
            if (isOpenModal("#habitModal")) renderHabitManageList();
          } catch (e) {
            console.error(e);
            alert("이름 수정에 실패했습니다. 콘솔을 확인해 주세요.");
          } finally {
            btnSave.disabled = false;
            btnCancel.disabled = false;
            input.disabled = false;
          }
        };

        input.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") doSave();
          if (ev.key === "Escape") exit();
        });
        btnSave.addEventListener("click", doSave);
        btnCancel.addEventListener("click", exit);

        titleWrap.innerHTML = "";
        titleWrap.appendChild(input);
        titleWrap.appendChild(btnSave);
        titleWrap.appendChild(btnCancel);

        setTimeout(() => { try { input.focus(); input.select(); } catch (_) { } }, 0);
      });

      titleWrap.appendChild(title);
      titleWrap.appendChild(pencil);

      left.appendChild(iconWrap);
      left.appendChild(titleWrap);

      const right = document.createElement("div");
      right.className = "habit-manage-right";

      const gear = makeIconBtn("⚙︎", "목표 설정");
      gear.classList.add("gear");
      gear.addEventListener("click", () => openHabitRowMenu(h, gear));

      right.appendChild(gear);

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

    if (!confirm(`${title} 목표를 삭제하시겠습니까? 체크 기록도 함께 삭제됩니다.`)) return;

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
      $("#habitMsg").textContent = `삭제 권한이 없습니다. Supabase RLS(delete policy)를 확인해 주세요. (${error.message})`;
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
    // Custom emoji add
    const addBtn = $("#btnAddEmoji");
    const emojiInp = $("#habitIconCustom");
    if (addBtn) addBtn.addEventListener("click", () => addCustomEmojiFromInput());
    if (emojiInp) emojiInp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); addCustomEmojiFromInput(); }
    });
    // Progress panel toggle
    const btnProg = $("#btnProgressToggle");
    if (btnProg) btnProg.addEventListener("click", () => {
      toggleProgressPanel().catch((e) => { console.error(e); });
    });

    $$(".modal [data-close='1']").forEach((el) => el.addEventListener("click", () => {
      closeAllModals();
      closeCropModal();
      clearHabitEditMode();
    }));

    $("#btnSaveDay").addEventListener("click", () => {
      saveLogsForActiveDate().catch((e) => { console.error(e); alert("저장에 실패했습니다. 콘솔을 확인해 주세요."); });
    });

    $("#btnCreateHabit").addEventListener("click", () => {
      createHabit().catch((e) => { console.error(e); alert("목표 추가에 실패했습니다. 콘솔을 확인해 주세요."); });
    });

    $("#btnPrev").addEventListener("click", () => gotoPrevMonth().catch((e) => { console.error(e); alert("이동에 실패했습니다."); }));
    $("#btnNext").addEventListener("click", () => gotoNextMonth().catch((e) => { console.error(e); alert("이동에 실패했습니다."); }));

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
        $("#habitMsg").textContent = "사진을 여는 데 실패했습니다. 다른 사진으로 다시 시도해 주세요.";
        setEmojiEnabled(true);
      }
    });

    // ✅ 사진 지우면: 이모지 다시 활성화
    $("#btnClearPhoto").addEventListener("click", () => {
      clearPhotoState();
      state.editingHasExistingPhoto = false;
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
        $("#cropMsg").textContent = "크롭 적용에 실패했습니다. 다시 시도해 주세요.";
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

    // 로그인 이후: DB에 저장된 테마가 있으면 적용 (없으면 현재 테마 유지)
    const uid = state.session?.user?.id || null;
    try {
      const row = await loadThemeFromDb(uid);
      if (row?.theme_bg && row?.theme_text) {
        applyTheme(row.theme_bg, row.theme_text, uid);
      } else {
        // DB에 없으면 지금 테마를 uid 로컬키로만 보관
        applyTheme(state.themeBg, state.themeText, uid);
      }
    } catch (e) {
      console.warn("theme load db failed, keep local:", e);
      applyTheme(state.themeBg, state.themeText, uid);
    }

    await ensureHolidays(state.year);
    renderCalendarGrid();

    // bucket 존재/권한 체크 (확정은 아니지만 UX용)
    await checkIconBucket();

    await reloadAll();
  }

  async function main() {
    loadThemeLocal(null);
    initYearMonth();

    // 로그인은 어떤 상황에서도 붙어야 한다.
    try { bindAuthUI(); } catch (e) { console.error("[auth] bindAuthUI failed", e); }

    // 아래 UI 바인딩에서 에러가 나도 로그인은 막지 않게 분리한다.
    try { bindSettingsUI(); } catch (e) { console.error("[ui] bindSettingsUI failed", e); }
    try { bindUI(); } catch (e) { console.error("[ui] bindUI failed", e); }

    await ensureHolidays(state.year);
    renderCalendarGrid();

    const ok = await ensureAuthedOrShowLogin();
    if (!ok) return;

    // 초기 로드(이미 로그인된 상태 포함): DB 테마 적용
    {
      const uid = state.session?.user?.id || null;
      try {
        const row = await loadThemeFromDb(uid);
        if (row?.theme_bg && row?.theme_text) {
          applyTheme(row.theme_bg, row.theme_text, uid);
          const elBg = $("#themeBg");
          const elText = $("#themeText");
          if (elBg) elBg.value = row.theme_bg;
          if (elText) elText.value = row.theme_text;
        } else {
          applyTheme(state.themeBg, state.themeText, uid);
        }
      } catch (e) {
        console.warn("theme load db failed (startup):", e);
        applyTheme(state.themeBg, state.themeText, uid);
      }
    }

    await checkIconBucket();
    await reloadAll();
  }

  document.addEventListener("DOMContentLoaded", () => {
    main().catch((e) => { console.error(e); alert("초기화에 실패했습니다. 콘솔을 확인해 주세요."); });
  });
})();
