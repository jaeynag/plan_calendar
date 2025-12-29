/* Plan Calendar v10
   - day cell corners: square
   - icons: 2 columns, flow down (max 6 shown)
   - prevent horizontal widening/overflow
*/
:root{
  --bg: #f6f7fb;
  --text: #111111;

  --surface: #ffffff;
  --surface2: #f3f4f6;
  --cell-top: #ffffff;
  --cell-bottom: #f7f8fb;

  --border: rgba(17,17,17,0.08);
  --border2: rgba(17,17,17,0.12);
  --muted: rgba(17,17,17,0.55);
  --shadow: 0 8px 22px rgba(0,0,0,0.06);

  --sun: #e11d48;
  --sat: #2563eb;
  --holiday: #dc2626;
}

*{ box-sizing: border-box; }
html, body { height: 100%; }

body{
  margin:0;
  background: var(--bg);
  color: var(--text);
  font-family: "Nunito", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans KR", "맑은 고딕", sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
}

.hidden{ display:none !important; }
.container{ width: 100%; max-width: 100%; margin: 0; padding: 0; }

.card{
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 18px;
  box-shadow: var(--shadow);
  padding: 16px;
}

#loginCard.card{ margin: 14px 12px 18px; }

.login-title{
  font-family: "Jua", "Nunito", sans-serif;
  font-size: 22px;
  letter-spacing: -0.02em;
  margin-bottom: 10px;
}

.field{ display:block; margin: 12px 0; }
.field > span{
  display:block;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 6px;
}
.field input, .field select{
  width:100%;
  max-width: 100%;
  padding: 12px 12px;
  border: 1px solid var(--border);
  border-radius: 14px;
  font-size: 15px;
  outline: none;
  background: var(--surface);
  color: var(--text);
}
.field input:focus, .field select:focus{ border-color: var(--border2); }

.hint{ font-size: 12px; color: var(--muted); margin-top: 8px; }

.login-actions{
  display:flex;
  gap: 10px;
  margin-top: 6px;
}
@media (max-width: 420px){ .login-actions{ flex-direction: column; } }

button{
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-family: inherit;
  -webkit-tap-highlight-color: transparent;
}

.primary{
  background: var(--text);
  color: var(--surface);
  padding: 12px 14px;
  border-radius: 14px;
  font-weight: 900;
}
.primary:hover{ filter: brightness(0.95); }

.ghostbtn{
  background: rgba(0,0,0,0.06);
  padding: 12px 14px;
  border-radius: 14px;
  font-weight: 900;
}
.ghostbtn:hover{ background: rgba(0,0,0,0.10); }

.fullbtn{ width: 100%; }

.dangerbtn{
  width: 100%;
  background: rgba(225,29,72,0.10);
  color: #e11d48;
  padding: 12px 14px;
  border-radius: 14px;
  font-weight: 900;
}

/* Calendar fills viewport */
#appShell .calendar-shell{
  height: calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom));
  background: var(--surface);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  border-left: none;
  border-right: none;
  border-radius: 0;
  box-shadow: none;
  padding: 12px 12px 14px;
  display:flex;
  flex-direction: column;
  overflow-x: hidden; /* ✅ 좌우 튀어나오는거 방지 */
}

@media (min-width: 768px){
  .container{ max-width: 920px; margin: 0 auto; padding: 18px 18px 26px; }
  #appShell .calendar-shell{
    height: auto;
    border: 1px solid var(--border);
    border-radius: 22px;
    box-shadow: var(--shadow);
  }
}

.cal-header{
  display:grid;
  grid-template-columns: 1fr auto 1fr;
  align-items:center;
  gap: 8px;
  padding: 6px 2px 10px;
}

.cal-year{ display:flex; flex-direction: column; gap: 2px; align-items:flex-start; min-width: 60px; }
.year-label{ font-weight: 900; font-size: 13px; color: var(--muted); }

.cal-nav{ display:flex; align-items:center; justify-content:center; gap: 6px; }
.month-title{
  font-family: "Jua", "Nunito", sans-serif;
  font-size: clamp(30px, 8vw, 40px);
  font-weight: 900;
  letter-spacing: -0.02em;
  padding: 0 8px;
  min-width: 140px;
  text-align:center;
}

.navchev{
  width: 40px;
  height: 40px;
  border-radius: 14px;
  font-size: 30px;
  display:flex;
  align-items:center;
  justify-content:center;
  color: var(--text);
}
.navchev:hover{ background: rgba(0,0,0,0.06); }

.cal-actions{ display:flex; align-items:center; justify-content:flex-end; }
.settingsbtn{
  width: 40px;
  height: 40px;
  border-radius: 14px;
  background: rgba(0,0,0,0.06);
  border: 1px solid rgba(0,0,0,0.04);
  display:flex;
  align-items:center;
  justify-content:center;
  font-size: 18px;
}
.settingsbtn:hover{ background: rgba(0,0,0,0.10); }
.settingsbtn:active{ transform: scale(0.98); }

.weekdays{
  display:grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 1px;
  padding: 8px 2px 10px;
  font-size: 12px;
  color: var(--muted);
  font-weight: 900;
}
.weekdays > div{ text-align:center; }
.weekdays .sun{ color: var(--sun); }
.weekdays .sat{ color: var(--sat); }

/* Grid: square corners */
.grid{
  flex: 1;
  display:grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 1px;
  background: var(--border);
  border-radius: 0;
  overflow: hidden;
  min-width: 0;
}

