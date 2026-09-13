/**
 * אפליקציית "שבת וחג אצל טטיי" - מנהל לוגיקה ו-DOM (app.js)
 */

// ==========================================
// 1. הגדרות וקונפיגורציה (CONFIG & STATE)
// ==========================================
const CONFIG = {
  // כתובת שרת ה-GAS (יש להחליף בכתובת ה-Web App הרישמית שלך)
  GAS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbyeLEhyGVsbe_1eMbFDAXDCV5x9OOPw9jvzspdSsPbqDzS3pn0ZIPp5qiSd7ZQ89vO6/exec', 
  HEBCAL_API_BASE: 'https://www.hebcal.com/hebcal',
  CACHE_KEY_HEBCAL: 'tatei_hebcal_cache_v1',
  CACHE_TTL_MS: 24 * 60 * 60 * 1000 // מטמון ל-24 שעות
};

const AppState = {
  currentView: 'calendar',
  events: [],
  userRsvps: [],
  selectedEventForConf: null
};

// ==========================================
// 2. אתחול האפליקציה (INITIALIZATION)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  loadAppContent();
});

function initNavigation() {
  // הגדרת מאזיני לחיצה לכפתורי הניווט
  document.querySelectorAll('.nav-item').forEach(button => {
    button.addEventListener('click', (e) => {
      const viewTarget = button.id.replace('nav-', '');
      switchView(viewTarget);
    });
  });
}

