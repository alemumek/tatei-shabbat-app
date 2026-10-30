/* שבת וחג אצל טטיי - app.js v3.0.0
   שכבת UI ורשת בלבד. כל הלוגיקה הטהורה ב-logic.js (נטען לפניו).
   אין innerHTML עם נתונים: DOM נבנה ב-createElement ו-textContent (העזר h). */
'use strict';
const CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/AKfycbyeLEhyGVsbe_1eMbFDAXDCV5x9OOPw9jvzspdSsPbqDzS3pn0ZIPp5qiSd7ZQ89vO6/exec', /* להדביק כאן את הכתובת הקיימת מ-app.js החי (GAS_URL), בלי לשנות */
  HORIZON_DAYS: 270, // כמה ימים קדימה מציגים אירועים
  CHUNK_DAYS: 100,   // גודל טווח בקריאה אחת ל-Hebcal
  EVENTS_CACHE_MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000,
  REGS_REFRESH_AFTER_MS: 60 * 1000,
  INITIAL_EVENTS_SHOWN: 3, // כמה מועדים מוצגים בהתחלה
  MORE_STEP: 5,            // כמה מועדים נוספים בכל לחיצה על "הצג עוד מועדים"
  SERVER_VERSION: 3,       // חייב להתאים ל-SERVER_VERSION ב-Code.gs
  CLIENT_VERSION: '3.0.0',
  MAX_NAME: 40, MAX_ENTRIES: 20,
  // ימי טוב שלא מוצגים לבחירה. להכללת יום כיפור: להשאיר מערך ריק.
  EXCLUDED_YOMTOV_TITLES: ['Yom Kippur']
};
const LS = { EVENTS: 'tatay.events.v3', REGS: 'tatay.regs.v3', PARASHA: 'tatay.parasha.v3' };
const HEBCAL_URL = 'https://www.hebcal.com/hebcal';

const STR = {
  submit: 'אישור הרשמה', update: 'עדכון הרשמה', sending: 'שולח...',
  loadingEvents: 'טוען מועדים...', loadingRegs: 'טוען הרשמות...',
  eventsErr: 'לא הצלחנו לטעון את רשימת המועדים. בדקו חיבור לאינטרנט.',
  regsErr: (m) => 'לא הצלחנו לטעון את ההרשמות. ' + m,
  retry: 'נסו שוב', empty: 'אין הרשמות להצגה בלשונית זו.',
  cached: 'מוצגים נתונים שמורים. אין חיבור לאינטרנט.',
  errNet: 'שגיאת תקשורת. בדקו חיבור לאינטרנט ונסו שוב.',
  errOld: 'השרת עדיין בגרסה ישנה. מנהל האפליקציה צריך לעדכן את הפריסה ב-Apps Script (פריסה > ניהול פריסות > גרסה חדשה).',
  errDeploy: 'השרת החזיר תשובה לא תקינה. יש לוודא שהפריסה ב-Google Apps Script מוגדרת לגישה "Anyone".',
  errConfig: 'כתובת השרת לא הוגדרה (CONFIG.GAS_URL ב-app.js).',
  noName: 'נא להזין שם משפחה.', noEvent: 'נא לסמן לפחות שבת או חג אחד.',
  tooMany: 'אפשר לסמן עד ' + CONFIG.MAX_ENTRIES + ' ימים בבת אחת.',
  dup: (name) => 'ההרשמה של ' + name + ' כבר קיימת במועדים שסומנו.',
  saved: 'ההרשמה התקבלה', updated: 'ההרשמה עודכנה', noChange: 'לא בוצע שינוי', deleted: 'ההרשמה נמחקה',
  partial: (n) => 'ההרשמה התקבלה (' + (n === 1 ? 'יום אחד כבר היה רשום' : n + ' ימים כבר היו רשומים') + ')',
  picked: (label) => 'סומן: ' + label + '. הזינו שם ולחצו "' + STR.submit + '".',
  editBanner: (g) => 'מצב עריכה: ' + g.name + ', ' + g.label + '. אפשר לשנות את השם ו/או את המועד.',
  shareSaved: '✨ ההרשמה התקבלה בהצלחה!', shareUpdated: '✨ ההרשמה עודכנה בהצלחה!',
  edit: 'עריכה', del: 'מחיקה', signup: 'הירשמו', seq: '⚡ רצף חג-שבת',
  delMsg: (g) => 'למחוק את ההרשמה של ' + g.name + ' (' + g.label + ')?',
  gapTitle: (n) => '⚠️ ' + (n === 1 ? 'מועד אחד בלי נרשמים' : n + ' מועדים בלי נרשמים'),
  version: (v) => 'גרסה ' + v, server: (v) => ' · שרת ' + v
};