/* Cell */
.day{
  background:
    linear-gradient(
      to bottom,
      var(--cell-top) 0%,
      var(--cell-top) 34%,
      var(--cell-bottom) 34%,
      var(--cell-bottom) 100%
    );
  border-radius: 0;
  padding: 10px 10px 10px;
  display:flex;
  flex-direction: column;
  justify-content: space-between;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  touch-action: manipulation;
}
.day.empty{ background: rgba(0,0,0,0.02); }

.day-num{
  display:flex;
  justify-content:flex-end;
  align-items:center;
  font-size: 12px;
  font-weight: 900;
  color: rgba(0,0,0,0.78);
  line-height: 1;
}
.day.sun .day-num{ color: var(--sun); }
.day.sat .day-num{ color: var(--sat); }
.day.holiday .day-num{ color: var(--holiday); }

.day.today{ box-shadow: inset 0 0 0 2px rgba(0,0,0,0.22); }
.day.selected{ box-shadow: inset 0 0 0 2px rgba(0,0,0,0.14); }

/* Icons area: 2 columns, flow downward */
.day-dots{
  display:grid;
  grid-template-columns: repeat(2, minmax(0, 1fr)); /* ✅ 딱 두개 */
  grid-auto-rows: 1fr;
  gap: 6px;
  align-items:center;
  justify-items:center;
  align-content:start;

  /* 세로 공간 고정: 3줄(=최대 6개) 정도만 표시 */
  min-height: 66px;
  max-height: 66px;
  overflow:hidden;

  min-width: 0;
}

/* single icon: bigger */
.day-dots.single{
  grid-template-columns: 1fr;
  min-height: 66px;
  max-height: 66px;
}

.icon-emoji{
  font-size: 22px;
  line-height: 1;
}
.day-dots.single .icon-emoji{ font-size: 36px; }

.icon-img{
  width: 24px;
  height: 24px;
  border-radius: 8px;
  object-fit: cover;
  display:block;
}
.day-dots.single .icon-img{
  width: 40px;
  height: 40px;
  border-radius: 12px;
}

/* Modals */
.modal.hidden{ display:none; }
.modal{ position: fixed; inset:0; z-index: 50; }
.modal-backdrop{ position:absolute; inset:0; background: rgba(0,0,0,0.42); }

.modal-panel{
  position:absolute;
  left:50%;
  top:50%;
  transform: translate(-50%, -50%);
  width: min(680px, calc(100% - 22px));
  background: var(--surface);
  border-radius: 22px;
  overflow:hidden;
  box-shadow: 0 30px 80px rgba(0,0,0,0.30);
  border: 1px solid var(--border);
}

.modal-header, .modal-footer{
  padding: 12px 14px;
  display:flex;
  align-items:center;
  justify-content: space-between;
  gap: 10px;
}
.modal-header{ border-bottom: 1px solid var(--border); }
.modal-footer{ border-top: 1px solid var(--border); }

.modal-title{
  font-family: "Jua", "Nunito", sans-serif;
  font-size: 20px;
  font-weight: 900;
}
.xbtn{
  width: 40px;
  height: 40px;
  border-radius: 14px;
  background: rgba(0,0,0,0.06);
  font-size: 20px;
  display:flex;
  align-items:center;
  justify-content:center;
}
.xbtn:hover{ background: rgba(0,0,0,0.10); }

.modal-body{ padding: 12px 14px; max-height: 66vh; overflow:auto; }

.habit-list{ display:flex; flex-direction: column; gap: 10px; }
.habit-row{
  display:flex;
  align-items:center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 12px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface2);
}
.habit-left{ display:flex; align-items:center; gap: 10px; min-width:0; }
.habit-title{ font-weight: 900; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.habit_icon{
  width: 22px; height: 22px;
  display:flex; align-items:center; justify-content:center;
}
.habit-icon img{ width: 22px; height: 22px; border-radius: 8px; object-fit: cover; }
.habit_icon .icon-emoji{ font-size: 20px; }

.progress-list{ display:flex; flex-direction: column; gap: 10px; }
.progress-row{
  display:flex;
  align-items:center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 12px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface2);
}
.progress-left{ display:flex; align-items:center; gap: 10px; min-width:0; }
.progress-title{ font-weight: 900; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.progress-right{ text-align:right; }
.progress-count{ font-weight: 900; font-size: 14px; }
.progress-sub{ font-size: 12px; color: var(--muted); }

.photo-preview{
  margin-top: 10px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface2);
  display:flex;
  align-items:center;
  justify-content: space-between;
  gap: 12px;
}
.photo-preview img{
  width: 58px;
  height: 58px;
  border-radius: 16px;
  object-fit: cover;
  display:block;
}

.setting-email{ display:flex; flex-direction: column; gap: 4px; }
.setting-email-label{ font-size: 12px; color: var(--muted); font-weight: 900; }
.setting-email-value{ font-size: 14px; font-weight: 900; word-break: break-all; }

.setting-row{
  display:flex;
  align-items:center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
}
.setting-label{ font-weight: 900; font-size: 14px; }
.colorpick{
  width: 56px;
  height: 40px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  padding: 0;
}
.setting-actions{
  display:flex;
  justify-content:flex-end;
  padding-top: 6px;
}
.divider{
  height: 1px;
  background: var(--border);
  margin: 14px 0;
}
