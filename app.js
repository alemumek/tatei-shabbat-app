const GAS_URL = "https://script.google.com/macros/s/AKfycbyeLEhyGVsbe_1eMbFDAXDCV5x9OOPw9jvzspdSsPbqDzS3pn0ZIPp5qiSd7ZQ89vO6/exec";
let allRegistrations = [];
let currentTab = 'future';
let editingId = null;
let detectedEventInfo = { isHoliday: false, eventName: '' };

// 1. לוגיקת תיקוף תאריכים מול Hebcal
async function validateDateInput(dateStr) {
  const errorEl = document.getElementById('dateError');
  const submitBtn = document.getElementById('submitBtn');
  errorEl.style.display = 'none';
  submitBtn.disabled = false;

  if (!dateStr) return;

  const dateObj = new Date(dateStr);
  const dayOfWeek = dateObj.getDay(); // 5 = שישי, 6 = שבת

  try {
    // בדיקת חג מול Hebcal
    const hebcalUrl = `https://www.hebcal.com/hebcal?v=1&cfg=json&start=${dateStr}&end=${dateStr}&maj=on&min=on&mod=on&nx=on`;
    const res = await fetch(hebcalUrl);
    const data = await res.json();
    const holidayItem = data.items && data.items.find(item => item.category === 'holiday');

    if (holidayItem) {
      detectedEventInfo = { isHoliday: true, eventName: holidayItem.hebrew, dayOfWeek };
      return; // חג מאושר מידית
    }

    // בדיקת סוף שבוע (שישי/שבת)
    if (dayOfWeek === 5 || dayOfWeek === 6) {
      detectedEventInfo = { isHoliday: false, eventName: '', dayOfWeek };
      return; // סופ"ש מאושר
    }

    // חסימת ימי חול
    errorEl.innerText = "ניתן לבחור ימי שישי, שבת או ימי חג בלבד.";
    errorEl.style.display = 'block';
    submitBtn.disabled = true;

  } catch (e) {
    console.error("שגיאה בחיבור ל-Hebcal", e);
  }
}

// 2. שליחת הטופס (הוספה / עדכון)
async function handleFormSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('name').value;
  const date = document.getElementById('date').value;
  
  const action = editingId ? 'update' : 'add';
  const payload = {
    action: action,
    id: editingId,
    name: name,
    date: date,
    eventName: detectedEventInfo.eventName || ''
  };

  try {
    const res = await fetch(GAS_URL, { 
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload) 
    });

    const rawText = await res.text();
    let data;

    try {
      data = JSON.parse(rawText);
    } catch (parseError) {
      console.error("Server HTML Response:", rawText);
      alert("השרת החזיר תשובת HTML במקום JSON. ודא שהרשאות הפריסה ב-GAS מוגדרות ל-Anyone ושיצרת New Version.");
      return;
    }

    if (data.status === 'success') {
      showWhatsAppShare(name, date, detectedEventInfo);
      resetForm();
      loadRegistrations();
    } else {
      alert("שגיאה מהשרת: " + (data.message || "לא ניתן לשמור"));
    }
  } catch (err) {
    console.error("Network Error:", err);
    alert("שגיאה בתקשורת מול השרת: " + err.message);
  }
}

// 3. מחולל הודעות WhatsApp
function showWhatsAppShare(name, dateStr, eventInfo) {
  const [year, month, day] = dateStr.split('-');
  const formattedDate = `${day}/${month}/${year}`;
  let eventLine = '';

  if (eventInfo.isHoliday && (eventInfo.dayOfWeek === 5 || eventInfo.dayOfWeek === 6)) {
    eventLine = `🥂 שבת וחג: ${eventInfo.eventName} (${formattedDate})`;
  } else if (eventInfo.isHoliday) {
    const daysMap = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
    eventLine = `🥂 חג: ${eventInfo.eventName} (יום ${daysMap[eventInfo.dayOfWeek]}, ${formattedDate})`;
  } else {
    eventLine = `📅 סופ״ש: ${formattedDate}`;
  }

  const message = `מה נשמע שבט מלקו? ✨\nלידיעתכם 📌\nרשימת שבת/חג אצל טטיי התעדכנה 🌾\n👨‍👩‍👧‍👦 משפחה: ${name}\n${eventLine}\n🔗 לצפייה והרשמה: ${window.location.href}\nהמשך יום נפלא! 😃`;

  const shareBox = document.getElementById('shareBox');
  const waLink = document.getElementById('whatsappLink');
  waLink.href = `https://wa.me/?text=${encodeURIComponent(message)}`;
  shareBox.style.display = 'block';
}

