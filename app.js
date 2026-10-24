/* שבת וחג אצל טטיי - app.js v2.1
   ארכיטקטורה: פונקציות טהורות (נבדקות ב-Node) + שכבת UI דקה.
   Hebcal נקרא עד 3 פעמים בכל 7 ימים (מטמון), ולא פעם לכל כרטיס. */
'use strict';

const CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/AKfycbyeLEhyGVsbe_1eMbFDAXDCV5x9OOPw9jvzspdSsPbqDzS3pn0ZIPp5qiSd7ZQ89vO6/exec',
  HORIZON_DAYS: 270,             // כמה ימים קדימה מציגים אירועים
  CHUNK_DAYS: 100,               // גודל טווח בקריאה אחת ל-Hebcal
  EVENTS_CACHE_MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000,
  INITIAL_EVENTS_SHOWN: 3,       // כמה מועדים מוצגים בהתחלה
  MORE_STEP: 5,                  // כמה מועדים נוספים בכל לחיצה על "הצג עוד מועדים"
  SERVER_VERSION: 2,             // חייב להתאים ל-SERVER_VERSION ב-Code.gs
  // ימי טוב שלא מוצגים לבחירה. להכללת יום כיפור: להשאיר מערך ריק.
  EXCLUDED_YOMTOV_TITLES: ['Yom Kippur']
};