// ==========================================
// 3. ניהול תצוגות (SPA NAVIGATION)
// ==========================================
function switchView(viewName) {
  const views = document.querySelectorAll('.app-view');
  views.forEach(el => el.classList.add('hidden'));

  const targetView = document.getElementById(`view-${viewName}`);
  if (targetView) {
    targetView.classList.remove('hidden');
    AppState.currentView = viewName;
  }

  // עדכון עיצוב כפתורי הניווט בסרגל התחתון
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.remove('text-orange-700', 'font-bold');
    el.classList.add('text-neutral-500', 'font-medium');
  });

  const activeNav = document.getElementById(`nav-${viewName}`);
  if (activeNav) {
    activeNav.classList.remove('text-neutral-500', 'font-medium');
    activeNav.classList.add('text-orange-700', 'font-bold');
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ==========================================
// 4. טעינת נתונים ומנגנון Caching (DATA & CACHE)
// ==========================================
async function loadAppContent() {
  try {
    const [hebcalData, gasData] = await Promise.all([
      getHebcalDataWithCache(),
      fetchGasRsvps()
    ]);

    AppState.events = processEventsData(hebcalData, gasData);
    renderCalendarCards();
    renderMyRSVPs();
  } catch (error) {
    console.error('שגיאה שטעינת נתוני האפליקציה:', error);
  }
}

async function getHebcalDataWithCache() {
  const cached = localStorage.getItem(CONFIG.CACHE_KEY_HEBCAL);
  const now = Date.now();

  if (cached) {
    const { timestamp, data } = JSON.parse(cached);
    if (now - timestamp < CONFIG.CACHE_TTL_MS) {
      return data; // החזרת נתונים מהמטמון
    }
  }

  // שליפה עדכנית מ-Hebcal במידה והמטמון פג תוקף
  const currentYear = new Date().getFullYear();
  const url = `${CONFIG.HEBCAL_API_BASE}?v=1&cfg=json&maj=on&min=off&mod=on&nx=on&year=${currentYear}&month=x&ss=on&mf=on&c=on&geo=id&city=IL-Jerusalem&M=on&s=on`;

  const response = await fetch(url);
  const data = await response.json();

  // שמירה במטמון
  localStorage.setItem(CONFIG.CACHE_KEY_HEBCAL, JSON.stringify({
    timestamp: now,
    data: data
  }));

  return data;
}

async function fetchGasRsvps() {
  if (!CONFIG.GAS_SCRIPT_URL || CONFIG.GAS_SCRIPT_URL.includes('YOUR_GAS')) {
    // נתוני דמו במידה וטרם הוגדרה כתובת GAS רשמית
    return [
      { eventId: 'rosh-hashana-2026', familyName: 'משפחת יוחאי', status: 'approved' },
      { eventId: 'rosh-hashana-2026', familyName: 'דניאל ומיכל', status: 'approved' },
      { eventId: 'succot-1-2026', familyName: 'משפחת אלמו מלקו', status: 'approved' }
    ];
  }

  try {
    const res = await fetch(`${CONFIG.GAS_SCRIPT_URL}?action=getRsvps`);
    return await res.json();
  } catch (e) {
    console.warn('לא ניתן לשלוף נתונים מ-GAS, מעבר לנתונים מקומיים', e);
    return [];
  }
}

// ==========================================
// 5. עיבוד נתונים (DATA PROCESSING)
// ==========================================
function processEventsData(hebcalData, gasRsvps) {
  if (!hebcalData || !hebcalData.items) return [];

  // סינון אירועים רלוונטיים (חגים ושבתות בלבד - ללא חול המועד)
  const relevantItems = hebcalData.items.filter(item => {
    return item.category === 'holiday' || item.category === 'candles';
  });

  // איגוד אירועים לפי מועד וחיבור להרשמות הקיימות
  return relevantItems.slice(0, 10).map(item => {
    const eventId = item.memo || item.title;
    const rsvps = gasRsvps.filter(r => r.eventId === eventId);
    
    return {
      id: eventId,
      title: item.hebrew || item.title,
      dateRangeStr: formatDateRange(item.date),
      candleLighting: item.candles || '18:15',
      havdalah: item.havdalah || '19:10',
      isCovered: rsvps.length > 0,
      rsvps: rsvps,
      rawItem: item
    };
  });
}

function formatDateRange(isoDateStr) {
  if (!isoDateStr) return '';
  const d = new Date(isoDateStr);
  const nextDay = new Date(d);
  nextDay.setDate(d.getDate() + 1);

  const formatDate = (dateObj) => {
    const day = String(dateObj.getDate()).padStart(2, '0');
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${dateObj.getFullYear()}`;
  };

  return `שישי - שבת: ${formatDate(d)} - ${formatDate(nextDay)}`;
}

// ==========================================
// 6. רנדור דינמי של DOM (DOM RENDERING)
// ==========================================
function renderCalendarCards() {
  const container = document.getElementById('cards-container');
  if (!container) return;

  if (AppState.events.length === 0) {
    container.innerHTML = `<p class="text-center text-xs text-neutral-500 py-4">טוען מועדים קרובים...</p>`;
    return;
  }

  container.innerHTML = AppState.events.map(event => {
    const coveredBadge = event.isCovered
      ? `<span class="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold">✓ מועד מכוסה - יש ליווי לטטיי ❤️</span>`
      : `<span class="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-xs font-bold">⚠️ דורש ליווי לטטיי!</span>`;

    const rsvpsList = event.rsvps.map(r => 
      `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-neutral-100 text-neutral-700 font-medium text-xs">
        <span class="w-2 h-2 rounded-full bg-emerald-500"></span> ${r.familyName}
      </span>`
    ).join('');

    return `
      <article class="bg-white rounded-3xl p-5 border ${event.isCovered ? 'border-[#f0e7d9]' : 'border-2 border-orange-200'} shadow-sm space-y-4">
        <div class="flex items-center justify-between">
          ${coveredBadge}
        </div>

        <div>
          <h3 class="text-xl font-bold text-neutral-900">${event.title}</h3>
          <p class="text-xs text-neutral-500 font-medium mt-0.5">${event.dateRangeStr}</p>
        </div>

        <div class="grid grid-cols-2 gap-2 bg-[#fdfaf5] border border-[#f5ebdc] rounded-2xl p-3 text-center">
          <div>
            <div class="text-[11px] text-neutral-500">הדלקת נרות</div>
            <div class="text-base font-bold text-orange-700">${event.candleLighting}</div>
          </div>
          <div>
            <div class="text-[11px] text-neutral-500">צאת המועד</div>
            <div class="text-base font-bold text-neutral-800">${event.havdalah}</div>
          </div>
        </div>

        ${event.rsvps.length > 0 ? `
          <div class="space-y-2">
            <div class="text-xs font-bold text-neutral-800">מי נמצא עם טטיי?</div>
            <div class="flex flex-wrap gap-2">${rsvpsList}</div>
          </div>
        ` : ''}

        <div class="bg-[#fcf8f2] rounded-2xl p-3 border border-[#f3e6d2] space-y-2.5">
          <input type="text" id="input-${event.id}" placeholder="שם המשפחה (לדוגמה: משפחת מלקו)" 
                 class="w-full bg-white border border-[#e2d5c2] rounded-xl px-3 py-2 text-xs text-neutral-800 focus:outline-none focus:ring-2 focus:ring-orange-500">
          <button onclick="handleRegister('${event.id}')" class="w-full bg-[#d97736] hover:bg-[#c2652b] text-white font-bold text-xs py-2.5 px-4 rounded-xl shadow-sm flex items-center justify-center gap-1.5 transition">
            <span class="material-symbols-outlined text-sm">favorite</span>
            <span>עדכנו שאנחנו עם טטיי</span>
          </button>
        </div>
      </article>
    `;
  }).join('');
}

function renderMyRSVPs() {
  const container = document.getElementById('my-rsvps-container');
  if (!container) return;

  const myRegistrations = AppState.events.filter(e => e.isCovered);

  if (myRegistrations.length === 0) {
    container.innerHTML = `<p class="text-xs text-neutral-500 text-center py-3">טרם נרשמתם למועדים הקרובים.</p>`;
    return;
  }

  container.innerHTML = myRegistrations.map(item => `
    <div class="bg-white rounded-3xl p-5 border border-[#f0e7d9] shadow-sm space-y-3">
      <div class="flex items-center justify-between">
        <span class="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold">✓ ליווי מאושר</span>
      </div>
      <div>
        <h3 class="text-lg font-bold text-neutral-900">${item.title}</h3>
        <p class="text-xs text-neutral-500 mt-0.5">${item.dateRangeStr}</p>
      </div>
      <div class="grid grid-cols-2 gap-2 pt-1">
        <button onclick="switchView('calendar')" class="bg-[#f4ece1] hover:bg-[#ebdccb] text-neutral-800 font-bold text-xs py-2.5 px-3 rounded-xl flex items-center justify-center gap-1 transition">
          <span class="material-symbols-outlined text-sm">edit</span>
          <span>עדכון</span>
        </button>
        <button onclick="handleCancelRSVP('${item.id}')" class="bg-red-50 hover:bg-red-100 text-red-700 font-bold text-xs py-2.5 px-3 rounded-xl border border-red-200 flex items-center justify-center gap-1 transition">
          <span class="material-symbols-outlined text-sm">cancel</span>
          <span>ביטול</span>
        </button>
      </div>
    </div>
  `).join('');
}

// ==========================================
// 7. טיפול באירועים והרשמה (ACTION HANDLERS)
// ==========================================
async function handleRegister(eventId) {
  const inputEl = document.getElementById(`input-${eventId}`);
  const familyName = inputEl ? inputEl.value.trim() : '';

  if (!familyName) {
    alert('אנא הזן את שם המשפחה לפני הרישום.');
    return;
  }

  const targetEvent = AppState.events.find(e => e.id === eventId);
  if (!targetEvent) return;

  // עדכון המצב המקומי
  targetEvent.isCovered = true;
  targetEvent.rsvps.push({ eventId, familyName, status: 'approved' });

  // עדכון מסך האישור
  setupConfirmationScreen(targetEvent, familyName);

  // רינדור מחדש ומעבר למסך אישור
  renderCalendarCards();
  renderMyRSVPs();
  switchView('confirmation');

  // שליחה ל-GAS ברקע
  sendRsvpToGas(eventId, familyName, 'register');
}

function setupConfirmationScreen(eventObj, familyName) {
  document.getElementById('conf-title').textContent = eventObj.title;
  document.getElementById('conf-date-range').textContent = eventObj.dateRangeStr;
  document.getElementById('conf-family-name').textContent = familyName;
  document.getElementById('conf-candle-lighting').textContent = eventObj.candleLighting;
  document.getElementById('conf-havdalah').textContent = eventObj.havdalah;

  // יצירת קישור מעוצב ל-WhatsApp
  const whatsappMsg = encodeURIComponent(`שמחים לעדכן ש${familyName} רשומים ללוות את טטיי ב${eventObj.title}! ❤️`);
  document.getElementById('conf-whatsapp-btn').href = `https://wa.me/?text=${whatsappMsg}`;
}

async function handleCancelRSVP(eventId) {
  if (!confirm('האם לבטל את הרישום ולפתוח את המועד למשפחה אחרת?')) return;

  const targetEvent = AppState.events.find(e => e.id === eventId);
  if (targetEvent) {
    targetEvent.isCovered = false;
    targetEvent.rsvps = [];
    renderCalendarCards();
    renderMyRSVPs();
    sendRsvpToGas(eventId, '', 'cancel');
  }
}

async function sendRsvpToGas(eventId, familyName, action) {
  if (!CONFIG.GAS_SCRIPT_URL || CONFIG.GAS_SCRIPT_URL.includes('YOUR_GAS')) return;

  try {
    await fetch(CONFIG.GAS_SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, eventId, familyName, timestamp: new Date().toISOString() })
    });
  } catch (err) {
    console.error('שגיאה בשליחת הרישום ל-GAS:', err);
  }
}
