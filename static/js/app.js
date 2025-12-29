/* global supabase */
(() => {
  const { createClient } = supabase;

  const SUPABASE_URL = window.__SUPABASE_URL__;
  const SUPABASE_ANON_KEY = window.__SUPABASE_ANON_KEY__;
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

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

  function openModal(idSel) { $(idSel).classList.remove("hidden"); }
  function closeAllModals() { $$(".modal").forEach((m) => m.classList.add("hidden")); }

  function show(el) { el.classList.remove("hidden"); }
  function hide(el) { el.classList.add("hidden"); }

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
    const btnLogout = $("#btnLogout");

    if (!sess) {
      show(loginCard);
      hide(appShell);
      hide(btnLogout);
      $("#userBadge").textContent = "";
      return false;
    }

    hide(loginCard);
    show(appShell);
    show(btnLogout);

    const email = sess.user?.email || "";
    $("#userBadge").textContent = email ? `로그인: ${email}` : "로그인됨";
    return true;
  }

  function bindLogin() {
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

    // ✅ 회원가입: Confirm email OFF 기준(가입 즉시 로그인 기대)
    $("#btnSignUp").addEventListener("click", async () => {
      $("#msg").textContent = "";
      const email = ($("#email").value || "").trim();
      const password = $("#password").value || "";

      if (!email || !password) {
        $("#msg").textContent = "이메일/비번부터 넣어.";
        return;
      }

      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) { $("#msg").textContent = error.message; return; }

      // Confirm email OFF면 대부분 session이 바로 생김
      if (data?.session) {
        $("#msg").textContent = "가입 완료. 바로 로그인됨.";
        await afterLogin();
        return;
      }

      $("#msg").textContent = "가입 완료. 이제 로그인 버튼 눌러.";
    });

    $("#btnLogout").addEventListener("click", async () => {
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
    $("#ymTitle").textContent = `${state.year}년 ${state.month}월`;
  }

  function renderCalendarGrid() {
    setTitle();

    const grid = $("#calGrid");
    grid.innerHTML = "";

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
      dots.setAttribute("data-date", date);

      cell.appendChild(top);
      cell.appendChild(dots);

      cell.addEventListener("click", () => onClickDay(dayNum));
      grid.appendChild(cell);
    }

    renderDots();
    applyDayDotsLayout();
  }

  function renderDots() {
    $$(".day-dots").forEach((el) => {
      const date = el.getAttribute("data-date");
      const ids = state.logsByDate[date] || [];
      el.textContent = ids.length ? "•".repeat(Math.min(ids.length, 6)) : "";
    });
  }


  function applyDayDotsLayout() {
    $$(".day-dots").forEach((el) => {
      // count children icons first (photo/emoji)
      const iconChildren = el.querySelectorAll(".icon-img, .icon-emoji");
      let count = iconChildren.length;

      // fallback: if text dots/emoji only
      if (!count) {
        const txt = (el.textContent || "").trim();
        if (txt) {
          // count bullets (•) safely
          count = [...txt].filter((ch) => ch === "•").length || [...txt].length;
        }
      }

      el.classList.remove("count-1", "count-2", "count-3p");

      if (count === 1) el.classList.add("count-1");
      else if (count === 2) el.classList.add("count-2");
      else if (count >= 3) el.classList.add("count-3p");

      // Set per-cell icon size so 1 icon fits nicely without cropping
      // (CSS also has defaults; this just refines)
      const cellW = el.clientWidth || 0;
      if (count === 1 && cellW) {
        el.style.setProperty("--i", `${Math.min(54, Math.max(28, cellW - 10))}px`);
      } else if (count === 2 && cellW) {
        el.style.setProperty("--i", `${Math.min(34, Math.max(20, cellW - 14))}px`);
      } else if (count >= 3 && cellW) {
        const gap = 2;
        el.style.setProperty("--i", `${Math.min(22, Math.max(16, Math.floor((cellW - gap - 6) / 2)))}px`);
      }
    });
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
    applyDayDotsLayout();
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
    applyDayDotsLayout();
    closeAllModals();
  }

  async function createHabit() {
    if (!state.session) return;

    const userId = state.session.user.id;

    const title = ($("#habitTitle").value || "").trim();
    const emoji = ($("#habitEmoji").value || "").trim() || "✅";
    const color = ($("#habitColor").value || "").trim() || "#FF9500";
    const period_unit = $("#habitUnit").value;
    const period_value = Math.max(1, parseInt($("#habitUnitValue").value, 10) || 1);
    const target_count = Math.max(1, parseInt($("#habitTarget").value, 10) || 1);

    if (!title) { alert("제목부터 써라."); return; }

    let frequency_days = period_value;
    if (period_unit === "week") frequency_days = 7 * period_value;
    if (period_unit === "month") frequency_days = 30 * period_value;

    const payload = {
      user_id: userId,
      title,
      emoji,
      icon: emoji, // icon NOT NULL 대응
      color,
      period_unit,
      period_value,
      target_count,
      frequency_days,
      is_active: true,
    };

    const { error } = await sb.from("habits").insert(payload);
    if (error) throw error;

    $("#habitTitle").value = "";
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

    $("#btnSaveDay").addEventListener("click", () => {
      saveLogsForActiveDate().catch((e) => {
        console.error(e);
        alert("저장 실패. 콘솔 보자.");
      });
    });

    $("#btnAddHabit").addEventListener("click", () => openModal("#habitModal"));

    $("#btnCreateHabit").addEventListener("click", () => {
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
    main().catch((e) => {
      console.error(e);
      alert("초기화 실패. 콘솔 보자.");
    });
  });
})();
