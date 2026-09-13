const GAS_URL = "https://script.google.com/macros/s/AKfycbyeLEhyGVsbe_1eMbFDAXDCV5x9OOPw9jvzspdSsPbqDzS3pn0ZIPp5qiSd7ZQ89vO6/exec";
let allRegistrations = [];
let currentTab = 'future';
let editingId = null;
let detectedEventInfo = { isHoliday: false, eventName: '' };

// חישוב טווח תאריכים וימים (אפשרות א')
function formatDateRange(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  const dateObj = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
  const dayOfWeek = dateObj.getDay();
  const daysNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

  if (dayOfWeek === 5) { // שישי
    const satObj = new Date(dateObj);
    satObj.setDate(satObj.getDate() + 1);
    const satD = String(satObj.getDate()).padStart(2, '0');
    const satM = String(satObj.getMonth() + 1).padStart(2, '0');
    const satY = satObj.getFullYear();
    return `שישי - שבת: ${d}/${m}/${y} - ${satD}/${satM}/${satY}`;
  } else if (dayOfWeek === 6) { // שבת
    const friObj = new Date(dateObj);
    friObj.setDate(friObj.getDate() - 1);
    const friD = String(friObj.getDate()).padStart(2, '0');
    const friM = String(friObj.getMonth() + 1).padStart(2, '0');
    const friY = friObj.getFullYear();
    return `שישי - שבת: ${friD}/${friM}/${friY} - ${d}/${m}/${y}`;
  } else {
    return `יום ${daysNames[dayOfWeek]}: ${d}/${m}/${y}`;
  }
}

// 1. לוגיקת תיקוף תאריכים מול Hebcal
async function validateDateInput(dateStr) {
  const errorEl = document.getElementById('dateError');
  const submitBtn = document.getElementById('submitBtn');
  errorEl.style.display = 'none';
  submitBtn.disabled = false;

  if (!dateStr) return;

  const [y, m, d] = dateStr.split('-');
  const dateObj = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
  const dayOfWeek = dateObj.getDay();

  try {
    const hebcalUrl = `https://www.hebcal.com/hebcal?v=1&cfg=json&start=${dateStr}&end=${dateStr}&maj=on&min=on&mod=on&nx=on`;
    const res = await fetch(hebcalUrl);
    const data = await res.json();
    const holidayItem = data.items && data.items.find(item => item.category === 'holiday');

    if (holidayItem) {
      detectedEventInfo = { isHoliday: true, eventName: holidayItem.hebrew, dayOfWeek };
      return;
    }

    if (dayOfWeek === 5 || dayOfWeek === 6) {
      detectedEventInfo = { isHoliday: false, eventName: '', dayOfWeek };
      return;
    }

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
      alert("השרת החזיר תשובת HTML במקום JSON. ודא שהרשאות הפריסה ב-GAS מוגדרות ל-Anyone.");
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
  const [y, m, d] = dateStr.split('-');
  const startDate = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
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
      const dayOfWeek = checkDate.getDay();

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
      <div class="card-main-info">
        <div class="card-title">${item.name}</div>
        <div class="card-date">${formatDateRange(item.date)}</div>
        <div class="card-tags">${tagsHtml}</div>
        ${item.alertNotice && currentTab === 'future' ? `
          <div class="card-alert">${item.alertNotice}</div>
        ` : ''}
      </div>
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
  const [y, m, d] = dateStr.split('-');
  const dateObj = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
  const dayOfWeek = dateObj.getDay();

  let tags = '';

  if (savedEventName) {
    tags += `<span class="tag tag-secondary">${savedEventName} 🍷</span>`;
  }

  if (dayOfWeek === 5 || dayOfWeek === 6) {
    const saturdayDate = dayOfWeek === 5 ? new Date(new Date(dateObj).setDate(dateObj.getDate() + 1)) : dateObj;
    const satStr = saturdayDate.toISOString().split('T')[0];
    
    try {
      const res = await fetch(`https://www.hebcal.com/hebcal?v=1&cfg=json&start=${satStr}&end=${satStr}&s=on`);
      const data = await res.json();
      const parashaItem = data.items && data.items.find(i => i.category === 'parashat');
      const parashaName = parashaItem ? parashaItem.hebrew : 'שבת';
      tags += `<span class="tag tag-primary">${parashaName} 🕯️</span>`;
    } catch (e) {
      tags += `<span class="tag tag-primary">שבת 🕯️</span>`;
    }
  } else if (!savedEventName) {
    tags += `<span class="tag tag-primary">סופ״ש 📅</span>`;
  }

  return tags;
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