const state = {
  hebItems: [], eventsStatus: 'loading',          // loading | ok | stale | error
  rows: [], regsStatus: 'loading', regsError: '', // loading | ok | cached | error
  events: [], groups: { future: [], history: [] }, items: [],
  parashaMap: new Map(), parashaBusy: false,
  selectedKeys: new Set(), shown: CONFIG.INITIAL_EVENTS_SHOWN,
  editing: null,  // { ids, name, key, label, trigger }
  deleting: null, deleteTrigger: null,
  tab: 'future', busy: false, today: '', lastRegsFetch: 0, regsInflight: null,
  pickerSig: '', namesSig: '', deferredInstall: null
};

/* ---------- עזרים ---------- */
const $ = (id) => document.getElementById(id);
function h(tag, props, children) {
  const e = document.createElement(tag);
  Object.keys(props || {}).forEach(function (k) {
    const v = props[k];
    if (v == null || v === false) return;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'data') Object.keys(v).forEach(function (d) { e.dataset[d] = v[d]; });
    else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  });
  (children || []).forEach(function (c) { if (c != null && c !== false) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
  return e;
}
function todayStr() { return toDateStr(new Date()); }
function lsGet(key) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* מצב פרטי / מלא - מתעלמים */ } }
function reducedMotion() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
function scrollToEl(el) { el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' }); }
function appUrl() { return location.origin + location.pathname; }

// הודעות הטופס: הצלחה ומידע ב-role=status, שגיאה ב-role=alert. אייקון לפי הסוג (לא רק צבע).
function setMsg(text, type) {
  const ok = $('formMsg'), err = $('formErr');
  ok.textContent = type === 'error' ? '' : (text || '');
  ok.className = 'form-msg' + (type && type !== 'error' ? ' ' + type : '');
  err.textContent = type === 'error' ? text : '';
}
function clearFormMessages() { setMsg(''); $('shareBox').hidden = true; }
// הודעה צפה בתחתית המסך: לפעולות מהרשימה, כי הטופס יכול להיות מחוץ לתצוגה
let toastTimer = null;
function toast(text, type) {
  const el = $('toast');
  el.textContent = text; el.className = 'toast ' + (type || 'ok'); el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.hidden = true; }, type === 'error' ? 8000 : 4000);
}

/* ---------- רשת: Hebcal ---------- */
function hebcalUrl(start, end, withMajor) {
  return HEBCAL_URL + '?v=1&cfg=json&' + (withMajor ? 'maj=on&' : '') + 's=on&i=on&start=' + start + '&end=' + end;
}
async function fetchHebcal(start, end, parashaOnly) {
  const parts = await Promise.all(chunkRanges(start, end, CONFIG.CHUNK_DAYS).map(async function (r) {
    const res = await fetch(hebcalUrl(r[0], r[1], !parashaOnly));
    if (!res.ok) throw new Error('Hebcal HTTP ' + res.status);
    return normalizeHebcal(await res.json(), parashaOnly);
  }));
  return [].concat.apply([], parts);
}
async function loadEvents() {
  const today = todayStr();
  const cache = lsGet(LS.EVENTS);
  if (eventsCacheValid(cache, today, Date.now(), CONFIG.EVENTS_CACHE_MAX_AGE_MS, CONFIG.HORIZON_DAYS)) {
    state.hebItems = cache.items; state.eventsStatus = 'ok';
    return;
  }
  const start = addDays(today, -3), end = addDays(today, CONFIG.HORIZON_DAYS);
  try {
    const items = await fetchHebcal(start, end, false);
    state.hebItems = items; state.eventsStatus = 'ok';
    lsSet(LS.EVENTS, { savedAt: Date.now(), start: start, end: end, items: items });
  } catch (e) {
    // בלי נתוני Hebcal לא בונים אירועים: רשימת "שבתות בלבד" בלי חגים הייתה מטעה בשקט
    if (cache && Array.isArray(cache.items)) { state.hebItems = cache.items; state.eventsStatus = 'stale'; }
    else state.eventsStatus = 'error';
  }
}