const LS_EVENTS = 'tatay.events.v2';
const LS_REGS = 'tatay.regs.v2';
const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/* ---------- עזרי תאריך (זמן מקומי בלבד, בלי toISOString) ---------- */
function pad2(n) { return String(n).padStart(2, '0'); }
function toDateStr(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function parseDateStr(s) {
  const p = String(s).slice(0, 10).split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2], 12, 0, 0); // צהריים: מונע בעיות מעבר שעון
}
function addDays(s, n) { const d = parseDateStr(s); d.setDate(d.getDate() + n); return toDateStr(d); }
function dow(s) { return parseDateStr(s).getDay(); }
function fmtDM(s) { const p = s.split('-'); return p[2] + '/' + p[1]; }
function fmtDMY(s) { const p = s.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
function formatDays(days) {
  const first = days[0], last = days[days.length - 1];
  if (first === last) return 'יום ' + DAY_NAMES[dow(first)] + ', ' + fmtDMY(first);
  return DAY_NAMES[dow(first)] + ' ' + fmtDM(first) + ' - ' + DAY_NAMES[dow(last)] + ' ' + fmtDMY(last);
}

/* ---------- ניקוי טקסט ---------- */
function normalizeName(s) {
  return String(s == null ? '' : s)
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/\s+/g, ' ').trim()
    .replace(/^[=+\-@]+/, '').trim();
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* ---------- בניית רשימת האירועים מתוך פריטי Hebcal ---------- */
function holidayLabel(group, yomtov) {
  const names = [];
  group.forEach(function (d) { yomtov.get(d).forEach(function (n) { names.push(n); }); });
  const cleaned = names.map(function (n) { return n.replace(/\s*\d{4}\s*$/, '').trim(); });
  let uniq = Array.from(new Set(cleaned));
  if (group.length > 1 && uniq.length > 1) {
    // ראש השנה: "ראש השנה" + "ראש השנה ב׳" -> "ראש השנה"
    const stripped = Array.from(new Set(uniq.map(function (n) { return n.replace(/\s+[א-ת][׳']$/, '').trim(); })));
    if (stripped.length === 1) uniq = stripped;
  }
  return uniq.join(' / ');
}

function buildEvents(items, todayStr, endStr, excludedTitles) {
  excludedTitles = excludedTitles || [];
  const yomtov = new Map();      // תאריך -> שמות עבריים של ימי טוב
  const parasha = new Map();     // תאריך שבת -> פרשה
  const shabbatNote = new Map(); // תאריך -> "שבת ..." מיוחדת (לא יום טוב)

  (items || []).forEach(function (it) {
    const date = String(it.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    if (it.category === 'parashat') {
      parasha.set(date, it.hebrew || it.title || '');
    } else if (it.category === 'holiday') {
      if (it.yomtov === true) {
        const title = String(it.title || '');
        if (excludedTitles.some(function (x) { return title.indexOf(x) === 0; })) return;
        if (!yomtov.has(date)) yomtov.set(date, []);
        yomtov.get(date).push(it.hebrew || title);
      } else if (/^שבת/.test(it.hebrew || '')) {
        shabbatNote.set(date, it.hebrew);
      }
    }
  });

  const events = [];

  // 1. אירועי חג: ימי טוב רצופים הם כרטיס אחד. חול המועד אינו יום טוב, לכן
  //    סוכות/פסח מתפצלים אוטומטית ליום טוב ראשון ויום טוב אחרון.
  const ytDates = Array.from(yomtov.keys()).sort();
  let group = [];
  function flush() {
    if (!group.length) return;
    events.push({
      key: 'H-' + group[0], kind: 'holiday',
      label: holidayLabel(group, yomtov), days: group.slice()
    });
    group = [];
  }
  ytDates.forEach(function (d) {
    if (group.length && addDays(group[group.length - 1], 1) !== d) flush();
    group.push(d);
  });
  flush();

  // 2. אירועי שבת: שישי + שבת, למעט יום שכבר שייך לכרטיס חג.
  let sat = addDays(todayStr, -3);
  while (dow(sat) !== 6) sat = addDays(sat, 1);
  for (; sat <= endStr; sat = addDays(sat, 7)) {
    const fri = addDays(sat, -1);
    const days = [];
    if (!yomtov.has(fri)) days.push(fri);
    if (!yomtov.has(sat)) days.push(sat);
    if (!days.length) continue;
    let label;
    const p = parasha.get(sat);
    if (days.length === 1 && days[0] === fri) label = 'שישי - ערב חג';
    else if (p) label = 'שבת ' + (/^פרשת/.test(p) ? p : 'פרשת ' + p);
    else label = shabbatNote.get(sat) || shabbatNote.get(fri) || 'שבת';
    events.push({ key: 'S-' + sat, kind: 'shabbat', label: label, days: days });
  }

  events.forEach(function (e) {
    e.allDays = e.days.slice();
    e.seq = false;
  });
  events.sort(function (a, b) { return a.allDays[0] < b.allDays[0] ? -1 : a.allDays[0] > b.allDays[0] ? 1 : 0; });

  // 3. רצף חג-שבת: שני אירועים מסוגים שונים שצמודים ביום.
  for (let i = 1; i < events.length; i++) {
    const p = events[i - 1], c = events[i];
    if (p.kind !== c.kind && addDays(p.allDays[p.allDays.length - 1], 1) === c.allDays[0]) {
      p.seq = true; c.seq = true;
    }
  }

  // 4. מסנן עבר ואחרי האופק; ימים שעברו לא נשמרים ברישום.
  return events.filter(function (e) {
    e.days = e.days.filter(function (d) { return d >= todayStr; });
    return e.days.length > 0 && e.allDays[0] <= endStr;
  }).map(function (e) {
    e.firstDay = e.days[0];
    e.lastDay = e.allDays[e.allDays.length - 1];
    e.dateText = formatDays(e.days);
    return e;
  });
}

/* ---------- קיבוץ שורות הגיליון (שורה ליום) להרשמות ---------- */
function fallbackKey(date, eventName) {
  if (eventName && !/^שבת/.test(eventName)) return 'H-' + date;
  const d = dow(date);
  if (d === 5) return 'S-' + addDays(date, 1);
  if (d === 6) return 'S-' + date;
  return 'D-' + date;
}

function groupRegistrations(rows, events, todayStr) {
  const byDate = new Map(), byKey = new Map();
  events.forEach(function (ev) {
    byKey.set(ev.key, ev);
    ev.days.forEach(function (d) { byDate.set(d, ev); });
  });
  const groups = new Map();
  (rows || []).forEach(function (r) {
    const date = String(r.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const name = normalizeName(r.name);
    if (!name) return;
    const ev = byDate.get(date);
    const key = r.eventKey || (ev ? ev.key : fallbackKey(date, r.eventName));
    const gk = name + '|' + key;
    let g = groups.get(gk);
    if (!g) { g = { name: name, key: key, ids: [], dates: [], eventName: '' }; groups.set(gk, g); }
    g.ids.push(r.id);
    g.dates.push(date);
    if (!g.eventName && r.eventName) g.eventName = r.eventName;
  });

  const future = [], history = [];
  groups.forEach(function (g) {
    g.dates = Array.from(new Set(g.dates)).sort();
    const ev = byKey.get(g.key) || null;
    g.kind = g.key.indexOf('H-') === 0 ? 'holiday' : 'shabbat';
    g.label = ev ? ev.label : (g.eventName || (g.kind === 'holiday' ? 'חג' : 'שבת'));
    g.seq = !!(ev && ev.seq);
    let span = ev ? ev.allDays : g.dates;
    if (!ev && g.dates.length === 1 && g.kind === 'shabbat') {
      const d = g.dates[0];
      span = dow(d) === 5 ? [d, addDays(d, 1)] : dow(d) === 6 ? [addDays(d, -1), d] : [d];
    }
    g.spanText = formatDays(span);
    g.first = span[0];
    g.last = span[span.length - 1];
    (g.last >= todayStr ? future : history).push(g);
  });
  const byNameHe = function (a, b) { return a.name.localeCompare(b.name, 'he'); };
  future.sort(function (a, b) { return a.first < b.first ? -1 : a.first > b.first ? 1 : byNameHe(a, b); });
  history.sort(function (a, b) { return a.first < b.first ? 1 : a.first > b.first ? -1 : byNameHe(a, b); });
  return { future: future, history: history };
}

function buildShareMessage(name, chosen, url) {
  const lines = chosen.map(function (ev) {
    return (ev.kind === 'holiday' ? '🥂 חג: ' : '📅 ') + ev.label + ' (' + formatDays(ev.days) + ')';
  }).join('\n');
  return 'מה נשמע שבט מלקו? ✨\nלידיעתכם 📌\nרשימת שבת/חג אצל טטיי התעדכנה 🌾\n' +
    '👨‍👩‍👧‍👦 משפחה: ' + name + '\n' + lines + '\n🔗 לצפייה והרשמה: ' + url + '\nהמשך יום נפלא! 😃';
}

/* ---------- Hebcal + מטמון ---------- */
async function fetchHebcalChunk(startStr, endStr) {
  const url = 'https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&s=on&i=on&start=' + startStr + '&end=' + endStr;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Hebcal HTTP ' + res.status);
  const data = await res.json();
  return (data.items || []).filter(function (it) {
    return it.category === 'parashat' ||
      (it.category === 'holiday' && (it.yomtov === true || /^שבת/.test(it.hebrew || '')));
  }).map(function (it) {
    return { date: it.date, category: it.category, yomtov: it.yomtov === true, title: it.title, hebrew: it.hebrew };
  });
}

async function fetchEventItems(todayStr) {
  const start = addDays(todayStr, -3), end = addDays(todayStr, CONFIG.HORIZON_DAYS);
  const ranges = [];
  for (let s = start; s <= end; s = addDays(s, CONFIG.CHUNK_DAYS + 1)) {
    const e = addDays(s, CONFIG.CHUNK_DAYS);
    ranges.push([s, e < end ? e : end]);
  }
  const parts = await Promise.all(ranges.map(function (r) { return fetchHebcalChunk(r[0], r[1]); }));
  return [].concat.apply([], parts);
}

function readCache(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
}
function writeCache(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* מצב פרטי / מלא - מתעלמים */ }
}
function eventsCacheIsFresh(c, todayStr) {
  return !!(c && Array.isArray(c.items) && c.fetchedAt &&
    Date.now() - c.fetchedAt < CONFIG.EVENTS_CACHE_MAX_AGE_MS &&
    addDays(c.from, CONFIG.HORIZON_DAYS) >= addDays(todayStr, 120));
}

/* ---------- שרת (GAS) ---------- */
async function postJson(payload) {
  const res = await fetch(CONFIG.GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // בלי preflight
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch (e) { throw new Error('NON_JSON'); }
}
async function getRegistrations() {
  const res = await fetch(CONFIG.GAS_URL);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error((data && data.message) || 'תשובה לא צפויה מהשרת');
  return data;
}

/* =====================  שכבת UI  ===================== */
const state = {
  today: '', items: [], events: [], rows: [], view: { future: [], history: [] },
  tab: 'future', shown: CONFIG.INITIAL_EVENTS_SHOWN, selected: new Set(), editing: null, busy: false,
  eventsError: false, regsError: '', regsLoaded: false, lastRegsFetch: 0, pickerHtml: ''
};
const $ = function (id) { return document.getElementById(id); };

function setMsg(text, type) {
  const el = $('formMsg');
  el.textContent = text || '';
  el.className = 'form-msg' + (type ? ' ' + type : '');
}

function rebuild() {
  // בלי נתוני Hebcal לא בונים אירועים בכלל: רשימת "שבתות בלבד" בלי חגים הייתה מטעה בשקט.
  state.events = state.items.length
    ? buildEvents(state.items, state.today, addDays(state.today, CONFIG.HORIZON_DAYS), CONFIG.EXCLUDED_YOMTOV_TITLES)
    : [];
  const keys = new Set(state.events.map(function (e) { return e.key; }));
  state.selected.forEach(function (k) { if (!keys.has(k)) state.selected.delete(k); });
  state.view = groupRegistrations(state.rows, state.events, state.today);
}

function renderPicker() {
  const box = $('eventPicker'), more = $('moreBtn');
  $('pickerGroup').hidden = !!state.editing;
  let html;
  if (state.eventsError && !state.items.length) {
    html = '<p class="empty">לא הצלחנו לטעון את רשימת המועדים. בדקו חיבור לאינטרנט ו<button type="button" class="link-btn" id="retryEvents">נסו שוב</button>.</p>';
    more.hidden = true;
  } else if (!state.events.length) {
    html = '<p class="empty">טוען מועדים...</p>';
    more.hidden = true;
  } else {
    const shown = state.events.slice(0, state.shown);
    html = shown.map(function (ev) {
      const checked = state.selected.has(ev.key);
      return '<label class="event ' + ev.kind + (checked ? ' checked' : '') + '">' +
        '<input type="checkbox" class="event-check" data-key="' + esc(ev.key) + '"' + (checked ? ' checked' : '') + '>' +
        '<span class="event-body"><span class="event-title">' + esc(ev.label) + '</span>' +
        '<span class="event-date">' + esc(ev.dateText) + '</span>' +
        (ev.seq ? '<span class="event-seq">⚡ רצף חג-שבת</span>' : '') + '</span></label>';
    }).join('');
    more.hidden = state.shown >= state.events.length;
  }
  if (html !== state.pickerHtml) { box.innerHTML = html; state.pickerHtml = html; }
}

function renderCards() {
  const box = $('cardsContainer');
  const list = state.view[state.tab];
  if (state.regsError && !state.regsLoaded) {
    box.innerHTML = '<p class="empty">לא הצלחנו לטעון את ההרשמות (' + esc(state.regsError) + ').</p>';
    return;
  }
  if (!state.regsLoaded) { box.innerHTML = '<p class="empty">טוען הרשמות...</p>'; return; }
  if (!list.length) { box.innerHTML = '<p class="empty">אין הרשמות להצגה בלשונית זו.</p>'; return; }
  const isFuture = state.tab === 'future';
  box.innerHTML = list.map(function (g, i) {
    return '<article class="card ' + g.kind + (isFuture ? '' : ' history') + '">' +
      '<div class="card-main"><div class="card-title">' + esc(g.name) + '</div>' +
      '<div class="card-date">' + esc(g.spanText) + '</div>' +
      '<div class="card-tags"><span class="tag ' + g.kind + '">' + esc(g.label) + (g.kind === 'holiday' ? ' 🍷' : ' 🕯️') + '</span></div>' +
      (g.seq && isFuture ? '<div class="card-alert">⚡ רצף חג-שבת</div>' : '') + '</div>' +
      (isFuture ? '<div class="card-actions">' +
        '<button type="button" class="btn btn-edit" data-act="edit" data-i="' + i + '">שינוי שם</button>' +
        '<button type="button" class="btn btn-del" data-act="del" data-i="' + i + '">מחיקה</button></div>' : '') +
      '</article>';
  }).join('');
}

function renderNames() {
  const names = Array.from(new Set(state.rows.map(function (r) { return normalizeName(r.name); }).filter(Boolean)))
    .sort(function (a, b) { return a.localeCompare(b, 'he'); });
  $('nameList').innerHTML = names.map(function (n) { return '<option value="' + esc(n) + '"></option>'; }).join('');
}

function render() { renderPicker(); renderCards(); renderNames(); }

async function refreshEvents() {
  try {
    const items = await fetchEventItems(state.today);
    state.items = items; state.eventsError = false;
    writeCache(LS_EVENTS, { fetchedAt: Date.now(), from: state.today, items: items });
  } catch (e) {
    console.error('Hebcal', e);
    state.eventsError = true; // אם יש מטמון ישן ממשיכים איתו
  }
  rebuild();
}
async function refreshRegs() {
  try {
    state.rows = await getRegistrations();
    state.regsError = ''; state.regsLoaded = true; state.lastRegsFetch = Date.now();
    writeCache(LS_REGS, state.rows);
  } catch (e) {
    console.error('GAS', e);
    state.regsError = e.message || 'שגיאה';
  }
  rebuild();
}

function resetForm() {
  state.editing = null; state.selected.clear();
  $('regForm').reset();
  $('formCard').classList.remove('edit-mode');
  $('editBanner').hidden = true;
  $('cancelBtn').hidden = true;
  $('submitBtn').textContent = 'אישור הרשמה';
  setMsg('');
  render();
}

function startEdit(g) {
  state.editing = g;
  state.selected.clear();
  $('name').value = g.name;
  $('formCard').classList.add('edit-mode');
  $('editBanner').textContent = 'מצב עריכה: שינוי שם בהרשמה ל-' + g.label + '. לשינוי המועד, מחקו והירשמו מחדש.';
  $('editBanner').hidden = false;
  $('cancelBtn').hidden = false;
  $('submitBtn').textContent = 'עדכון שם';
  setMsg('');
  renderPicker();
  $('formCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('name').focus();
}

function friendlyError(e) {
  if (e && e.message === 'NON_JSON') return 'השרת החזיר תשובה לא תקינה. יש לוודא שהפריסה ב-Google Apps Script מוגדרת לגישה "Anyone".';
  return 'שגיאת תקשורת. בדקו חיבור לאינטרנט ונסו שוב.';
}

async function runAction(payload, okText) {
  if (state.busy) return null;
  state.busy = true;
  $('submitBtn').disabled = true;
  setMsg('שולח...', 'info');
  try {
    const data = await postJson(payload);
    if (!data || data.ver !== CONFIG.SERVER_VERSION) {
      // תשובה בלי מספר גרסה = הפריסה ב-Apps Script עדיין מריצה קוד ישן
      setMsg('השרת עדיין בגרסה ישנה. מנהל האפליקציה צריך לעדכן את הפריסה ב-Apps Script (פריסה > ניהול פריסות > גרסה חדשה).', 'error');
      return null;
    }
    if (data.status === 'success') { setMsg(okText || 'נשמר', 'ok'); return data; }
    setMsg(data.message || 'לא ניתן לשמור', 'error');
    return data;
  } catch (e) {
    setMsg(friendlyError(e), 'error');
    return null;
  } finally {
    state.busy = false;
    $('submitBtn').disabled = false;
  }
}

async function onSubmit(e) {
  e.preventDefault();
  if (state.busy) return;
  const name = normalizeName($('name').value);
  if (!name) { setMsg('נא להזין שם משפחה.', 'error'); $('name').focus(); return; }

  if (state.editing) {
    const g = state.editing;
    const data = await runAction({ action: 'rename', ids: g.ids, name: name }, 'השם עודכן');
    if (data && data.status === 'success') { resetForm(); setMsg('השם עודכן', 'ok'); await refreshRegs(); render(); }
    return;
  }

  const chosen = state.events.filter(function (ev) { return state.selected.has(ev.key); });
  if (!chosen.length) { setMsg('נא לסמן לפחות שבת או חג אחד.', 'error'); return; }

  const taken = new Set(state.rows.map(function (r) { return normalizeName(r.name).toLowerCase() + '|' + String(r.date).slice(0, 10); }));
  const entries = [];
  chosen.forEach(function (ev) {
    ev.days.forEach(function (d) { entries.push({ date: d, eventKey: ev.key, eventName: ev.label }); });
  });
  if (entries.every(function (en) { return taken.has(name.toLowerCase() + '|' + en.date); })) {
    setMsg('ההרשמה של ' + name + ' כבר קיימת במועדים שסומנו.', 'error');
    return;
  }

  const data = await runAction({ action: 'register', name: name, entries: entries }, 'ההרשמה התקבלה');
  if (data && data.status === 'success') {
    showShare(name, chosen);
    const extra = data.skipped && data.skipped.length ? ' (' + data.skipped.length + ' ימים כבר היו רשומים)' : '';
    resetForm();
    setMsg('ההרשמה התקבלה' + extra, 'ok');
    await refreshRegs(); render();
  } else if (data && data.status === 'duplicate') {
    await refreshRegs(); render();
  }
}

function showShare(name, chosen) {
  const url = location.origin + location.pathname;
  $('whatsappLink').href = 'https://wa.me/?text=' + encodeURIComponent(buildShareMessage(name, chosen, url));
  $('shareBox').hidden = false;
}

async function onDelete(g) {
  if (!window.confirm('למחוק את ההרשמה של ' + g.name + ' (' + g.label + ')?')) return;
  const data = await runAction({ action: 'delete', ids: g.ids }, 'ההרשמה נמחקה');
  if (data && data.status === 'success') { await refreshRegs(); render(); }
}

function bindUI() {
  $('regForm').addEventListener('submit', onSubmit);
  $('cancelBtn').addEventListener('click', resetForm);
  $('moreBtn').addEventListener('click', function () { state.shown += CONFIG.MORE_STEP; renderPicker(); });
  $('eventPicker').addEventListener('change', function (e) {
    const t = e.target;
    if (!t.classList || !t.classList.contains('event-check')) return;
    if (t.checked) state.selected.add(t.getAttribute('data-key')); else state.selected.delete(t.getAttribute('data-key'));
    const lbl = t.closest('label'); if (lbl) lbl.classList.toggle('checked', t.checked);
    setMsg('');
  });
  $('eventPicker').addEventListener('click', function (e) {
    if (e.target && e.target.id === 'retryEvents') { refreshEvents().then(render); }
  });
  $('cardsContainer').addEventListener('click', function (e) {
    const b = e.target.closest ? e.target.closest('button[data-act]') : null;
    if (!b) return;
    const g = state.view.future[Number(b.getAttribute('data-i'))];
    if (!g) return;
    if (b.getAttribute('data-act') === 'edit') startEdit(g); else onDelete(g);
  });
  document.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.tab = btn.getAttribute('data-tab');
      document.querySelectorAll('.tab-btn').forEach(function (b) {
        const on = b === btn; b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      renderCards();
    });
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && Date.now() - state.lastRegsFetch > 60000) refreshRegs().then(render);
  });
}

async function init() {
  state.today = toDateStr(new Date());
  bindUI();
  const ec = readCache(LS_EVENTS);
  if (ec && Array.isArray(ec.items)) state.items = ec.items;
  const rc = readCache(LS_REGS);
  if (Array.isArray(rc)) { state.rows = rc; state.regsLoaded = true; }
  rebuild();
  render();                                   // הצגה מיידית מהמטמון
  const tasks = [refreshRegs()];
  if (!eventsCacheIsFresh(ec, state.today)) tasks.push(refreshEvents());
  await Promise.allSettled(tasks);
  render();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildEvents: buildEvents, groupRegistrations: groupRegistrations, normalizeName: normalizeName,
    formatDays: formatDays, buildShareMessage: buildShareMessage, addDays: addDays, esc: esc, toDateStr: toDateStr,
    eventsCacheIsFresh: eventsCacheIsFresh, CONFIG: CONFIG };
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
}