// 4. חישוב תאריך תפוגה והתראות עבור אירוע מול Hebcal
async function calculateEventExpiration(dateStr) {
  const startDate = new Date(dateStr);
  let expDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 23, 59, 59);
  let alertNotice = "";
  let isHolidaySequence = false;
  let isAdjacentToShabbat = false;

  const endDateObj = new Date(startDate);
  endDateObj.setDate(endDateObj.getDate() + 4);
  const endDateStr = endDateObj.toISOString().split('T')[0];

  try {
    const res = await fetch(`https://www.hebcal.com/hebcal?v=1&cfg=json&start=${dateStr}&end=${endDateStr}&maj=on&min=on`);
    const data = await res.json();
    const items = data.items || [];

    let checkDate = new Date(startDate);

    for (let i = 0; i < 5; i++) {
      const curStr = checkDate.toISOString().split('T')[0];
      const dayOfWeek = checkDate.getDay(); // 5 = שישי, 6 = שבת

      const dayItems = items.filter(it => it.date.startsWith(curStr));
      const isYomTov = dayItems.some(it => it.category === 'holiday' && it.yomtov === true);
      const isWeekend = (dayOfWeek === 5 || dayOfWeek === 6);

      if (isYomTov || isWeekend) {
        expDate = new Date(checkDate.getFullYear(), checkDate.getMonth(), checkDate.getDate(), 23, 59, 59);

        if (isYomTov) isHolidaySequence = true;
        if (isYomTov && isWeekend) isAdjacentToShabbat = true;
      } else if (i > 0) {
        break;
      }
      checkDate.setDate(checkDate.getDate() + 1);
    }

    if (isAdjacentToShabbat || (isHolidaySequence && startDate.getDay() === 5)) {
      alertNotice = "⚡ רצף חג ושבת: ההרשמה פעילה עד מוצאי שבת";
    }
  } catch (e) {
    console.error("שגיאה בחישוב תפוגת אירוע מול Hebcal:", e);
  }

  return { expDate, alertNotice };
}

// 5. טעינת נתונים והצגה לפי טאבים
async function loadRegistrations() {
  try {
    const res = await fetch(GAS_URL);
    allRegistrations = await res.json();
    await renderCards();
  } catch (e) {
    console.error("שגיאה בטעינת נתונים", e);
  }
}

async function renderCards() {
  const container = document.getElementById('cardsContainer');
  container.innerHTML = '<p style="text-align:center; color: #666;">טוען נתונים...</p>';

  const now = new Date();
  const processedList = [];

  for (const item of allRegistrations) {
    const expInfo = await calculateEventExpiration(item.date);
    const isFuture = expInfo.expDate >= now;

    processedList.push({
      ...item,
      isFuture,
      alertNotice: expInfo.alertNotice
    });
  }

  const filtered = processedList.filter(item => currentTab === 'future' ? item.isFuture : !item.isFuture);

  filtered.sort((a, b) => {
    return currentTab === 'future' 
      ? new Date(a.date) - new Date(b.date) 
      : new Date(b.date) - new Date(a.date);
  });

  container.innerHTML = '';

  if (filtered.length === 0) {
    container.innerHTML = `<p style="text-align:center; color:#777;">אין הרשמות להצגה בלשונית זו.</p>`;
    return;
  }

  for (const item of filtered) {
    const card = document.createElement('div');
    card.className = `card ${currentTab === 'history' ? 'history' : ''}`;
    
    const tagsHtml = await getCardTagsHtml(item.date, item.eventName);

    card.innerHTML = `
      <div class="card-header">
        <span class="card-title">${item.name}</span>
        <div>${tagsHtml}</div>
      </div>
      <div style="margin-top: 8px; color: #555;">📅 תאריך: ${item.date}</div>
      ${item.alertNotice && currentTab === 'future' ? `
        <div style="margin-top: 8px; background-color: #FFF3CD; color: #856404; padding: 6px 10px; border-radius: 4px; font-size: 0.85rem; font-weight: bold;">
          ${item.alertNotice}
        </div>
      ` : ''}
      ${currentTab === 'future' ? `
        <div class="card-actions">
          <button class="btn-edit" onclick="startEdit('${item.id}', '${item.name}', '${item.date}')">עריכה</button>
        </div>
      ` : ''}
    `;
    container.appendChild(card);
  }
}

// 6. שליפת תגיות דינמית לפי תרחישים
async function getCardTagsHtml(dateStr, savedEventName) {
  const dateObj = new Date(dateStr);
  const dayOfWeek = dateObj.getDay();

  if (savedEventName) {
    if (dayOfWeek === 5 || dayOfWeek === 6) {
      return `<span class="tag">🕯️ שבת</span><span class="tag">🥂 ${savedEventName}</span>`;
    }
    return `<span class="tag">🥂 ${savedEventName}</span>`;
  }

  if (dayOfWeek === 5 || dayOfWeek === 6) {
    const saturdayDate = dayOfWeek === 5 ? new Date(dateObj.setDate(dateObj.getDate() + 1)) : dateObj;
    const satStr = saturdayDate.toISOString().split('T')[0];
    
    try {
      const res = await fetch(`https://www.hebcal.com/hebcal?v=1&cfg=json&start=${satStr}&end=${satStr}&s=on`);
      const data = await res.json();
      const parashaItem = data.items && data.items.find(i => i.category === 'parashat');
      const parashaName = parashaItem ? parashaItem.hebrew : 'שבת';
      return `<span class="tag">📖 ${parashaName}</span>`;
    } catch (e) {
      return `<span class="tag">🕯️ שבת</span>`;
    }
  }

  return `<span class="tag">📅 סופ״ש</span>`;
}

// 7. ניהול מצבי טופס
function startEdit(id, name, date) {
  editingId = id;
  document.getElementById('name').value = name;
  document.getElementById('date').value = date;
  
  document.getElementById('formCard').classList.add('edit-mode');
  document.getElementById('submitBtn').innerText = 'עדכן הרשמה';
  validateDateInput(date);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetForm() {
  editingId = null;
  document.getElementById('regForm').reset();
  document.getElementById('formCard').classList.remove('edit-mode');
  document.getElementById('submitBtn').innerText = 'אישור הרשמה';
  document.getElementById('submitBtn').disabled = false;
  document.getElementById('dateError').style.display = 'none';
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  event.target.classList.add('active');
  renderCards();
}

// אתחול טעינה
loadRegistrations();