/* ---------- רשת: GAS ---------- */
async function gasCall(url, options) {
  if (!CONFIG.GAS_URL) return { kind: 'config' };
  let text;
  try {
    const res = await fetch(url, options);
    text = await res.text();
  } catch (e) { return { kind: 'network' }; }
  return parseServerResponse(text, CONFIG.SERVER_VERSION);
}
function gasGet() { return gasCall(CONFIG.GAS_URL + (CONFIG.GAS_URL.indexOf('?') < 0 ? '?' : '&') + 'v=3', {}); }
function gasPost(payload) {
  // text/plain: בלי בקשת preflight מול GAS
  return gasCall(CONFIG.GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
}
function errText(kind) { return kind === 'config' ? STR.errConfig : kind === 'deploy' ? STR.errDeploy : kind === 'old' ? STR.errOld : STR.errNet; }
// קריאה במקביל משתפת את הקריאה שכבר בדרך. fresh: אחרי כתיבה, קריאה שנשלחה לפניה לא מספיקה.
function loadRegs(fresh) {
  if (state.regsInflight && !fresh) return state.regsInflight;
  const before = state.regsInflight || Promise.resolve();
  state.lastRegsFetch = Date.now();
  const p = before.then(fetchRegs, fetchRegs).finally(function () {
    if (state.regsInflight === p) state.regsInflight = null;
    state.lastRegsFetch = Date.now();
  });
  state.regsInflight = p;
  return p;
}
// כשל לא מוחק את מה שכבר מוצג
async function fetchRegs() {
  const r = await gasGet();
  if (r.kind === 'ok' && r.data.status === 'success' && Array.isArray(r.data.data)) {
    state.rows = r.data.data; state.regsStatus = 'ok'; state.regsError = '';
    lsSet(LS.REGS, { savedAt: Date.now(), rows: state.rows });
    $('serverVer').textContent = STR.server(r.data.ver);
    return true;
  }
  // שגיאה שהשרת מחזיר (למשל חסרה כותרת: יש להריץ migrateSheet) מוצגת כלשונה
  if (r.kind === 'ok' && r.data.status === 'error') { state.regsStatus = 'error'; state.regsError = r.data.message || STR.errNet; return false; }
  const kind = r.kind === 'ok' ? 'invalid' : r.kind;
  const soft = kind === 'network' || kind === 'invalid';
  if (soft && state.rows.length) { state.regsStatus = 'cached'; return false; }
  const cached = lsGet(LS.REGS);
  if (soft && cached && Array.isArray(cached.rows)) { state.rows = cached.rows; state.regsStatus = 'cached'; return false; }
  state.regsStatus = 'error'; state.regsError = errText(kind);
  return false;
}

/* ---------- חישוב ורינדור ---------- */
function eventsReady() { return state.eventsStatus === 'ok' || state.eventsStatus === 'stale'; }
function recompute() {
  state.today = todayStr();
  state.events = eventsReady() ? buildEvents(state.hebItems, state.today, addDays(state.today, CONFIG.HORIZON_DAYS), CONFIG.EXCLUDED_YOMTOV_TITLES) : [];
  // אירוע שנבחר וחלף הזמן שלו יוצא מהבחירה
  Array.from(state.selectedKeys).forEach(function (k) { if (!eventByKey(k)) state.selectedKeys.delete(k); });
  const g = groupRegistrations(state.rows, state.events, state.today);
  applyParasha(g.history, state.parashaMap);
  state.groups = g;
  state.items = buildFutureItems(g.future, state.events);
}
function eventByKey(key) { return state.events.find(function (e) { return e.key === key; }); }
function stateBlock(text, isError, onRetry) {
  return h('div', { class: 'empty' + (isError ? ' is-error' : '') }, [
    h('p', { text: text, role: isError ? 'alert' : null }),
    onRetry ? h('button', { type: 'button', class: 'btn btn-retry', text: STR.retry, onclick: onRetry }) : null
  ]);
}
function updateNotice() {
  $('notice').textContent = state.regsStatus === 'cached' || state.eventsStatus === 'stale' ? STR.cached : '';
}
function renderAll() { renderPicker(); renderLists(); renderNames(); renderFormMode(); updateNotice(); }

// אירוע מסומן לעולם לא מוסתר: "צמצם" לא מסתיר בחירה שתישלח
function ensureShown() {
  let last = -1;
  state.events.forEach(function (e, i) { if (state.selectedKeys.has(e.key)) last = i; });
  if (last >= 0) state.shown = Math.max(state.shown, last + 1);
}
// force: נבנה מחדש גם כשהאירועים לא השתנו. בלי force רענון ברקע לא מאבד פוקוס ובחירה.
function renderPicker(force) {
  const sig = [state.eventsStatus, state.shown, state.editing ? 1 : 0,
    state.events.map(function (e) { return e.key + e.label + e.dateText + e.seq; }).join(',')].join('~');
  if (!force && sig === state.pickerSig) return;
  state.pickerSig = sig;
  const box = $('eventPicker');
  const active = document.activeElement;
  const focusId = active && active.id;
  const focusKey = active && active.name === 'ev' && box.contains(active) ? active.value : null;
  box.replaceChildren();
  $('moreRow').hidden = true;
  if (state.eventsStatus === 'loading') { box.appendChild(stateBlock(STR.loadingEvents, false, null)); return; }
  if (state.eventsStatus === 'error') { box.appendChild(stateBlock(STR.eventsErr, true, function () { refreshAll(true); })); return; }
  ensureShown();
  const editing = !!state.editing;
  state.events.slice(0, state.shown).forEach(function (ev) {
    const on = state.selectedKeys.has(ev.key);
    const dateId = 'evd-' + ev.key;
    const input = h('input', { type: editing ? 'radio' : 'checkbox', class: 'event-check', name: 'ev', value: ev.key, 'aria-describedby': dateId });
    input.checked = on;
    box.appendChild(h('label', { class: 'event ' + ev.kind + (on ? ' checked' : '') }, [
      input,
      h('span', { class: 'event-body' }, [
        h('span', { class: 'event-title', text: ev.label }),
        h('span', { class: 'event-date', id: dateId, text: ev.dateText }),
        ev.seq ? h('span', { class: 'event-seq', text: STR.seq }) : null
      ])
    ]));
  });
  // "הצג עוד" מימין, "צמצם" משמאלו. צמצם מופיע רק אחרי שהרשימה הורחבה.
  const total = state.events.length;
  const canMore = state.shown < total;
  const canLess = total > CONFIG.INITIAL_EVENTS_SHOWN && state.shown > CONFIG.INITIAL_EVENTS_SHOWN;
  $('moreBtn').hidden = !canMore;
  $('lessBtn').hidden = !canLess;
  $('moreRow').hidden = !(canMore || canLess);
  if (focusKey) { const again = box.querySelector('input[value="' + focusKey + '"]'); if (again) again.focus(); }
  else if (focusId === 'moreBtn' && !canMore && canLess) $('lessBtn').focus();
  else if (focusId === 'lessBtn' && !canLess && canMore) $('moreBtn').focus();
}
function renderFormMode() {
  const ed = state.editing;
  $('formCard').classList.toggle('edit-mode', !!ed);
  $('editBanner').hidden = !ed;
  $('editBanner').textContent = ed ? STR.editBanner(ed) : '';
  $('cancelBtn').hidden = !ed;
  $('pickerHint').hidden = !!ed;
  if (!state.busy) $('submitBtn').textContent = ed ? STR.update : STR.submit;
}
function renderNames() {
  const names = nameSuggestions(state.rows);
  const sig = names.join('|');
  if (sig === state.namesSig) return;
  state.namesSig = sig;
  $('nameList').replaceChildren.apply($('nameList'), names.map(function (n) { return h('option', { value: n }); }));
}

function regCard(g, past) {
  const actions = !past && !g.readonly ? h('div', { class: 'card-actions' }, [
    h('button', { type: 'button', class: 'btn btn-edit', text: STR.edit, 'aria-label': STR.edit + ': ' + g.name,
      data: { gid: g.key + '|' + g.name }, disabled: state.busy, onclick: function () { startEdit(g); } }),
    h('button', { type: 'button', class: 'btn btn-del', text: STR.del, 'aria-label': STR.del + ': ' + g.name,
      data: { gid: g.key + '|' + g.name }, disabled: state.busy, onclick: function (e) { openDelete(g, e.currentTarget); } })
  ]) : null;
  return h('article', { class: 'card ' + g.kind + (past ? ' history' : '') }, [
    h('div', { class: 'card-main' }, [
      h('h3', { class: 'card-title', text: g.name }),
      h('div', { class: 'card-date', text: g.spanText }),
      h('div', { class: 'card-tags' }, [h('span', { class: 'tag ' + g.kind, text: g.label + (g.kind === 'holiday' ? ' 🍷' : ' 🕯️') })]),
      g.seq && !past ? h('div', { class: 'card-alert', text: STR.seq }) : null
    ]),
    actions
  ]);
}
function gapBlock(events) {
  return h('section', { class: 'gap', 'aria-label': STR.gapTitle(events.length).replace('⚠️ ', '') }, [
    h('div', { class: 'gap-title', text: STR.gapTitle(events.length) }),
    h('ul', { class: 'gap-list' }, events.map(function (ev) {
      return h('li', { class: 'gap-item' }, [
        h('span', { class: 'gap-info' }, [h('span', { class: 'gap-name', text: ev.label }), h('span', { class: 'gap-date', text: ev.dateText })]),
        h('button', { type: 'button', class: 'btn btn-reg', text: STR.signup, 'aria-label': STR.signup + ': ' + ev.label,
          disabled: state.busy, onclick: function () { pickFromGap(ev.key); } })
      ]);
    }))
  ]);
}
function renderLists() {
  const fut = $('panel-future'), past = $('panel-history');
  // שמירת הפוקוס על כפתור בכרטיס (עריכה/מחיקה) לאורך רענון ברקע
  const a = document.activeElement;
  const keep = a && a.dataset && a.dataset.gid && fut.contains(a) ? { gid: a.dataset.gid, cls: a.classList.contains('btn-del') ? '.btn-del' : '.btn-edit' } : null;
  fut.replaceChildren(); past.replaceChildren();
  if (state.regsStatus === 'error') {
    [fut, past].forEach(function (p) { p.appendChild(stateBlock(STR.regsErr(state.regsError), true, function () { refreshAll(true); })); });
  } else if (state.regsStatus === 'loading') {
    [fut, past].forEach(function (p) { p.appendChild(stateBlock(STR.loadingRegs, false, null)); });
  } else {
    if (!state.items.length) fut.appendChild(stateBlock(STR.empty, false, null));
    state.items.forEach(function (it) { fut.appendChild(it.type === 'gap' ? gapBlock(it.events) : regCard(it.g, false)); });
    if (!state.groups.history.length) past.appendChild(stateBlock(STR.empty, false, null));
    state.groups.history.forEach(function (g) { past.appendChild(regCard(g, true)); });
  }
  if (keep) {
    const again = Array.prototype.find.call(fut.querySelectorAll(keep.cls + '[data-gid]'), function (b) { return b.dataset.gid === keep.gid; });
    if (again) again.focus();
  }
}

/* ---------- לשוניות ---------- */
function setTab(name, focus) {
  state.tab = name;
  ['future', 'history'].forEach(function (t) {
    const sel = t === name;
    $('tab-' + t).setAttribute('aria-selected', sel ? 'true' : 'false');
    $('tab-' + t).tabIndex = sel ? 0 : -1;
    $('panel-' + t).hidden = !sel;
  });
  if (focus) $('tab-' + name).focus();
}

/* ---------- בורר, הרשמה ועריכה ---------- */
function onPickerChange(e) {
  const input = e.target;
  if (!input || input.name !== 'ev') return;
  if (input.type === 'radio') state.selectedKeys = new Set([input.value]);
  else if (input.checked) state.selectedKeys.add(input.value);
  else state.selectedKeys.delete(input.value);
  document.querySelectorAll('#eventPicker .event').forEach(function (lab) { lab.classList.toggle('checked', lab.querySelector('input').checked); });
  setMsg('');
}
function resetForm() {
  $('name').value = '';
  state.selectedKeys = new Set();
  state.editing = null;
  state.shown = CONFIG.INITIAL_EVENTS_SHOWN; // אחרי שליחה או ביטול הרשימה חוזרת להיות קצרה
}
function startEdit(g) {
  if (state.busy) return; // שליחה בדרך: לא מחליפים את מצב הטופס באמצע
  clearFormMessages();
  state.editing = { ids: g.ids.slice(), name: g.name, key: g.key, label: g.label, trigger: g.key + '|' + g.name };
  state.selectedKeys = new Set(eventByKey(g.key) ? [g.key] : []);
  $('name').value = g.name;
  renderPicker(true); renderFormMode();
  scrollToEl($('formCard'));
  $('name').focus({ preventScroll: true });
}
function cancelEdit(restoreFocus) {
  if (state.busy) return;
  const trigger = state.editing && state.editing.trigger;
  resetForm(); clearFormMessages();
  renderPicker(true); renderFormMode();
  if (restoreFocus && trigger) {
    const btn = Array.prototype.find.call(document.querySelectorAll('.btn-edit[data-gid]'), function (b) { return b.dataset.gid === trigger; });
    if (btn) btn.focus();
  }
}
// "הירשמו" בשורת מועדים ריקים: מסמן את המועד בטופס (ומרחיב את הרשימה אם צריך) וגולל אליו
function pickFromGap(key) {
  if (state.busy) return;
  if (state.editing) cancelEdit(false);
  const ev = eventByKey(key);
  if (!ev) return;
  state.selectedKeys.add(key);
  const idx = state.events.indexOf(ev);
  state.shown = Math.max(state.shown, idx + 1);
  renderPicker(true);
  setMsg(STR.picked(ev.label), 'info');
  scrollToEl($('formCard'));
  const name = $('name');
  if (!name.value.trim()) name.focus({ preventScroll: true });
  else { const box = document.querySelector('#eventPicker input[value="' + key + '"]'); if (box) box.focus({ preventScroll: true }); }
}
// בזמן שליחה: כפתור השליחה נעול, וכפתורי הרשימה (עריכה, מחיקה, הירשמו) לא פועלים
function setBusy(on, label) {
  state.busy = on;
  $('submitBtn').disabled = on;
  $('submitBtn').classList.toggle('is-busy', on && !!label);
  if (on && label) $('submitBtn').textContent = label;
  $('regForm').setAttribute('aria-busy', on ? 'true' : 'false');
  document.querySelectorAll('.cards-list .btn').forEach(function (b) { if (!b.classList.contains('btn-retry')) b.disabled = on; });
  if (!on) renderFormMode();
}
async function onSubmit(e) {
  e.preventDefault();
  if (state.busy) return;
  clearFormMessages();
  const name = normalizeName($('name').value).slice(0, CONFIG.MAX_NAME).trim();
  if (!name) { setMsg(STR.noName, 'error'); $('name').focus(); return; }
  const entries = buildEntries(state.events, state.selectedKeys);
  if (!entries.length) { setMsg(STR.noEvent, 'error'); return; }
  if (entries.length > CONFIG.MAX_ENTRIES) { setMsg(STR.tooMany, 'error'); return; }
  const editing = state.editing;
  if (editing && isEditUnchanged(editing, name, state.selectedKeys)) { setMsg(STR.noChange, 'info'); return; }
  if (!editing && isFullDuplicate(state.rows, name, entries)) { setMsg(STR.dup(name), 'error'); return; }
  const chosen = state.events.filter(function (ev) { return state.selectedKeys.has(ev.key); });
  setBusy(true, STR.sending);
  const r = await gasPost(editing ? { action: 'edit', ids: editing.ids, name: name, entries: entries } : { action: 'register', name: name, entries: entries });
  setBusy(false);
  if (r.kind !== 'ok') { setMsg(errText(r.kind), 'error'); return; }
  const d = r.data;
  if (d.status === 'success') {
    const skipped = d.skipped || [];
    resetForm();
    renderPicker(true); renderFormMode();
    setMsg(skipped.length ? STR.partial(skipped.length) : editing ? STR.updated : STR.saved, 'ok');
    // בהודעה רק אירועים שנרשם להם לפחות יום אחד (ימים שכבר היו רשומים לא נכללים)
    const shared = chosen.filter(function (ev) { return ev.days.some(function (day) { return skipped.indexOf(day) < 0; }); });
    $('shareTitle').textContent = editing ? STR.shareUpdated : STR.shareSaved;
    $('whatsappLink').href = 'https://wa.me/?text=' + encodeURIComponent(buildShareMessage(name, shared, appUrl()));
    $('shareBox').hidden = false;
    await loadRegs(true); recompute(); renderAll(); resolveHistoryParasha();
    return;
  }
  setMsg(d.message || STR.errNet, 'error');
  if (editing && d.status === 'error' && /לא נמצאה/.test(d.message || '')) {
    // ההרשמה נמחקה או שונתה על ידי אחר: יוצאים ממצב עריכה (השם והבחירה נשארים) ומרעננים
    state.editing = null; renderPicker(true); renderFormMode();
  }
  if (d.status === 'duplicate' || editing) { await loadRegs(true); recompute(); renderLists(); renderNames(); updateNotice(); }
}

/* ---------- מחיקה ---------- */
function openDelete(g, trigger) {
  if (state.busy) return; // שליחת טופס בדרך: לא פותחים חלון שאי אפשר לאשר בו
  state.deleting = g; state.deleteTrigger = trigger;
  $('delErr').textContent = '';
  $('delMsg').textContent = STR.delMsg(g);
  $('delConfirm').disabled = false; $('delCancel').disabled = false;
  $('delDialog').showModal();
}
async function confirmDelete() {
  const g = state.deleting;
  if (!g || state.busy) return;
  setBusy(true); $('delConfirm').disabled = true; $('delCancel').disabled = true; $('delErr').textContent = '';
  $('delConfirm').classList.add('is-busy');
  const r = await gasPost({ action: 'delete', ids: g.ids });
  setBusy(false); $('delConfirm').disabled = false; $('delCancel').disabled = false;
  $('delConfirm').classList.remove('is-busy');
  if (r.kind !== 'ok') { $('delErr').textContent = errText(r.kind); return; }
  // "לא נמצאה" = מישהו אחר כבר מחק: נחשב הצלחה
  if (r.data.status === 'success' || (r.data.status === 'error' && /לא נמצאה/.test(r.data.message || ''))) {
    state.deleteTrigger = null; // הכפתור כבר לא יהיה קיים
    $('delDialog').close();
    toast(STR.deleted, 'ok');
    if (state.editing && state.editing.ids.some(function (id) { return g.ids.indexOf(id) >= 0; })) { resetForm(); clearFormMessages(); renderPicker(true); renderFormMode(); }
    await loadRegs(true); recompute(); renderAll(); resolveHistoryParasha();
    $('tab-' + state.tab).focus();
    return;
  }
  $('delErr').textContent = r.data.message || STR.errNet;
}
function onDeleteClosed() {
  const t = state.deleteTrigger;
  state.deleting = null; state.deleteTrigger = null;
  if (!t) return;
  if (document.contains(t)) { t.focus(); return; }
  // הרשימה רועננה ברקע בזמן שהחלון היה פתוח: מחפשים את הכפתור החדש של אותה הרשמה
  const same = Array.prototype.find.call(document.querySelectorAll('.btn-del[data-gid]'), function (b) { return b.dataset.gid === t.dataset.gid; });
  if (same) same.focus();
}

/* ---------- פרשות להיסטוריה ישנה: טווח אחד ומטמון קבוע ---------- */
async function resolveHistoryParasha() {
  if (state.parashaBusy || state.regsStatus === 'error') return;
  const missing = missingParashaSaturdays(state.groups.history, state.parashaMap);
  if (!missing.length) return;
  state.parashaBusy = true;
  try {
    const start = missing[0], end = missing[missing.length - 1];
    const items = await fetchHebcal(start, end, true);
    items.forEach(function (it) { if (it.hebrew) state.parashaMap.set(it.date, it.hebrew); });
    // שבת שהוחזרה בלי פרשה (למשל שבת חג) נשמרת כריקה, כדי לא לשאול שוב
    for (let d = start; d <= end; d = addDays(d, 7)) if (!state.parashaMap.has(d)) state.parashaMap.set(d, '');
    const obj = {};
    state.parashaMap.forEach(function (v, k) { obj[k] = v; });
    lsSet(LS.PARASHA, obj);
    applyParasha(state.groups.history, state.parashaMap);
    renderLists();
  } catch (e) { /* נשארת התווית "שבת" */ }
  state.parashaBusy = false;
}

/* ---------- טעינה, רענון והתקנה ---------- */
async function refreshAll(showLoading) {
  if (showLoading) {
    if (!state.rows.length) state.regsStatus = 'loading';
    if (!state.hebItems.length) state.eventsStatus = 'loading';
    recompute(); renderAll();
  }
  await Promise.all([loadEvents(), loadRegs()]);
  recompute(); renderAll();
  resolveHistoryParasha();
}
// חזרה לאפליקציה אחרי יותר מדקה: רענון שקט. גם אירועים מהמטמון (כשל רשת) או יום שהתחלף נטענים מחדש.
async function silentRefresh() {
  const dayChanged = todayStr() !== state.today;
  if (!dayChanged && Date.now() - state.lastRegsFetch <= CONFIG.REGS_REFRESH_AFTER_MS) return;
  const retryEvents = dayChanged || state.eventsStatus !== 'ok';
  if (retryEvents) await loadEvents();
  await loadRegs();
  recompute();
  if (retryEvents) renderAll(); else { renderLists(); renderNames(); updateNotice(); }
  resolveHistoryParasha();
}
function isStandalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
}
function bindInstall() {
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    state.deferredInstall = e;
    if (!isStandalone()) $('installRow').hidden = false;
  });
  window.addEventListener('appinstalled', function () { state.deferredInstall = null; $('installRow').hidden = true; });
  $('installBtn').addEventListener('click', async function () {
    const p = state.deferredInstall;
    if (!p) return;
    p.prompt();
    try { await p.userChoice; } catch (e) { /* בוטל */ }
    state.deferredInstall = null; $('installRow').hidden = true;
  });
}

