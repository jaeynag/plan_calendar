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

  function openModal(idSel) {
    const el = $(idSel);
    if (el) el.classList.remove("hidden");
  }

  function closeAllModals() {
    $$(".modal").forEach((m) => m.classList.add("hidden"));
  }

  function show(el) { el.classList.remove("hidden"); }
  function hide(el) { el.classList.add("hidden"); }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
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

  function bindAuthUI() {
    // 로그인
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

    // 회원가입: 모달 열기
    $("#btnSignUp").addEventListener("click", () => {
      const currentEmail = ($("#email").value || "").trim();

      $("#signupMsg").textContent = "";
      $("#signupEmail").value = currentEmail || "";
      $("#signupPassword").value = "";
      $("#signupPassword2").value = "";

      openModal("#signupModal");
      setTimeout(() => $("#signupEmail")?.focus(), 0);
    });

    // 회원가입: 실행 (메일/비번/비번확인)
    $("#btnDoSignUp").addEventListener("click", async () => {
      $("#signupMsg").textContent = "";

      const email = ($("#signupEmail").value || "").trim();
      const password = $("#signupPassword").value || "";
      const password2 = $("#signupPassword2").value || "";

      if (!email || !password || !password2) {
        $("#signupMsg").textContent = "메일/비번/비번확인까지 다 넣어.";
        return;
      }

      if (password.length < 6) {
        $("#signupMsg").textContent = "비번은 6자 이상으로.";
        return;
      }

      if (password !== password2) {
        $("#signupMsg").textContent = "비번이랑 비번확인이 안 맞는다.";
        return;
      }

      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) { $("#signupMsg").textContent = error.message; return; }

      // Confirm email OFF면 보통 session이 바로 생김
      if (data?.session) {
        $("#signupMsg").textContent = "가입 완료. 바로 로그인됨.";
        closeAllModals();
        await afterLogin();
        return;
      }

      $("#signupMsg").textContent = "가입은 됐는데 세션이 없다. Confirm email OFF 저장됐는지 확인. 일단 로그인 눌러.";
      $("#email").value = email;
      $("#password").value = "";
    });

    // 로그아웃
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

  function markTodayAndSelected() {
    const now = new Date();
    const ty = now.getFullYear();
    const tm = now.getMonth() + 1;
    const td = now.getDate();

    $$("#calGrid .day").forEach((cell) => {
      if (cell.classList.contains("empty")) return;
      const dayNum = parseInt(cell.getAttribute("data-day"), 10);
      cell.classList.toggle("today", ty === state.year && tm === state.month && dayNum === td);

      const date = isoDate(state.year, state.month, dayNum);
      cell.classList.toggle("selected", state.activeDate === date);
    });
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

      const emojis = document.createElement("div");
      emojis.className = "day-dots"; // class명 유지
      const date = isoDate(y, m, dayNum);
      emojis.setAttribute("data-date", date);

      cell.appendChild(top);
      cell.appendChild(emojis);

      cell.addEventListener("click", () => onClickDay(dayNum));
      grid.appendChild(cell);
    }

    renderEmojis();
    markTodayAndSelected();
  }

  function getEmojiByHabitId(habitId) {
    const h = state.habits.find((x) => x.id === habitId);
    return (h?.emoji || h?.icon || "✅").trim() || "✅";
  }

  // ✅ 점 대신 이모지 표시
  function renderEmojis() {
    $$(".day-dots").forEach((el) => {
      // count class 초기화
      el.className = "day-dots";

      const date = el.getAttribute("data-date");
      const ids = state.logsByDate[date] || [];

      if (!ids.length) {
        el.innerHTML = "";
        return;
      }

      // 같은 습관이 중복 들어와도 1번만 표시
      const uniq = Array.from(new Set(ids));
      const emojis = uniq.map(getEmojiByHabitId);

      const count = emojis.length;
      const clamp = Math.min(Math.max(count, 1), 15);
      el.classList.add(`emoji-count-${clamp}`);

      // 전부 표시(많으면 wrap + 작은 폰트로)
      el.innerHTML = emojis.map((e) => `<span class="e" aria-hidden="true">${escapeHtml(e)}</span>`).join("");
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
    renderEmojis();
    markTodayAndSelected();
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
    markTodayAndSelected();
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

    // delete unchecked
    if (toDelete.length) {
      const { error } = await sb
        .from("habit_logs")
        .delete()
        .eq("check_date", date)
        .eq("user_id", userId)
        .in("habit_id", toDelete);

      if (error) throw error;
    }

    // upsert checked
    if (toUpsert.length) {
      const payload = toUpsert.map((hid) => ({ habit_id: hid, check_date: date, user_id: userId }));
      const { error } = await sb
        .from("habit_logs")
        .upsert(payload, { onConflict: "habit_id,check_date" });

      if (error) throw error;
    }

    state.logsByDate[date] = [...incoming];
    renderEmojis();
    markTodayAndSelected();
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

    // 하위호환 frequency_days(대충)
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
    // backdrop / x 버튼 닫기
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
    bindAuthUI();
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