function bindUI() {
  $('regForm').addEventListener('submit', onSubmit);
  $('eventPicker').addEventListener('change', onPickerChange);
  $('cancelBtn').addEventListener('click', function () { cancelEdit(true); });
  $('moreBtn').addEventListener('click', function () { state.shown += CONFIG.MORE_STEP; renderPicker(true); });
  $('lessBtn').addEventListener('click', function () {
    state.shown = CONFIG.INITIAL_EVENTS_SHOWN; ensureShown(); renderPicker(true);
    $('pickerGroup').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
  });
  $('toast').addEventListener('click', function () { $('toast').hidden = true; });
  $('delConfirm').addEventListener('click', confirmDelete);
  $('delCancel').addEventListener('click', function () { if (!state.busy) $('delDialog').close(); });
  $('delDialog').addEventListener('close', onDeleteClosed);
  // Escape בזמן מחיקה בדרך היה סוגר את החלון ומעלים שגיאה אפשרית
  $('delDialog').addEventListener('cancel', function (e) { if (state.busy) e.preventDefault(); });
  ['future', 'history'].forEach(function (t) {
    $('tab-' + t).addEventListener('click', function () { setTab(t, false); });
    $('tab-' + t).addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setTab(t === 'future' ? 'history' : 'future', true); }
      else if (e.key === 'Home') { e.preventDefault(); setTab('future', true); }
      else if (e.key === 'End') { e.preventDefault(); setTab('history', true); }
    });
  });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') silentRefresh(); });
  bindInstall();
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* בלי SW האפליקציה עובדת */ }); });
  }
}

function init() {
  $('clientVer').textContent = STR.version(CONFIG.CLIENT_VERSION);
  bindUI();
  // הצגה מיידית מהמטמון, ואז רשת ברקע
  const ec = lsGet(LS.EVENTS), rc = lsGet(LS.REGS), pc = lsGet(LS.PARASHA);
  if (ec && Array.isArray(ec.items) && ec.items.length) { state.hebItems = ec.items; state.eventsStatus = 'stale'; }
  if (rc && Array.isArray(rc.rows)) { state.rows = rc.rows; state.regsStatus = 'cached'; }
  if (pc && typeof pc === 'object') state.parashaMap = new Map(Object.keys(pc).map(function (k) { return [k, pc[k]]; }));
  recompute(); renderAll();
  // בטעינה הראשונה עוד אין "אין חיבור": ההודעה תופיע רק אם הרשת נכשלה
  $('notice').textContent = '';
  refreshAll(false);
}
init();
