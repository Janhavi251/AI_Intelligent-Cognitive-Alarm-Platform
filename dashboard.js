// ── Read token from URL if coming from Google OAuth ──────────
const urlParams = new URLSearchParams(window.location.search);
const urlToken  = urlParams.get('token');
const urlName   = urlParams.get('name');
const urlRole   = urlParams.get('role');

if (urlToken) {
    localStorage.setItem('token', urlToken);
    localStorage.setItem('user', JSON.stringify({
        id:        parseInt(urlParams.get('id') || '0'),
        full_name: decodeURIComponent(urlName || ''),
        role:      urlRole || 'user'
    }));
    window.history.replaceState({}, document.title, 'dashboard.html');
}

// ── Step 1: Check login on every dashboard page load ─────────
let user = JSON.parse(localStorage.getItem('user'));
let token = localStorage.getItem('token');
if (!token || !user) {
    user = { id: 1, full_name: "Janhavi Rajput", email: "janhavi@example.com", role: "user" };
    token = "demo_token_123";
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('token', token);
}

// ── Step 3: Sign out function ─────────────────────────────────
function signOut() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = 'index.html';
}

function switchRole(roleTarget) {
  const panelMap = { 'user': 'user-panel', 'coach': 'coach-panel', 'admin': 'admin-panel' };
  const targetPanelId = panelMap[roleTarget] || roleTarget;
  const targetPanel = document.getElementById(targetPanelId);

  if (!targetPanel) return;

  document.querySelectorAll('.role-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel-section').forEach(p => p.classList.remove('active'));

  const activeTab = document.querySelector(`[data-target="${targetPanelId}"]`);
  if (activeTab) activeTab.classList.add('active');
  targetPanel.classList.add('active');

  const roleNameMap = { 'user-panel': 'user', 'coach-panel': 'coach', 'admin-panel': 'admin' };
  const role = roleNameMap[targetPanelId] || roleTarget;
  if (typeof initSidebar === 'function') initSidebar(role);
}

document.addEventListener('DOMContentLoaded', () => {
  const roleTabs = document.querySelectorAll('.role-tab');

  // ── Step 2: Show user name + auto-open correct panel by role ──
  if (user) {
    // Display the logged-in user's name in the header if element exists
    const userNameEl = document.getElementById('loggedInUser');
    if (userNameEl) userNameEl.textContent = user.full_name;

    // Update sidebar profile
    const sidebarName = document.getElementById('sidebar-username');
    const sidebarAvatar = document.getElementById('sidebar-avatar');
    if (sidebarName) sidebarName.textContent = user.full_name || 'User';
    if (sidebarAvatar) {
      const parts = (user.full_name || 'U').split(' ');
      sidebarAvatar.textContent = parts.map(p => p[0]).join('').substring(0, 2).toUpperCase();
    }

    // Auto-open the panel that matches the user's role
    let targetPanelId = 'user-panel'; // default
    if (user.role === 'admin')           targetPanelId = 'admin-panel';
    else if (user.role === 'wellness_coach') targetPanelId = 'coach-panel';

    // Deactivate all panels and tabs
    document.querySelectorAll('.panel-section').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.role-tab').forEach(t => t.classList.remove('active'));

    // Activate the correct panel and its matching tab
    const correctPanel = document.getElementById(targetPanelId);
    const correctTab   = document.querySelector(`[data-target="${targetPanelId}"]`);
    if (correctPanel) correctPanel.classList.add('active');
    if (correctTab)   correctTab.classList.add('active');

    // Init sidebar for this role
    const sidebarRole = user.role === 'wellness_coach' ? 'coach' : user.role === 'admin' ? 'admin' : 'user';
    initSidebar(sidebarRole);
  }

  // Load performance and behavioral analytics
  if (typeof loadCognitivePerformance === 'function') loadCognitivePerformance();
  if (typeof loadBehavioralAnalytics === 'function') loadBehavioralAnalytics();

  // ── Load alarms from database on page load ───────────────────
  if (user && user.id && user.id > 0) {
    fetch(`http://localhost:8000/alarms/${user.id}`)
      .then(res => res.json())
      .then(alarms => {
        const historyTable = document.querySelector('.data-table tbody');
        if (alarms && alarms.length) {
          myAlarmsList = alarms;
          if (typeof renderMyAlarms === 'function') renderMyAlarms();
        }
        if (!historyTable || !alarms.length) return;
        // Update alarm count badge
        const badge = document.getElementById('alarm-count-badge');
        if (badge) badge.textContent = alarms.length;
        historyTable.innerHTML = '';
        alarms.forEach(alarm => {
          const row = document.createElement('tr');
          row.setAttribute('data-alarm-id', alarm.id);

          const challengeLabels = { math: 'Math Problems', logic: 'Logic Puzzles', memory: 'Memory Challenges', word: 'Word Games' };
          const challengeDisplay = challengeLabels[alarm.challenge] || alarm.challenge;
          const [h, m] = alarm.alarm_time.split(':');
          const hr = parseInt(h);
          const ampm = hr >= 12 ? 'PM' : 'AM';
          const hr12 = hr % 12 || 12;
          const formattedTime = `${String(hr12).padStart(2,'0')}:${m} ${ampm}`;

          // Format date from created_at
          const d = new Date(alarm.created_at);
          const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

          row.innerHTML = `
            <td>${dateStr}</td>
            <td>${formattedTime}</td>
            <td>${alarm.title}</td>
            <td>${alarm.alarm_type}</td>
            <td>--</td>
            <td>--</td>
            <td>${challengeDisplay} · ${alarm.difficulty_level}</td>
            <td><span class="badge ${alarm.is_active ? 'badge-success' : 'badge-warning'}">
              ${alarm.is_active ? 'Active' : 'Disabled'}
            </span></td>
            <td class="kebab-cell">
              <button class="kebab-btn" onclick="toggleKebab(this)">
                <span></span><span></span><span></span>
              </button>
              <div class="kebab-menu">
                <button class="kebab-danger" onclick="deleteAlarm(${alarm.id},this);closeKebab()">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                  Remove
                </button>
              </div>
            </td>
          `;
          historyTable.appendChild(row);
        });
      })
      .catch(() => {});
  }
  roleTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetPanelId = tab.getAttribute('data-target');
      const targetPanel = document.getElementById(targetPanelId);

      if (!targetPanel) return;

      document.querySelectorAll('.role-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel-section').forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      targetPanel.classList.add('active');

      // Update sidebar for the switched role
      const roleMap = { 'user-panel': 'user', 'coach-panel': 'coach', 'admin-panel': 'admin' };
      const newRole = roleMap[targetPanelId];
      if (newRole) initSidebar(newRole);
    });
  });

  // 2. CHECK URL PARAMETER FOR ROLE INTERCONNECTION
  const urlParams = new URLSearchParams(window.location.search);
  const roleParam = urlParams.get('role');
  if (roleParam) {
    let targetTab = null;
    if (roleParam === 'user') targetTab = document.querySelector('[data-target="user-panel"]');
    if (roleParam === 'coach') targetTab = document.querySelector('[data-target="coach-panel"]');
    if (roleParam === 'admin') targetTab = document.querySelector('[data-target="admin-panel"]');
    
    if (targetTab) {
      targetTab.click();
    }
  }

  // 3. TABLE BUTTON CLICK INTERACTION (For mock interactive feedback)
  const actionButtons = document.querySelectorAll('.btn-action, .btn-download, .btn-table-edit');
  actionButtons.forEach(button => {
    button.addEventListener('click', (e) => {
      const originalText = button.textContent;
      if (button.classList.contains('btn-download')) {
        button.textContent = 'Downloading...';
        button.disabled = true;
        setTimeout(() => {
          button.textContent = 'Downloaded';
          button.style.backgroundColor = '#22c55e';
          button.style.color = '#ffffff';
        }, 1200);
      } else if (button.classList.contains('btn-action')) {
        button.textContent = 'Done!';
        button.style.borderColor = '#22c55e';
        button.style.color = '#22c55e';
        button.disabled = true;
      }
    });
  });

  // 4. ALARM SETTER FORM SUBMISSION — wired to backend + offline fallback
  const alarmForm = document.getElementById('alarm-setter-form');
  if (alarmForm) {
    alarmForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const timeVal = document.getElementById('alarm-time')?.value || '06:30';
      const labelVal = document.getElementById('alarm-label')?.value || 'My Alarm';
      const typeVal = document.getElementById('alarm-type')?.value || 'daily';
      const challengeVal = document.getElementById('alarm-challenge')?.value || 'math';
      const diffVal = document.getElementById('alarm-difficulty')?.value || 'medium';
      const soundVal = document.getElementById('alarm-sound')?.value || 'default';
      const snoozeVal = document.getElementById('alarm-snooze')?.checked ?? true;
      const snoozeMinVal = parseInt(document.getElementById('alarm-snooze-min')?.value || '5');
      const maxSnoozeVal = parseInt(document.getElementById('alarm-max-snooze')?.value || '3');
      const questionCountVal = parseInt(document.getElementById('alarm-question-count')?.value || '2');

      const challengeSelect = document.getElementById('alarm-challenge');
      const challengeText = (challengeSelect && challengeSelect.selectedIndex >= 0 && challengeSelect.options[challengeSelect.selectedIndex]) 
        ? challengeSelect.options[challengeSelect.selectedIndex].text 
        : 'Math Problems';

      const activeDays = [...document.querySelectorAll('.ac-day:not(.ac-never).active')].map(d => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getAttribute('data-day')]);
      const repeatDaysStr = activeDays.length > 0 ? activeDays.join(',') : 'Never';

      const saveBtn = alarmForm.querySelector('.btn-alarm-set');
      const btnText = saveBtn ? saveBtn.querySelector('.btn-text') : null;

      let savedAlarm = null;

      try {
        const userId = (user && user.id) ? parseInt(user.id) : 1;
        const res = await fetch('http://localhost:8000/alarms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id:          userId,
            title:            labelVal,
            alarm_time:       timeVal,
            alarm_type:       typeVal,
            repeat_days:      repeatDaysStr,
            challenge:        challengeVal,
            difficulty_level: diffVal,
            sound:            soundVal,
            vibration:        true,
            snooze_enabled:   snoozeVal,
            snooze_duration:  snoozeMinVal,
            max_snooze_count: maxSnoozeVal,
            question_count:   questionCountVal
          })
        });
        if (res.ok) {
          savedAlarm = await res.json();
        }
      } catch (err) {
        console.warn('Backend server unreachable, saving alarm locally:', err);
      }

      // Fallback if backend API is not running
      if (!savedAlarm) {
        savedAlarm = {
          id: Date.now(),
          user_id: (user && user.id) ? parseInt(user.id) : 1,
          title: labelVal,
          alarm_time: timeVal,
          alarm_type: typeVal,
          repeat_days: repeatDaysStr,
          challenge: challengeVal,
          difficulty_level: diffVal,
          sound: soundVal,
          is_active: true,
          snooze_duration: snoozeMinVal,
          max_snooze_count: maxSnoozeVal,
          question_count: questionCountVal,
          current_snooze_count: 0
        };
      }

      // Feedback on Save button
      if (btnText) btnText.textContent = 'SAVED!';
      if (saveBtn) saveBtn.style.background = 'linear-gradient(90deg, #22c55e, #15803d)';

      // Format time for UI
      const [nh, nm] = timeVal.split(':');
      const nhr = parseInt(nh) || 6;
      const nampm = nhr >= 12 ? 'PM' : 'AM';
      const nhr12 = nhr % 12 || 12;
      const displayTime = `${String(nhr12).padStart(2,'0')}:${nm || '00'} ${nampm}`;
      const todayStr = new Date().toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });

      // Add to alarm history table
      const historyTable = document.querySelector('.data-table tbody');
      if (historyTable) {
        const newRow = document.createElement('tr');
        newRow.setAttribute('data-alarm-id', savedAlarm.id);
        newRow.innerHTML = `
          <td>${todayStr}</td>
          <td>${displayTime}</td>
          <td>${labelVal}</td>
          <td>${typeVal}</td>
          <td>--</td>
          <td>--</td>
          <td>${challengeText} · ${diffVal}</td>
          <td><span class="badge badge-success">Active</span></td>
          <td class="kebab-cell">
            <button class="kebab-btn" onclick="toggleKebab(this)">
              <span></span><span></span><span></span>
            </button>
            <div class="kebab-menu">
              <button class="kebab-danger" onclick="deleteAlarm(${savedAlarm.id},this);closeKebab()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                Remove
              </button>
            </div>
          </td>
        `;
        historyTable.insertBefore(newRow, historyTable.firstChild);

        const badge = document.getElementById('alarm-count-badge');
        if (badge) {
          const currentCount = parseInt(badge.textContent || '0') + 1;
          badge.textContent = currentCount;
        }
      }

      // Add to My Alarms list view
      if (typeof myAlarmsList !== 'undefined') {
        myAlarmsList.unshift({
          id: savedAlarm.id,
          title: labelVal,
          alarm_time: timeVal,
          repeat_days: repeatDaysStr,
          challenge: challengeVal,
          sound: soundVal,
          is_active: true
        });
        if (typeof renderMyAlarms === 'function') renderMyAlarms();
      }

      // Close modal & reset form state
      setTimeout(() => {
        if (btnText) btnText.textContent = 'Save Alarm';
        if (saveBtn) saveBtn.style.background = '';
        acReset();
        const modalOverlay = document.getElementById('alarmModalOverlay');
        if (modalOverlay) modalOverlay.classList.remove('open');
      }, 800);
    });
  }

  // Helper to format HTML5 24h time value (e.g. 06:30 -> 06:30 AM)
  function formatTime(timeString) {
    if (!timeString) return '';
    const [hourStr, minStr] = timeString.split(':');
    let hour = parseInt(hourStr, 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12;
    hour = hour ? hour : 12; // the hour '0' should be '12'
    const formattedHour = hour < 10 ? '0' + hour : hour;
    return `${formattedHour}:${minStr} ${ampm}`;
  }
  // 5. HABIT SCORE INTERACTION
  const habitCheckboxes = document.querySelectorAll('.habit-checkbox');
  const progressPercentText = document.getElementById('habit-progress-percent');
  const progressPercentFill = document.getElementById('habit-progress-fill');

  if (habitCheckboxes.length > 0 && progressPercentText && progressPercentFill) {
    const updateHabitProgress = () => {
      const totalHabits = habitCheckboxes.length;
      const checkedHabits = document.querySelectorAll('.habit-checkbox:checked').length;
      const percentage = Math.round((checkedHabits / totalHabits) * 100);
      
      progressPercentText.textContent = `${percentage}%`;
      progressPercentFill.style.width = `${percentage}%`;
    };

    habitCheckboxes.forEach(checkbox => {
      checkbox.addEventListener('change', updateHabitProgress);
    });
  }
});

// ── Alarm CRUD functions ──────────────────────────────────────

async function editAlarm(alarmId, currentTime, currentLabel, currentRepeat) {
  const newTime  = prompt('New alarm time (HH:MM):', currentTime);
  if (!newTime) return;
  const newLabel = prompt('New label:', currentLabel);
  if (newLabel === null) return;

  try {
    const res = await fetch(`http://localhost:8000/alarms/${alarmId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title:            newLabel,
        alarm_time:       newTime + ':00',
        alarm_type:       'daily',
        repeat_days:      'Mon-Fri',
        difficulty_level: 'medium',
        sound:            'default',
        vibration:        true,
        snooze_enabled:   true
      })
    });
    if (res.ok) {
      // Update the row in the table
      const row = document.querySelector(`tr[data-alarm-id="${alarmId}"]`);
      if (row) {
        const cells = row.querySelectorAll('td');
        const [nh, nm] = newTime.split(':');
        const nhr = parseInt(nh);
        const nampm = nhr >= 12 ? 'PM' : 'AM';
        const nhr12 = nhr % 12 || 12;
        cells[1].textContent = `${String(nhr12).padStart(2,'0')}:${nm} ${nampm}`;
        cells[2].textContent = newLabel;
      }
    }
  } catch (err) {
    alert('Cannot connect to server.');
  }
}

async function toggleAlarm(alarmId, btn) {
  try {
    const res  = await fetch(`http://localhost:8000/alarms/${alarmId}/toggle`, { method: 'PATCH' });
    const data = await res.json();
    if (res.ok) {
      btn.textContent = data.is_active ? 'Disable' : 'Enable';
      btn.style.color = data.is_active ? '#EF4444' : '#22C55E';
    }
  } catch (err) {
    alert('Cannot connect to server.');
  }
}

async function deleteAlarm(alarmId, btn) {
  if (!confirm('Delete this alarm?')) return;
  try {
    const res = await fetch(`http://localhost:8000/alarms/${alarmId}`, { method: 'DELETE' });
    if (res.ok) {
      // Remove the row from the table
      btn.closest('tr').remove();
    }
  } catch (err) {
    alert('Cannot connect to server.');
  }
}

// ── Alarm Creator — time picker & day chips ───────────────────

let acNow = new Date();
let acHour = acNow.getHours() % 12 || 12;
let acMin  = acNow.getMinutes();
let acAMPM = acNow.getHours() >= 12 ? 'PM' : 'AM';

// Init drum display on page load
window.addEventListener('load', () => {
  acSyncDrum();
  // Update clock every minute to stay current
  setInterval(() => {
    const now = new Date();
    acHour = now.getHours() % 12 || 12;
    acMin  = now.getMinutes();
    acAMPM = now.getHours() >= 12 ? 'PM' : 'AM';
    acSyncDrum();
  }, 60000);
});

function acPad(n) { return String(n).padStart(2, '0'); }

function acSyncHidden() {
  let h24 = acHour % 12;
  if (acAMPM === 'PM') h24 += 12;
  document.getElementById('alarm-time').value = `${acPad(h24)}:${acPad(acMin)}`;
}

function acSyncDrum() {
  // Hour
  const hPrev = ((acHour - 2 + 12) % 12) + 1;
  const hNext = (acHour % 12) + 1;
  document.getElementById('ac-hour').textContent      = acPad(acHour);
  document.getElementById('ac-hour-prev').textContent = acPad(hPrev);
  document.getElementById('ac-hour-next').textContent = acPad(hNext);
  // Min
  const mPrev = (acMin - 1 + 60) % 60;
  const mNext = (acMin + 1) % 60;
  document.getElementById('ac-min').textContent      = acPad(acMin);
  document.getElementById('ac-min-prev').textContent = acPad(mPrev);
  document.getElementById('ac-min-next').textContent = acPad(mNext);
  // AM/PM
  document.getElementById('ac-ampm-cur').textContent   = acAMPM;
  document.getElementById('ac-ampm-other').textContent = acAMPM === 'AM' ? 'PM' : 'AM';
  acSyncHidden();
}

function acAdjust(part, delta) {
  if (part === 'hour') {
    acHour = ((acHour - 1 + delta + 12) % 12) + 1;
  } else {
    acMin = (acMin + delta + 60) % 60;
  }
  acSyncDrum();
}

function acSetAMPM(val) {
  acAMPM = val;
  acSyncDrum();
}

function acToggleAMPM() {
  acSetAMPM(acAMPM === 'AM' ? 'PM' : 'AM');
}

function acToggleNever() {
  const neverBtn = document.getElementById('ac-never');
  const isNever  = neverBtn.classList.toggle('active');
  // When Never is active, deactivate all day chips
  document.querySelectorAll('.ac-day:not(.ac-never)').forEach(d => {
    d.classList.toggle('active', !isNever);
  });
}

// Day chip toggle
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.ac-day:not(.ac-never)').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('active');
      // If any day is selected, Never should be inactive
      const anyActive = [...document.querySelectorAll('.ac-day:not(.ac-never)')].some(d => d.classList.contains('active'));
      document.getElementById('ac-never').classList.toggle('active', !anyActive);
    });
  });
});

function acReset() {
  const now = new Date();
  acHour = now.getHours() % 12 || 12;
  acMin  = now.getMinutes();
  acAMPM = now.getHours() >= 12 ? 'PM' : 'AM';
  acSyncDrum();
  // Clear label
  const label = document.getElementById('alarm-label');
  if (label) label.value = '';
  // Reset dropdowns to sensible defaults
  const challenge = document.getElementById('alarm-challenge');
  if (challenge) challenge.value = 'math';
  const difficulty = document.getElementById('alarm-difficulty');
  if (difficulty) difficulty.value = 'medium';
  const alarmType = document.getElementById('alarm-type');
  if (alarmType) alarmType.value = 'daily';
  // Reset snooze
  const snooze = document.getElementById('alarm-snooze');
  if (snooze) snooze.checked = true;
  // Deselect all day chips
  document.querySelectorAll('.ac-day:not(.ac-never)').forEach(d => d.classList.remove('active'));
  document.getElementById('ac-never').classList.remove('active');
}

// ── Kebab menu ────────────────────────────────────────────────
function toggleKebab(btn) {
  const menu = btn.nextElementSibling;
  const isOpen = menu.classList.contains('open');
  closeKebab(); // close any other open menus
  if (!isOpen) menu.classList.add('open');
}

function closeKebab() {
  document.querySelectorAll('.kebab-menu.open').forEach(m => m.classList.remove('open'));
}

// Close kebab when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.kebab-cell')) closeKebab();
});

// ── Alarm Calendar ────────────────────────────────────────────
const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun',
                      'Jul','Aug','Sep','Oct','Nov','Dec'];

let acCalDate    = new Date();   // currently viewed month
let acSelectedDate = new Date(); // selected date (default today)

// Init date label on load
(function() {
  const d = new Date();
  const label = d.getDate() + ' ' + SHORT_MONTHS[d.getMonth()];
  const el = document.getElementById('ac-date-label');
  if (el) el.textContent = label;
  const hidden = document.getElementById('alarm-date');
  if (hidden) hidden.value = d.toISOString().split('T')[0];
})();

function acToggleCalendar() {
  const cal = document.getElementById('ac-calendar');
  if (!cal) return;
  const isOpen = cal.style.display !== 'none';
  cal.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) acRenderCalendar();
}

function acCalNav(delta) {
  acCalDate.setMonth(acCalDate.getMonth() + delta);
  acRenderCalendar();
}

function acCalSetMonth() {
  const mo = parseInt(document.getElementById('ac-cal-month').value);
  acCalDate.setMonth(mo);
  acRenderCalendar();
}

function acCalSetYear() {
  const yr = parseInt(document.getElementById('ac-cal-year').value);
  acCalDate.setFullYear(yr);
  acRenderCalendar();
}

function acRenderCalendar() {
  const grid      = document.getElementById('ac-cal-grid');
  const moSelect  = document.getElementById('ac-cal-month');
  const yrSelect  = document.getElementById('ac-cal-year');
  if (!grid) return;

  const yr = acCalDate.getFullYear();
  const mo = acCalDate.getMonth();

  // Populate month dropdown
  moSelect.innerHTML = MONTHS.map((m, i) =>
    `<option value="${i}" ${i === mo ? 'selected' : ''}>${m}</option>`
  ).join('');

  // Populate year dropdown — 5 years back to 5 years forward
  const currentYr = new Date().getFullYear();
  yrSelect.innerHTML = '';
  for (let y = currentYr - 5; y <= currentYr + 5; y++) {
    yrSelect.innerHTML += `<option value="${y}" ${y === yr ? 'selected' : ''}>${y}</option>`;
  }

  const today    = new Date();
  const firstDay = new Date(yr, mo, 1).getDay();
  const daysInMo = new Date(yr, mo + 1, 0).getDate();

  let html = '';
  ['S','M','T','W','T','F','S'].forEach(d => {
    html += `<span class="ac-cal-day-name">${d}</span>`;
  });
  for (let i = 0; i < firstDay; i++) {
    html += `<button class="ac-cal-day empty" disabled></button>`;
  }
  for (let d = 1; d <= daysInMo; d++) {
    const isToday    = d === today.getDate() && mo === today.getMonth() && yr === today.getFullYear();
    const isSelected = d === acSelectedDate.getDate() && mo === acSelectedDate.getMonth() && yr === acSelectedDate.getFullYear();
    const cls = `ac-cal-day${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}`;
    html += `<button type="button" class="${cls}" onclick="acSelectDate(${yr},${mo},${d})">${d}</button>`;
  }
  grid.innerHTML = html;
}

function acSelectDate(yr, mo, d) {
  acSelectedDate = new Date(yr, mo, d);
  // Update label
  const label = d + ' ' + SHORT_MONTHS[mo];
  document.getElementById('ac-date-label').textContent = label;
  // Update hidden input
  const pad = n => String(n).padStart(2,'0');
  document.getElementById('alarm-date').value = `${yr}-${pad(mo+1)}-${pad(d)}`;
  // Close calendar
  document.getElementById('ac-calendar').style.display = 'none';
  // Re-render to show selected state
  acCalDate = new Date(yr, mo, 1);
}

// ── Alarm Modal ───────────────────────────────────────────────
function openAlarmModal() {
  // Show selected time from card clock in modal header
  const timeEl = document.getElementById('modal-time-display');
  const dateEl = document.getElementById('modal-date-display');
  if (timeEl) timeEl.textContent = `${acPad(acHour)}:${acPad(acMin)} ${acAMPM}`;
  if (dateEl) dateEl.textContent = document.getElementById('ac-date-label')?.textContent || 'Today';
  // Reset form fields with defaults
  const challenge = document.getElementById('alarm-challenge');
  if (challenge) challenge.value = 'math';
  const difficulty = document.getElementById('alarm-difficulty');
  if (difficulty) difficulty.value = 'medium';
  const alarmType = document.getElementById('alarm-type');
  if (alarmType) alarmType.value = 'daily';
  const label = document.getElementById('alarm-label');
  if (label) label.value = '';
  document.querySelectorAll('.ac-day:not(.ac-never)').forEach(d => d.classList.remove('active'));
  document.getElementById('ac-never')?.classList.remove('active');
  document.getElementById('alarmModalOverlay').classList.add('open');
}

function closeAlarmModal(e) {
  // Close only if clicking the overlay background, not the modal itself
  if (e && e.target !== document.getElementById('alarmModalOverlay')) return;
  document.getElementById('alarmModalOverlay').classList.remove('open');
}

// ── Sidebar ───────────────────────────────────────────────────

// ── Sidebar navigation ────────────────────────────────────────

function initSidebar(role) {
  // Hide all sidebars, show the one for this role
  ['user','coach','admin'].forEach(r => {
    const nav = document.getElementById(`sidebar-${r}`);
    if (nav) nav.style.display = r === role ? 'flex' : 'none';
  });
  // Default to overview (Dashboard) on role switch
  const activeNav = document.getElementById(`sidebar-${role}`);
  if (activeNav) {
    const firstItem = activeNav.querySelector('.sidebar-item');
    if (firstItem) showSubSection(role, 'overview', firstItem);
  }
}

function showSubSection(role, sub, btn) {
  const nav = document.getElementById(`sidebar-${role}`);
  if (nav) {
    nav.querySelectorAll('.sidebar-item').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
  }

  const panelMap = { user: 'user-panel', coach: 'coach-panel', admin: 'admin-panel' };
  const panel = document.getElementById(panelMap[role]);
  if (!panel) return;

  const grid = panel.querySelector('.dashboard-grid');
  const allSubCards = panel.querySelectorAll('.sub-card');

  if (sub === 'overview') {
    if (grid) {
      grid.querySelectorAll('.dashboard-card:not(.sub-card)').forEach(c => c.style.display = '');
    }
    allSubCards.forEach(c => {
      c.classList.remove('sub-visible');
      c.style.display = 'none';
    });
  } else {
    if (grid) {
      grid.querySelectorAll('.dashboard-card:not(.sub-card)').forEach(c => c.style.display = 'none');
    }
    allSubCards.forEach(c => {
      c.classList.remove('sub-visible');
      c.style.display = 'none';
    });
    const target = panel.querySelector(`.sub-card[data-sub="${sub}"]`);
    if (target) {
      target.style.display = 'flex';
      target.classList.add('sub-visible');
      target.style.gridColumn = '1 / -1';
    }
  }
}

// ════════════════════════════════════════════════════════════
//  MY ALARMS LOGIC & RENDERING
// ════════════════════════════════════════════════════════════

let initialSampleAlarms = [
  {
    id: 1,
    title: "Morning Wake-up",
    alarm_time: "06:30",
    repeat_days: "Mon,Tue,Wed,Thu,Fri",
    challenge: "math",
    sound: "chime",
    is_active: true
  },
  {
    id: 2,
    title: "Workout Reminder",
    alarm_time: "07:15",
    repeat_days: "Tue,Thu,Sat",
    challenge: "shake",
    sound: "energetic",
    is_active: true
  },
  {
    id: 3,
    title: "Wind-down Reminder",
    alarm_time: "21:00",
    repeat_days: "",
    challenge: "none",
    sound: "bell",
    is_active: false
  },
  {
    id: 4,
    title: "Weekend Light Wake",
    alarm_time: "06:00",
    repeat_days: "Sat,Sun",
    challenge: "qr",
    sound: "nature",
    is_active: true
  }
];

let myAlarmsList = [...initialSampleAlarms];
let currentAlarmFilter = 'all';

function formatAlarmTime(timeStr) {
  if (!timeStr) return { num: '00:00', period: 'AM' };
  const [h, m] = timeStr.split(':');
  let hour = parseInt(h, 10);
  const period = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12;
  hour = hour ? hour : 12;
  const num = `${String(hour).padStart(2, '0')}:${m || '00'}`;
  return { num, period };
}

function getChallengeBadge(challenge) {
  const map = {
    math: { icon: '', label: 'Math Problems', class: 'badge-challenge' },
    logic: { icon: '', label: 'Logic Puzzles', class: 'badge-challenge' },
    memory: { icon: '', label: 'Memory Challenges', class: 'badge-challenge' },
    word: { icon: '', label: 'Word Games', class: 'badge-challenge' },
    pattern: { icon: '', label: 'Pattern Recognition', class: 'badge-challenge' },
    riddle: { icon: '', label: 'Riddles', class: 'badge-challenge' },
    quiz: { icon: '', label: 'Quick Quizzes', class: 'badge-challenge' },
    shake: { icon: '', label: 'Shake to Dismiss', class: 'badge-challenge' },
    none: { icon: '', label: 'No Challenge', class: 'badge-challenge-none' },
    qr: { icon: '', label: 'QR Scan', class: 'badge-challenge' }
  };
  return map[challenge] || { icon: '', label: challenge || 'Challenge', class: 'badge-challenge' };
}

function getSoundBadge(sound) {
  const map = {
    chime: { icon: '', label: 'Chime' },
    energetic: { icon: '', label: 'Energetic' },
    bell: { icon: '', label: 'Soft Bell' },
    nature: { icon: '', label: 'Nature Sounds' },
    default: { icon: '', label: 'Default Sound' },
    beep: { icon: '', label: 'Beep' },
    digital: { icon: '', label: 'Digital Sound' }
  };
  return map[sound] || { icon: '', label: sound || 'Default' };
}

async function renderAlarmHistoryTable() {
  const historyTbody = document.getElementById('alarm-history-tbody') || document.querySelector('.data-table tbody');
  if (!historyTbody) return;

  try {
    const userId = (user && user.id) ? user.id : 1;
    const res = await fetch(`http://localhost:8000/challenges/history?user_id=${userId}`);
    if (!res.ok) throw new Error('Failed to fetch history');
    const logs = await res.json();

    if (!logs || logs.length === 0) {
      historyTbody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align:center;padding:24px;color:#64748b;font-weight:500;">
            No alarm dismissal logs recorded yet. Dismiss an active alarm challenge to populate history.
          </td>
        </tr>
      `;
      return;
    }

    historyTbody.innerHTML = logs.map(log => `
      <tr>
        <td>${log.date}</td>
        <td>${log.set_time}</td>
        <td>${log.label}</td>
        <td style="text-transform:capitalize;">${log.alarm_type}</td>
        <td style="font-weight:600;color:#0f172a;">${log.dismiss_time}</td>
        <td style="font-weight:600;color:#2563eb;">${log.delay}</td>
        <td>${log.puzzle_solved}</td>
        <td><span class="badge-pill" style="background:#f1f5f9;color:#334155;font-weight:600;font-size:0.75rem;">${log.wakefulness_label || 'N/A'}</span></td>
        <td>
          <span class="badge ${log.success ? 'badge-success' : 'badge-danger'}">
            ${log.status}
          </span>
        </td>
        <td class="kebab-cell">
          <button type="button" class="kebab-btn" onclick="toggleKebab(this)">
            <span></span><span></span><span></span>
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.warn('Error fetching alarm history logs:', err);
  }
}

function renderMyAlarms(filter = currentAlarmFilter) {
  currentAlarmFilter = filter;
  const container = document.getElementById('my-alarms-list');
  const countBadge = document.getElementById('filter-count-all');
  const navBadge = document.getElementById('alarm-count-badge');

  if (countBadge) countBadge.textContent = myAlarmsList.length;
  if (navBadge) navBadge.textContent = myAlarmsList.length;

  renderAlarmHistoryTable();

  if (!container) return;

  // Filter alarms
  let filtered = myAlarmsList;
  if (filter === 'active') {
    filtered = myAlarmsList.filter(a => a.is_active);
  } else if (filter === 'weekdays') {
    filtered = myAlarmsList.filter(a => {
      const days = a.repeat_days || '';
      return days.includes('Mon') || days.includes('Tue') || days.includes('Wed') || days.includes('Thu') || days.includes('Fri');
    });
  } else if (filter === 'weekends') {
    filtered = myAlarmsList.filter(a => {
      const days = a.repeat_days || '';
      return days.includes('Sat') || days.includes('Sun');
    });
  }

  if (filtered.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);">No alarms found in this category.</div>`;
    return;
  }

  const daysMap = [
    { short: 'M', key: 'Mon' },
    { short: 'T', key: 'Tue' },
    { short: 'W', key: 'Wed' },
    { short: 'T', key: 'Thu' },
    { short: 'F', key: 'Fri' },
    { short: 'S', key: 'Sat' },
    { short: 'S', key: 'Sun' }
  ];

  container.innerHTML = filtered.map(alarm => {
    const timeObj = formatAlarmTime(alarm.alarm_time);
    const chal = getChallengeBadge(alarm.challenge);
    const snd = getSoundBadge(alarm.sound);
    const repDays = alarm.repeat_days || '';

    const daysHtml = daysMap.map(d => {
      const active = repDays.includes(d.key);
      return `<span class="day-circle ${active ? 'active' : ''}">${d.short}</span>`;
    }).join('');

    return `
      <div class="alarm-card-item ${alarm.is_active ? 'is-active' : ''}" data-alarm-id="${alarm.id}">
        <div class="alarm-card-left">
          <div class="alarm-time-display">
            <span class="alarm-time-num">${timeObj.num}</span>
            <span class="alarm-time-period">${timeObj.period}</span>
          </div>

          <div class="alarm-details-block">
            <div class="alarm-item-title">${alarm.title || 'Alarm'}</div>
            
            <div class="alarm-days-row">
              ${daysHtml}
            </div>

            <div class="alarm-badges-row">
              <span class="badge-pill ${chal.class}">
                ${chal.label}
              </span>
              <span class="badge-pill badge-sound">
                ${snd.label}
              </span>
            </div>
          </div>
        </div>

        <div class="alarm-card-controls">
          <button type="button" class="btn-test-challenge" onclick="testMyAlarmCard(${alarm.id})" title="Test Cognitive Challenge">
            🧠 Test Challenge
          </button>

          <button type="button" class="btn-icon-box" onclick="editMyAlarmCard(${alarm.id})" title="Edit Alarm">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>

          <button type="button" class="btn-icon-box btn-delete" onclick="deleteMyAlarmCard(${alarm.id})" title="Delete Alarm">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
              <path d="M10 11v6"></path>
              <path d="M14 11v6"></path>
              <path d="M9 6V4h6v2"></path>
            </svg>
          </button>

          <label class="alarm-switch">
            <input type="checkbox" ${alarm.is_active ? 'checked' : ''} onchange="toggleMyAlarmCard(${alarm.id}, this)">
            <span class="alarm-switch-slider"></span>
          </label>
        </div>
      </div>
    `;
  }).join('');
}

function filterAlarms(filter, pillBtn) {
  document.querySelectorAll('.alarm-filter-pill').forEach(b => b.classList.remove('active'));
  if (pillBtn) pillBtn.classList.add('active');
  renderMyAlarms(filter);
}

function toggleMyAlarmCard(id, checkbox) {
  const item = myAlarmsList.find(a => a.id === id);
  if (item) {
    item.is_active = checkbox.checked;
    fetch(`http://localhost:8000/alarms/${id}/toggle`, { method: 'PATCH' }).catch(() => {});
    renderMyAlarms();
  }
}

function testMyAlarmCard(id) {
  const alarm = myAlarmsList.find(a => a.id === id);
  if (alarm) {
    triggerActiveAlarm(alarm);
  } else {
    openChallengeModal('math', 'medium', 'Practice Challenge');
  }
}

// ── COGNITIVE CHALLENGE MODAL CONTROLLER ─────────────────────
let cmCurrentChallenge = null;
let cmStartTime = 0;
let cmTimerInterval = null;
let cmTimeLeft = 45;
let cmCurrentCorrect = 0;
let cmRequiredQuestions = 2;
let cmCurrentType = 'math';
let cmCurrentDiff = 'medium';
let cmCurrentTitle = 'Cognitive Challenge';

async function openChallengeModal(type = 'math', diff = 'medium', title = 'Cognitive Challenge', qCount = null, isNextQuestion = false) {
  const overlay = document.getElementById('challengeModalOverlay');
  if (!overlay) return;

  cmCurrentType = type;
  cmCurrentDiff = diff;
  cmCurrentTitle = title;

  if (!isNextQuestion) {
    cmCurrentCorrect = 0;
    const selectEl = document.getElementById('cm-qcount-select');
    if (qCount !== null && selectEl) {
      selectEl.value = String(qCount);
    }
    cmRequiredQuestions = parseInt(selectEl ? selectEl.value : (qCount || 2));
  }

  document.getElementById('cm-title').textContent = title;
  document.getElementById('cm-badge-type').textContent = getChallengeBadge(type).label;
  document.getElementById('cm-badge-diff').textContent = diff.charAt(0).toUpperCase() + diff.slice(1);
  
  const progText = document.getElementById('cm-progress-text');
  const progPct = document.getElementById('cm-progress-pct');
  const submitBtn = document.getElementById('cm-submit-btn');

  if (progText) progText.textContent = `QUESTION ${cmCurrentCorrect + 1} OF ${cmRequiredQuestions}`;
  if (progPct) progPct.textContent = `${Math.round((cmCurrentCorrect / cmRequiredQuestions) * 100)}% SOLVED`;
  if (submitBtn) submitBtn.textContent = `🔓 SOLVE QUESTION ${cmCurrentCorrect + 1} OF ${cmRequiredQuestions}`;

  document.getElementById('cm-challenge-body').style.display = 'block';
  document.getElementById('cm-success-body').style.display = 'none';
  document.getElementById('cm-feedback').style.display = 'none';
  document.getElementById('cm-question-text').textContent = 'Loading dynamic AI challenge...';
  document.getElementById('cm-options-container').innerHTML = '';
  document.getElementById('cm-input-container').style.display = 'none';
  document.getElementById('cm-hint-box').style.display = 'none';
  
  overlay.classList.add('open');

  const userId = (user && user.id) ? parseInt(user.id) : 1;
  
  try {
    const res = await fetch(`http://localhost:8000/challenges/personalized/${userId}?type=${type}`);
    if (!res.ok) throw new Error('API Error');
    cmCurrentChallenge = await res.json();
  } catch (e) {
    try {
      const res = await fetch(`http://localhost:8000/challenges/generate?type=${type}&difficulty=${diff}`);
      cmCurrentChallenge = await res.json();
    } catch (err) {
      cmCurrentChallenge = {
        challenge_id: 'math_fallback',
        type: 'math',
        difficulty: diff,
        title: 'Math Puzzle',
        question: 'Solve: 12 + 15 = ?',
        input_type: 'choice',
        options: ['25', '27', '29', '30'],
        answer_key: '27',
        hint: '12 plus 15',
        time_limit_seconds: 45
      };
    }
  }

  renderCMChallenge();
}

function changeCMPracticeQuestions(val) {
  cmRequiredQuestions = parseInt(val || 2);
  cmCurrentCorrect = 0;
  openChallengeModal(cmCurrentType, cmCurrentDiff, cmCurrentTitle, cmRequiredQuestions, false);
}

function renderCMChallenge() {
  if (!cmCurrentChallenge) return;
  
  document.getElementById('cm-question-text').textContent = cmCurrentChallenge.question;
  
  const optionsDiv = document.getElementById('cm-options-container');
  const inputDiv = document.getElementById('cm-input-container');
  const hintDiv = document.getElementById('cm-hint-box');
  
  optionsDiv.innerHTML = '';
  
  if (cmCurrentChallenge.input_type === 'choice' && cmCurrentChallenge.options?.length) {
    optionsDiv.style.display = 'flex';
    inputDiv.style.display = 'none';
    cmCurrentChallenge.options.forEach(opt => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'opt-btn-modal';
      btn.style.cssText = 'padding:12px 16px;border-radius:10px;border:1.5px solid #cbd5e1;background:#fff;font-weight:600;color:#1e293b;cursor:pointer;text-align:left;transition:all 0.2s;';
      btn.textContent = opt;
      btn.onclick = () => {
        document.querySelectorAll('.opt-btn-modal').forEach(b => {
          b.style.borderColor = '#cbd5e1';
          b.style.background = '#fff';
          delete b.dataset.selected;
        });
        btn.style.borderColor = '#2563eb';
        btn.style.background = '#eff6ff';
        btn.dataset.selected = 'true';
      };
      optionsDiv.appendChild(btn);
    });
  } else {
    optionsDiv.style.display = 'none';
    inputDiv.style.display = 'block';
    const inp = document.getElementById('cm-user-input');
    inp.value = '';
    inp.focus();
  }

  if (cmCurrentChallenge.hint) {
    hintDiv.textContent = `💡 Hint: ${cmCurrentChallenge.hint}`;
    hintDiv.style.display = 'block';
  } else {
    hintDiv.style.display = 'none';
  }

  cmStartTime = Date.now();
  startCMTimer(cmCurrentChallenge.time_limit_seconds || 45);
}

function startCMTimer(seconds) {
  if (cmTimerInterval) clearInterval(cmTimerInterval);
  cmTimeLeft = seconds;
  const display = document.getElementById('cm-timer-display');
  display.textContent = `⏳ ${cmTimeLeft}s remaining`;
  
  cmTimerInterval = setInterval(() => {
    cmTimeLeft--;
    display.textContent = `⏳ ${cmTimeLeft}s remaining`;
    if (cmTimeLeft <= 0) {
      clearInterval(cmTimerInterval);
      display.textContent = `⏰ Time's up!`;
      const fb = document.getElementById('cm-feedback');
      fb.style.display = 'block';
      fb.style.background = '#fef2f2';
      fb.style.color = '#dc2626';
      fb.textContent = `⏰ Time expired! Answer was: ${cmCurrentChallenge?.answer_key || ''}. Loading next question...`;
      setTimeout(() => {
        openChallengeModal(cmCurrentType, cmCurrentDiff, cmCurrentTitle, cmRequiredQuestions, true);
      }, 1600);
    }
  }, 1000);
}

async function submitChallengeModalAnswer() {
  if (!cmCurrentChallenge) return;

  let userAnswer = '';
  if (cmCurrentChallenge.input_type === 'choice') {
    const selected = document.querySelector('.opt-btn-modal[data-selected="true"]');
    if (!selected) {
      alert('Please select an option first!');
      return;
    }
    userAnswer = selected.textContent.trim();
  } else {
    userAnswer = document.getElementById('cm-user-input')?.value.trim() || '';
    if (!userAnswer) {
      alert('Please enter your answer!');
      return;
    }
  }

  if (cmTimerInterval) clearInterval(cmTimerInterval);
  const timeTaken = (Date.now() - cmStartTime) / 1000;
  const userId = (user && user.id) ? parseInt(user.id) : 1;

  try {
    const res = await fetch(`http://localhost:8000/challenges/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        challenge_id: cmCurrentChallenge.challenge_id,
        challenge_type: cmCurrentChallenge.type || 'math',
        difficulty: cmCurrentChallenge.difficulty || 'medium',
        answer_key: cmCurrentChallenge.answer_key,
        user_answer: userAnswer,
        time_taken_seconds: timeTaken
      })
    });
    
    const data = await res.json();
    if (data.log_id) modalLastLogId = data.log_id;

    const fb = document.getElementById('cm-feedback');
    fb.style.display = 'block';

    if (data.success) {
      cmCurrentCorrect++;
      fb.style.background = '#f0fdf4';
      fb.style.color = '#16a34a';

      if (cmCurrentCorrect < cmRequiredQuestions) {
        fb.textContent = `✅ Correct! Question ${cmCurrentCorrect} of ${cmRequiredQuestions} solved. Loading next question...`;
        
        const progText = document.getElementById('cm-progress-text');
        const progPct = document.getElementById('cm-progress-pct');
        const submitBtn = document.getElementById('cm-submit-btn');

        if (progText) progText.textContent = `QUESTION ${cmCurrentCorrect + 1} OF ${cmRequiredQuestions}`;
        if (progPct) progPct.textContent = `${Math.round((cmCurrentCorrect / cmRequiredQuestions) * 100)}% SOLVED`;
        if (submitBtn) submitBtn.textContent = `🔓 SOLVE QUESTION ${cmCurrentCorrect + 1} OF ${cmRequiredQuestions}`;

        setTimeout(() => {
          openChallengeModal(cmCurrentType, cmCurrentDiff, cmCurrentTitle, cmRequiredQuestions, true);
        }, 1200);

      } else {
        fb.textContent = `🎉 All ${cmRequiredQuestions} questions answered correctly! Challenge Completed.`;
        setTimeout(() => {
          document.getElementById('cm-challenge-body').style.display = 'none';
          document.getElementById('cm-success-body').style.display = 'flex';
          const statusEl = document.getElementById('cm-wake-status');
          if (statusEl) {
            statusEl.style.color = '#64748b';
            statusEl.textContent = 'Select rating to record morning wakefulness';
          }
          loadCognitivePerformance();
        }, 800);
      }

    } else {
      fb.style.background = '#fef2f2';
      fb.style.color = '#dc2626';
      fb.textContent = `❌ ${data.message}. Loading next question...`;
      
      // Load next question on wrong answer
      setTimeout(() => {
        openChallengeModal(cmCurrentType, cmCurrentDiff, cmCurrentTitle, cmRequiredQuestions, true);
      }, 1600);
    }
  } catch (e) {
    console.error('Challenge verify error:', e);
    closeChallengeModal();
  }
}

function closeChallengeModal() {
  if (cmTimerInterval) clearInterval(cmTimerInterval);
  const overlay = document.getElementById('challengeModalOverlay');
  if (overlay) overlay.classList.remove('open');
}

function deleteMyAlarmCard(id) {
  if (!confirm('Are you sure you want to delete this alarm?')) return;
  myAlarmsList = myAlarmsList.filter(a => a.id !== id);
  fetch(`http://localhost:8000/alarms/${id}`, { method: 'DELETE' }).catch(() => {});
  renderMyAlarms();
}

function editMyAlarmCard(id) {
  const item = myAlarmsList.find(a => a.id === id);
  if (!item) return;
  const newTitle = prompt('Update Alarm Title:', item.title);
  if (newTitle === null) return;
  const newTime = prompt('Update Alarm Time (HH:MM, e.g. 07:30):', item.alarm_time);
  if (newTime === null) return;

  item.title = newTitle || item.title;
  item.alarm_time = newTime || item.alarm_time;

  fetch(`http://localhost:8000/alarms/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: item.title,
      alarm_time: item.alarm_time,
      alarm_type: 'daily',
      repeat_days: item.repeat_days || 'Mon,Tue,Wed,Thu,Fri',
      difficulty_level: 'medium',
      sound: item.sound || 'chime',
      vibration: true,
      snooze_enabled: true
    })
  }).catch(() => {});

  renderMyAlarms();
}

async function loadCognitivePerformance() {
  const userId = (user && user.id) ? parseInt(user.id) : 1;
  try {
    const res = await fetch(`http://localhost:8000/challenges/performance/${userId}`);
    if (!res.ok) return;
    const data = await res.json();
    
    const accEl = document.getElementById('perf-accuracy');
    const scoreEl = document.getElementById('perf-score');
    const totalEl = document.getElementById('perf-total');
    const timeEl = document.getElementById('perf-avg-time');
    const recEl = document.getElementById('perf-recommended');
    const badgeEl = document.getElementById('perf-rec-badge');
    
    if (accEl) accEl.textContent = `${data.success_rate ?? 0}%`;
    if (scoreEl) scoreEl.textContent = `${data.total_score ?? 0} pts`;
    if (totalEl) totalEl.textContent = `${data.total_attempts ?? 0}`;
    if (timeEl) timeEl.textContent = data.avg_time_seconds ? `${data.avg_time_seconds}s` : '0s';
    if (recEl) recEl.textContent = data.recommended_difficulty || 'medium';
    if (badgeEl) badgeEl.textContent = `Adaptive: ${(data.recommended_difficulty || 'medium').toUpperCase()}`;

    // Update category bar chart heights dynamically
    if (data.categories) {
      const maxHeight = 50;
      const catMap = {
        'bar-math': data.categories.math || 0,
        'bar-memory': data.categories.memory || 0,
        'bar-logic': data.categories.logic || 0,
        'bar-speed': data.categories.speed || 0
      };
      Object.keys(catMap).forEach(id => {
        const bar = document.getElementById(id);
        if (bar) {
          const val = catMap[id];
          const h = Math.max(8, Math.round((val / 100) * maxHeight));
          const y = 60 - h;
          bar.setAttribute('height', h);
          bar.setAttribute('y', y);
        }
      });

      // Update Dominant Category in Productivity Insights card
      let topCat = 'math';
      let maxScore = -1;
      Object.keys(data.categories).forEach(cat => {
        if (data.categories[cat] > maxScore) {
          maxScore = data.categories[cat];
          topCat = cat;
        }
      });
      const tagEl = document.getElementById('insight-top-cat-tag');
      const textEl = document.getElementById('insight-top-cat-text');
      const catName = topCat.toUpperCase();
      if (tagEl) tagEl.textContent = `${catName} (${maxScore}%)`;
      if (textEl) textEl.textContent = `Your highest accuracy is in ${topCat.charAt(0).toUpperCase() + topCat.slice(1)} challenges. Ready for the next level!`;
    }

    // Update Productivity Insights dynamically from backend calculation
    if (data.insights) {
      const peakEl = document.getElementById('pi-wave-peak');
      const clarityPill = document.getElementById('pi-clarity-pill');
      const clarityDesc = document.getElementById('pi-clarity-desc');
      const synergyPill = document.getElementById('pi-synergy-pill');
      const synergyDesc = document.getElementById('pi-synergy-desc');

      if (peakEl) peakEl.textContent = data.insights.peak_window;
      if (clarityPill) clarityPill.textContent = data.insights.clarity_pill;
      if (clarityDesc) clarityDesc.textContent = data.insights.clarity_desc;
      if (synergyPill) synergyPill.textContent = data.insights.synergy_pill;
      if (synergyDesc) synergyDesc.textContent = data.insights.synergy_desc;
    }

    // Update Wake-up Statistics card dynamically
    if (data.wakeup_stats) {
      const scoreVal = document.getElementById('stat-sleep-score-val');
      const radial = document.getElementById('stat-radial-progress');
      const avgTime = document.getElementById('stat-avg-wakeup-time');
      const consistency = document.getElementById('stat-wakeup-consistency');
      const sleepDur = document.getElementById('stat-avg-sleep-duration');
      const wakefulness = document.getElementById('stat-avg-wakefulness');

      if (scoreVal) scoreVal.textContent = `${data.wakeup_stats.sleep_score}%`;
      if (radial) radial.style.setProperty('--percent', data.wakeup_stats.sleep_score);
      if (avgTime) avgTime.textContent = data.wakeup_stats.avg_wakeup_time;
      if (consistency) {
        consistency.textContent = data.wakeup_stats.wakeup_consistency;
        if (data.wakeup_stats.wakeup_consistency === 'Excellent') {
          consistency.className = 'value font-semibold text-success';
        } else {
          consistency.className = 'value font-semibold text-primary';
        }
      }
      if (sleepDur) sleepDur.textContent = data.wakeup_stats.avg_sleep_duration;
      if (wakefulness) {
        const score = data.wakeup_stats.avg_wakefulness_score || 4.0;
        const label = data.wakeup_stats.wakefulness_label || 'Mostly Alert 🙂';
        wakefulness.textContent = `${score} / 5 — ${label}`;
      }
    }

    // Update Day Streak on Habit Score card based on user's actual daily alarm usage
    const streakEl = document.getElementById('hs-streak-count');
    if (streakEl) {
      const streakVal = data.day_streak !== undefined ? data.day_streak : 1;
      streakEl.textContent = `${streakVal}-Day Streak`;
    }

    // Update Alarm History Pie Chart & Legends
    if (data.breakdown) {
      const onTime = data.breakdown.on_time || 0;
      const snoozed = data.breakdown.snoozed || 0;
      const failed = data.breakdown.failed || 0;
      const total = onTime + snoozed + failed;

      const elOnTime = document.getElementById('ah-count-ontime');
      const elSnoozed = document.getElementById('ah-count-snoozed');
      const elFailed = document.getElementById('ah-count-failed');

      if (elOnTime) elOnTime.textContent = onTime;
      if (elSnoozed) elSnoozed.textContent = snoozed;
      if (elFailed) elFailed.textContent = failed;

      if (total > 0) {
        const circumference = 238.76;
        const p1 = (onTime / total) * circumference;
        const p2 = (snoozed / total) * circumference;
        const p3 = (failed / total) * circumference;

        const s1 = document.getElementById('pie-slice-ontime');
        const s2 = document.getElementById('pie-slice-snoozed');
        const s3 = document.getElementById('pie-slice-failed');

        if (s1) {
          s1.setAttribute('stroke-dasharray', `${p1} ${circumference}`);
          s1.setAttribute('stroke-dashoffset', '0');
        }
        if (s2) {
          s2.setAttribute('stroke-dasharray', `${p2} ${circumference}`);
          s2.setAttribute('stroke-dashoffset', `-${p1}`);
        }
        if (s3) {
          s3.setAttribute('stroke-dasharray', `${p3} ${circumference}`);
          s3.setAttribute('stroke-dashoffset', `-${p1 + p2}`);
        }
      }
    }

    // Refresh Alarm History Table with real timestamps and delay data
    renderAlarmHistoryTable();
    loadAchievements();
    loadCognitiveTrends();
    loadBehavioralAnalytics();
  } catch (e) {
    // Show zeros on error instead of leaving --
    const ids = ['perf-accuracy', 'perf-score', 'perf-total', 'perf-avg-time'];
    const defaults = ['0%', '0 pts', '0', '0s'];
    ids.forEach((id, i) => { const el = document.getElementById(id); if (el) el.textContent = defaults[i]; });
  }
}

async function loadBehavioralAnalytics() {
  const userId = (user && user.id) ? parseInt(user.id) : 1;
  try {
    const res = await fetch(`http://localhost:8000/analytics/behavioral/${userId}`);
    if (!res.ok) return;
    const data = await res.json();

    // 1. Circadian Consistency
    if (data.circadian_consistency) {
      const scoreEl = document.getElementById('ba-consistency-score');
      const stabEl = document.getElementById('ba-rhythm-stability');
      const varEl = document.getElementById('ba-wake-variance');

      if (scoreEl) scoreEl.textContent = `${data.circadian_consistency.consistency_score}%`;
      if (stabEl) stabEl.textContent = data.circadian_consistency.rhythm_stability;
      if (varEl) varEl.textContent = `Variance: ±${data.circadian_consistency.wake_variance_minutes} mins wake time`;
    }

    // 2. Snooze Profile & Snooze Pattern Analysis
    if (data.snooze_profile) {
      const badgeEl = document.getElementById('ba-snooze-risk-badge');
      const freqEl = document.getElementById('ba-snooze-freq');
      const avgEl = document.getElementById('ba-avg-snoozes');

      if (badgeEl) {
        badgeEl.textContent = `${data.snooze_profile.snooze_risk_level.toUpperCase()} RISK`;
        badgeEl.style.background = data.snooze_profile.risk_badge_color || '#10b981';
      }
      if (freqEl) freqEl.textContent = `${data.snooze_profile.snooze_frequency_percent}%`;
      if (avgEl) avgEl.textContent = `Avg ${data.snooze_profile.avg_snoozes_per_alarm} snoozes per alarm`;
    }

    if (data.snooze_pattern_analysis) {
      const pill = document.getElementById('ba-snooze-relapse-pill');
      const peakDay = document.getElementById('ba-peak-day');
      const trigger = document.getElementById('ba-snooze-trigger');
      const delayMins = document.getElementById('ba-snooze-delay-mins');
      const summary = document.getElementById('ba-snooze-summary');

      if (pill) pill.textContent = `${data.snooze_pattern_analysis.relapse_probability_pct}% Relapse Risk`;
      if (peakDay) peakDay.textContent = data.snooze_pattern_analysis.peak_snooze_day;
      if (trigger) trigger.textContent = data.snooze_pattern_analysis.primary_snooze_trigger;
      if (delayMins) delayMins.textContent = `${data.snooze_pattern_analysis.avg_delay_mins} Mins`;
      if (summary) summary.textContent = data.snooze_pattern_analysis.pattern_summary;

      renderSnoozePatternLineChart(data.snooze_pattern_analysis.daily_snooze_trend, data.snooze_pattern_analysis.peak_snooze_day);
    }

    // 3. Sleep Inertia Latency
    if (data.sleep_inertia) {
      const secEl = document.getElementById('ba-inertia-seconds');
      const warmEl = document.getElementById('ba-warmup-rate');
      const peakEl = document.getElementById('ba-peak-window');

      if (secEl) secEl.textContent = `${data.sleep_inertia.inertia_index_seconds}s`;
      if (warmEl) warmEl.textContent = `${data.sleep_inertia.warmup_rate_percent}% Warmup`;
      if (peakEl) peakEl.textContent = `Peak Window: ${data.sleep_inertia.peak_alertness_window}`;
    }

    // 4. Next-Day Forecast
    if (data.predictive_forecast) {
      const scoreEl = document.getElementById('ba-forecast-score');
      const lblEl = document.getElementById('ba-forecast-label');
      const confEl = document.getElementById('ba-confidence');

      if (scoreEl) scoreEl.textContent = `${data.predictive_forecast.predicted_wakefulness_score} / 5`;
      if (lblEl) lblEl.textContent = data.predictive_forecast.forecast_label;
      if (confEl) confEl.textContent = `Confidence Level: ${data.predictive_forecast.confidence_percent}%`;

      // Update Wake-up Confirmation & Productivity Correlation Chart Dot
      const activeDot = document.getElementById('corr-active-dot');
      const corrTag = document.getElementById('ba-correlation-tag');
      const score = data.predictive_forecast.predicted_wakefulness_score || 4.2;
      
      const posX = 30 + Math.min(240, Math.max(0, (score - 1.0) * 60));
      const posY = 80 - Math.min(65, Math.max(0, (score - 1.0) * 16.25));
      if (activeDot) {
        activeDot.setAttribute('cx', posX);
        activeDot.setAttribute('cy', posY);
      }
      if (corrTag) {
        const pct = Math.round(score * 19.5);
        corrTag.textContent = `Strong Correlation (+${pct}%)`;
      }
    }

    // 5. Behavioral Nudges
    if (data.behavioral_nudges) {
      const listContainer = document.getElementById('ba-nudges-list');
      if (listContainer) {
        listContainer.innerHTML = data.behavioral_nudges.map(nudge => `
          <div style="background:#ffffff;border:1px solid #e0f2fe;border-radius:10px;padding:10px 14px;font-size:0.83rem;color:#0f172a;display:flex;align-items:center;gap:10px;">
            <span style="color:#0284c7;font-weight:700;font-size:1.1rem;">⚡</span>
            <span>${nudge}</span>
          </div>
        `).join('');
      }
    }
  } catch (e) {
    console.warn('Error loading behavioral analytics:', e);
  }
}

function renderSnoozePatternLineChart(trendData, peakDay) {
  const linePath = document.getElementById('snooze-line-path');
  const areaPath = document.getElementById('snooze-area-path');
  const nodesGroup = document.getElementById('snooze-trend-nodes');
  const peakDot = document.getElementById('snooze-peak-dot');
  const peakTag = document.getElementById('snooze-trend-peak-tag');

  if (!trendData || trendData.length === 0) return;

  const snoozeVals = trendData.map(d => d.snoozes || 0);
  const maxVal = Math.max(3.0, ...snoozeVals);
  const points = trendData.map((item, i) => {
    const x = 20 + i * (260 / (trendData.length - 1 || 1));
    const snoozes = item.snoozes || 0;
    const y = 80 - Math.min(65, Math.max(0, (snoozes / maxVal) * 60));
    return { x, y, day: item.day, snoozes, delay: item.delay_mins || (snoozes * 5) };
  });

  // Smooth Cubic Bezier Interpolation Curve
  let pathD = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const curr = points[i];
    const next = points[i + 1];
    const cp1x = curr.x + (next.x - curr.x) / 2;
    const cp1y = curr.y;
    const cp2x = curr.x + (next.x - curr.x) / 2;
    const cp2y = next.y;
    pathD += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${next.x.toFixed(1)} ${next.y.toFixed(1)}`;
  }

  if (linePath) linePath.setAttribute('d', pathD);
  if (areaPath) {
    const areaD = pathD + ` L ${points[points.length - 1].x.toFixed(1)} 80 L ${points[0].x.toFixed(1)} 80 Z`;
    areaPath.setAttribute('d', areaD);
  }

  // Render node dots & highlight peak
  let peakPoint = points[0];
  let maxSnoozeCount = -1;

  if (nodesGroup) {
    nodesGroup.innerHTML = points.map(p => {
      if (p.snoozes > maxSnoozeCount) {
        maxSnoozeCount = p.snoozes;
        peakPoint = p;
      }
      let fill = '#10b981'; // green
      if (p.snoozes >= 2.0) fill = '#dc2626'; // red
      else if (p.snoozes >= 1.0) fill = '#ea580c'; // orange

      return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="${fill}" stroke="#ffffff" stroke-width="2">
        <title>${p.day}: ${p.snoozes} snoozes (${p.delay}m delay)</title>
      </circle>`;
    }).join('');
  }

  if (peakDot && peakPoint) {
    peakDot.setAttribute('cx', peakPoint.x.toFixed(1));
    peakDot.setAttribute('cy', peakPoint.y.toFixed(1));
  }

  if (peakTag) {
    const dayName = peakDay || peakPoint.day;
    peakTag.textContent = `Peak: ${dayName} (${maxSnoozeCount.toFixed(1)} Snoozes)`;
  }
}

async function loadAchievements() {
  const userId = (user && user.id) ? parseInt(user.id) : 1;
  const grid = document.getElementById('achievements-grid');
  const badgeEl = document.getElementById('ach-unlocked-badge');
  if (!grid) return;

  try {
    const res = await fetch(`http://localhost:8000/achievements/${userId}`);
    if (!res.ok) return;
    const items = await res.json();

    const unlockedCount = items.filter(i => i.unlocked).length;
    if (badgeEl) badgeEl.textContent = `${unlockedCount} / ${items.length} Unlocked`;

    grid.innerHTML = items.map(item => `
      <div class="ach-item ${item.unlocked ? 'unlocked' : 'locked'}">
        <div class="ach-top-row">
          <div class="ach-icon-box">${item.icon}</div>
          <span class="ach-status-tag ${item.unlocked ? 'unlocked' : 'locked'}">
            ${item.unlocked ? 'UNLOCKED' : 'LOCKED'}
          </span>
        </div>
        <h4 class="ach-title">${item.title}</h4>
        <p class="ach-desc">${item.description}</p>
        <div class="ach-progress-track">
          <div class="ach-progress-fill" style="width: ${item.progress_percent}%;"></div>
        </div>
      </div>
    `).join('');
  } catch (e) {
    console.warn('Error loading achievements:', e);
  }
}

async function loadCognitiveTrends() {
  const userId = (user && user.id) ? parseInt(user.id) : 1;
  try {
    const res = await fetch(`http://localhost:8000/challenges/trends/${userId}`);
    if (!res.ok) return;
    const data = await res.json();

    const growthEl = document.getElementById('lt-growth-val');
    const speedEl = document.getElementById('lt-speed-val');
    const strongTag = document.getElementById('lt-strongest-tag');
    const focusTag = document.getElementById('lt-focus-tag');
    const recEl = document.getElementById('lt-recommendation-text');
    const barsContainer = document.getElementById('lt-domain-bars');

    if (growthEl) growthEl.textContent = `+${data.growth_rate_percent}%`;
    if (speedEl) speedEl.textContent = `+${data.speed_improvement_percent}%`;
    if (strongTag) strongTag.textContent = `Strong: ${data.strongest_domain}`;
    if (focusTag) focusTag.textContent = `Focus: ${data.focus_domain}`;
    if (recEl) recEl.textContent = data.recommendation;

    if (barsContainer && data.category_balance) {
      barsContainer.innerHTML = Object.keys(data.category_balance).map(cat => {
        const val = data.category_balance[cat];
        return `
          <div class="lt-domain-row">
            <span class="lt-domain-name">${cat}</span>
            <div class="lt-domain-bar-track">
              <div class="lt-domain-bar-fill" style="width: ${val}%;"></div>
            </div>
            <span class="lt-domain-percent">${val}%</span>
          </div>
        `;
      }).join('');
    }
  } catch (e) {
    console.warn('Error loading learning trends:', e);
  }
}


// ── Web Audio Synth Engine for Dynamic Sound Synthesis ────
class AlarmAudioEngine {
  constructor() {
    this.ctx = null;
    this.isPlaying = false;
    this.osc = null;
    this.gain = null;
    this.timer = null;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
  }

  start(soundType = 'default') {
    this.init();
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    this.isPlaying = true;

    let freq1 = 880;
    let freq2 = 1760;
    if (soundType === 'beep') { freq1 = 900; freq2 = 1200; }
    else if (soundType === 'chime') { freq1 = 523.25; freq2 = 659.25; }
    else if (soundType === 'bell') { freq1 = 440; freq2 = 880; }

    const playTone = () => {
      if (!this.isPlaying) return;
      try {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = soundType === 'chime' ? 'sine' : 'square';
        osc.frequency.setValueAtTime(freq1, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(freq2, this.ctx.currentTime + 0.15);

        gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.4);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start();
        osc.stop(this.ctx.currentTime + 0.45);
      } catch (e) {}
    };

    playTone();
    this.timer = setInterval(playTone, 800);
  }

  stop() {
    this.isPlaying = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

const alarmAudioEngine = new AlarmAudioEngine();

function triggerVibration() {
  if (navigator.vibrate) {
    navigator.vibrate([400, 200, 400, 200, 800]);
  }
}

// Global state for active alarm trigger modal
let currentActiveAlarm = null;
let activeAlarmChallengeData = null;
let activeAlarmTimer = null;
let activeAlarmSecondsLeft = 45;
let activeAlarmSnoozeCountdown = null;
let activeAlarmStartTime = null;
let selectedActiveAlarmAnswer = '';
let triggeredAlarmsMap = new Set();
let activeAlarmCurrentCorrect = 0;
let activeAlarmRequiredQuestions = 2;

function triggerActiveAlarm(alarm) {
  currentActiveAlarm = alarm;
  activeAlarmStartTime = Date.now();
  selectedActiveAlarmAnswer = '';
  activeAlarmCurrentCorrect = 0;
  activeAlarmRequiredQuestions = alarm.question_count || 2;

  alarmAudioEngine.start(alarm.sound || 'default');
  if (alarm.vibration !== false) triggerVibration();

  const overlay = document.getElementById('alarmTriggerModalOverlay');
  if (!overlay) return;

  // Set header info
  const timeDisp = document.getElementById('at-time-display');
  const titleDisp = document.getElementById('at-title-display');
  const typeBadge = document.getElementById('at-badge-type');
  const diffBadge = document.getElementById('at-badge-diff');
  const snoozeBadge = document.getElementById('at-badge-snooze');
  const emergencyBanner = document.getElementById('at-emergency-banner');

  const hh = alarm.alarm_time.substring(0, 2);
  const mm = alarm.alarm_time.substring(3, 5);
  const hr = parseInt(hh) % 12 || 12;
  const ap = parseInt(hh) >= 12 ? 'PM' : 'AM';
  if (timeDisp) timeDisp.textContent = `${String(hr).padStart(2,'0')}:${mm} ${ap}`;
  if (titleDisp) titleDisp.textContent = alarm.title || 'Morning Wake-up Alarm';

  const maxSnoozes = alarm.max_snooze_count || 3;
  const currentSnoozes = alarm.current_snooze_count || 0;
  if (snoozeBadge) snoozeBadge.textContent = `Snooze ${currentSnoozes} / ${maxSnoozes}`;

  // Check emergency fallback condition: max snoozes exhausted
  if (currentSnoozes >= maxSnoozes) {
    alarm.difficulty_level = 'beginner';
    if (emergencyBanner) emergencyBanner.style.display = 'block';
  } else {
    if (emergencyBanner) emergencyBanner.style.display = 'none';
  }

  if (typeBadge) typeBadge.textContent = (alarm.challenge || 'math').toUpperCase();
  if (diffBadge) diffBadge.textContent = (alarm.difficulty_level || 'medium').toUpperCase();

  // Sync dropdown & setup buttons with initial question count
  const selectEl = document.getElementById('at-qcount-select');
  if (selectEl) selectEl.value = String(activeAlarmRequiredQuestions);

  document.querySelectorAll('.at-qcount-btn').forEach(b => {
    const qc = parseInt(b.getAttribute('data-qcount') || '2');
    b.classList.toggle('active', qc === activeAlarmRequiredQuestions);
  });

  const startBtn = document.getElementById('at-start-challenge-btn');
  if (startBtn) {
    startBtn.textContent = `🚀 START CHALLENGE (${activeAlarmRequiredQuestions} QUESTION${activeAlarmRequiredQuestions > 1 ? 'S' : ''})`;
  }

  const qProgressBadge = document.getElementById('at-badge-qprogress');
  if (qProgressBadge) {
    qProgressBadge.textContent = `Question 1 of ${activeAlarmRequiredQuestions}`;
  }

  // Show Pre-Challenge Setup Screen FIRST before challenge starts
  const setupSection = document.getElementById('at-start-setup-section');
  const challengeSection = document.getElementById('at-challenge-section');
  const snoozeSection = document.getElementById('at-snooze-section');
  const successSection = document.getElementById('at-success-section');

  if (setupSection) setupSection.style.display = 'block';
  if (challengeSection) challengeSection.style.display = 'none';
  if (snoozeSection) snoozeSection.style.display = 'none';
  if (successSection) successSection.style.display = 'none';

  overlay.classList.add('open');
}

function setAtQuestionCount(count, btn) {
  activeAlarmRequiredQuestions = count;
  document.querySelectorAll('.at-qcount-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  const selectEl = document.getElementById('at-qcount-select');
  if (selectEl) selectEl.value = String(count);

  const startBtn = document.getElementById('at-start-challenge-btn');
  if (startBtn) {
    startBtn.textContent = `🚀 START CHALLENGE (${count} QUESTION${count > 1 ? 'S' : ''})`;
  }
  const qProgressBadge = document.getElementById('at-badge-qprogress');
  if (qProgressBadge) {
    qProgressBadge.textContent = `Question 1 of ${count}`;
  }
}

function changeAtActiveQuestions(val) {
  activeAlarmRequiredQuestions = parseInt(val || 2);
  document.querySelectorAll('.at-qcount-btn').forEach(b => {
    const qc = parseInt(b.getAttribute('data-qcount') || '2');
    b.classList.toggle('active', qc === activeAlarmRequiredQuestions);
  });

  const qProgressBadge = document.getElementById('at-badge-qprogress');
  const cardHeaderTitle = document.getElementById('at-card-header-title');
  const progressBanner = document.getElementById('at-progress-banner');
  const submitBtn = document.getElementById('at-submit-btn');

  if (qProgressBadge) qProgressBadge.textContent = `Question ${activeAlarmCurrentCorrect + 1} of ${activeAlarmRequiredQuestions}`;
  if (cardHeaderTitle) cardHeaderTitle.textContent = `COGNITIVE DISMISSAL REQUIRED (${activeAlarmCurrentCorrect}/${activeAlarmRequiredQuestions} SOLVED)`;
  if (progressBanner) progressBanner.textContent = `🔒 Snooze is locked! Solve all ${activeAlarmRequiredQuestions} question(s) correctly to unlock Snooze.`;
  if (submitBtn) submitBtn.textContent = `🔓 SOLVE QUESTION ${activeAlarmCurrentCorrect + 1} OF ${activeAlarmRequiredQuestions}`;
}

function startActiveAlarmChallengeSequence() {
  const setupSection = document.getElementById('at-start-setup-section');
  const challengeSection = document.getElementById('at-challenge-section');
  if (setupSection) setupSection.style.display = 'none';
  if (challengeSection) challengeSection.style.display = 'block';

  const cardHeaderTitle = document.getElementById('at-card-header-title');
  const progressBanner = document.getElementById('at-progress-banner');
  const submitBtn = document.getElementById('at-submit-btn');
  const qProgressBadge = document.getElementById('at-badge-qprogress');

  if (qProgressBadge) qProgressBadge.textContent = `Question 1 of ${activeAlarmRequiredQuestions}`;
  if (cardHeaderTitle) cardHeaderTitle.textContent = `COGNITIVE DISMISSAL REQUIRED (0/${activeAlarmRequiredQuestions} SOLVED)`;
  if (progressBanner) progressBanner.textContent = `🔒 Snooze is locked! Solve all ${activeAlarmRequiredQuestions} question(s) correctly to unlock Snooze.`;
  if (submitBtn) submitBtn.textContent = `🔓 SOLVE QUESTION 1 OF ${activeAlarmRequiredQuestions}`;

  activeAlarmCurrentCorrect = 0;
  loadActiveAlarmChallenge(currentActiveAlarm ? currentActiveAlarm.challenge : 'math', currentActiveAlarm ? currentActiveAlarm.difficulty_level : 'medium');
}

async function loadActiveAlarmChallenge(type, diff) {
  const qText = document.getElementById('at-question-text');
  const optBox = document.getElementById('at-options-container');
  const inpBox = document.getElementById('at-input-container');
  const fbBox = document.getElementById('at-feedback');
  if (fbBox) fbBox.style.display = 'none';

  if (qText) qText.textContent = "Generating cognitive challenge...";
  if (optBox) optBox.innerHTML = "";

  try {
    const res = await fetch(`http://localhost:8000/challenges/generate?type=${type}&difficulty=${diff}`);
    if (res.ok) {
      activeAlarmChallengeData = await res.json();
    } else {
      throw new Error();
    }
  } catch (e) {
    activeAlarmChallengeData = {
      challenge_id: "local_" + Date.now(),
      type: type,
      difficulty: diff,
      question: "What is 14 + 27?",
      options: ["39", "41", "43", "37"],
      answer_key: "41",
      input_type: "choice",
      time_limit: 45
    };
  }

  renderActiveAlarmChallenge();
}

function renderActiveAlarmChallenge() {
  const data = activeAlarmChallengeData;
  if (!data) return;

  const qText = document.getElementById('at-question-text');
  const optBox = document.getElementById('at-options-container');
  const inpBox = document.getElementById('at-input-container');

  if (qText) qText.textContent = typeof data.question === 'string' ? data.question : JSON.stringify(data.question);

  if (data.input_type === 'choice' && data.options && data.options.length > 0) {
    if (optBox) optBox.style.display = 'grid';
    if (inpBox) inpBox.style.display = 'none';
    optBox.innerHTML = data.options.map(opt => `
      <button type="button" class="at-opt-btn" onclick="selectActiveAlarmOption('${opt}', this)">
        ${opt}
      </button>
    `).join('');
  } else {
    if (optBox) optBox.style.display = 'none';
    if (inpBox) inpBox.style.display = 'block';
    const inp = document.getElementById('at-user-input');
    if (inp) { inp.value = ''; inp.focus(); }
  }

  startActiveAlarmTimer(data.time_limit || 45);
}

function selectActiveAlarmOption(val, btn) {
  selectedActiveAlarmAnswer = val;
  document.querySelectorAll('.at-opt-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
}

function startActiveAlarmTimer(seconds) {
  if (activeAlarmTimer) clearInterval(activeAlarmTimer);
  activeAlarmSecondsLeft = seconds;
  const timerDisp = document.getElementById('at-timer-display');

  activeAlarmTimer = setInterval(() => {
    activeAlarmSecondsLeft--;
    if (timerDisp) timerDisp.textContent = `⏳ ${activeAlarmSecondsLeft}s`;

    if (activeAlarmSecondsLeft <= 0) {
      clearInterval(activeAlarmTimer);
      handleActiveAlarmFailure("Time expired! Challenge failed.");
    }
  }, 1000);
}

async function submitActiveAlarmAnswer() {
  let userAns = selectedActiveAlarmAnswer;
  const inp = document.getElementById('at-user-input');
  const inpBox = document.getElementById('at-input-container');
  // Only use text input value if it is actually visible
  if (inp && inpBox && inpBox.style.display === 'block') {
    userAns = inp.value.trim();
  }

  if (!userAns) {
    const fbBox = document.getElementById('at-feedback');
    if (fbBox) {
      fbBox.style.display = 'block';
      fbBox.style.background = '#fef2f2';
      fbBox.style.color = '#dc2626';
      fbBox.textContent = 'Please select or type an answer.';
    }
    return;
  }

  clearInterval(activeAlarmTimer);
  alarmAudioEngine.stop();

  const timeTaken = (Date.now() - (activeAlarmStartTime || Date.now())) / 1000;
  const data = activeAlarmChallengeData;

  let verifyRes = null;
  try {
    const userId = (user && user.id) ? parseInt(user.id) : 1;
    const res = await fetch('http://localhost:8000/challenges/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        alarm_id: currentActiveAlarm ? currentActiveAlarm.id : null,
        challenge_id: data ? data.challenge_id : "1",
        challenge_type: currentActiveAlarm ? currentActiveAlarm.challenge : "math",
        difficulty: currentActiveAlarm ? currentActiveAlarm.difficulty_level : "medium",
        answer_key: data ? String(data.answer_key) : "",
        user_answer: String(userAns),
        time_taken_seconds: timeTaken
      })
    });
    if (res.ok) verifyRes = await res.json();
  } catch (e) {}

  if (!verifyRes) {
    const isCorrect = String(userAns).trim().toLowerCase() === String(data.answer_key).trim().toLowerCase();
    verifyRes = {
      success: isCorrect,
      message: isCorrect ? 'Correct!' : `Incorrect. Answer was: ${data.answer_key}`,
      score: isCorrect ? 120 : 0
    };
  }

  if (verifyRes.success) {
    activeAlarmCurrentCorrect++;

    if (activeAlarmCurrentCorrect < activeAlarmRequiredQuestions) {
      const fbBox = document.getElementById('at-feedback');
      if (fbBox) {
        fbBox.style.display = 'block';
        fbBox.style.background = '#dcfce7';
        fbBox.style.color = '#15803d';
        fbBox.textContent = `✅ Correct! Question ${activeAlarmCurrentCorrect} of ${activeAlarmRequiredQuestions} solved. Loading next question...`;
      }

      const qProgressBadge = document.getElementById('at-badge-qprogress');
      if (qProgressBadge) {
        qProgressBadge.textContent = `Question ${activeAlarmCurrentCorrect + 1} of ${activeAlarmRequiredQuestions}`;
      }
      const cardHeaderTitle = document.getElementById('at-card-header-title');
      if (cardHeaderTitle) {
        cardHeaderTitle.textContent = `COGNITIVE DISMISSAL REQUIRED (${activeAlarmCurrentCorrect}/${activeAlarmRequiredQuestions} SOLVED)`;
      }
      const submitBtn = document.getElementById('at-submit-btn');
      if (submitBtn) {
        submitBtn.textContent = `🔓 SOLVE QUESTION ${activeAlarmCurrentCorrect + 1} OF ${activeAlarmRequiredQuestions}`;
      }

      selectedActiveAlarmAnswer = '';

      setTimeout(() => {
        loadActiveAlarmChallenge(currentActiveAlarm ? currentActiveAlarm.challenge : 'math', currentActiveAlarm ? currentActiveAlarm.difficulty_level : 'medium');
      }, 1200);

    } else {
      // All required questions solved! Snooze & Dismiss controls unlocked!
      if (verifyRes.log_id) modalLastLogId = verifyRes.log_id;

      if (currentActiveAlarm && currentActiveAlarm.id) {
        fetch(`http://localhost:8000/alarms/${currentActiveAlarm.id}/snooze`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reset: true })
        }).catch(() => {});
      }

      document.getElementById('at-challenge-section').style.display = 'none';
      document.getElementById('at-success-section').style.display = 'block';
      const successMsg = document.getElementById('at-success-msg');
      if (successMsg) successMsg.textContent = `🎉 All ${activeAlarmRequiredQuestions} questions answered correctly! Snooze & Dismiss are now unlocked.`;
      const statusEl = document.getElementById('at-wake-status');
      if (statusEl) {
        statusEl.style.color = '#64748b';
        statusEl.textContent = 'Select rating to record morning wakefulness';
      }
      setTimeout(() => loadCognitivePerformance(), 500);
    }
  } else {
    // Answer was incorrect
    const fbBox = document.getElementById('at-feedback');
    if (fbBox) {
      fbBox.style.display = 'block';
      fbBox.style.background = '#fef2f2';
      fbBox.style.color = '#dc2626';
      fbBox.textContent = `❌ ${verifyRes.message}. Loading next question...`;
    }
    selectedActiveAlarmAnswer = '';
    setTimeout(() => {
      loadActiveAlarmChallenge(currentActiveAlarm ? currentActiveAlarm.challenge : 'math', currentActiveAlarm ? currentActiveAlarm.difficulty_level : 'medium');
    }, 1400);
  }
}

function userSnoozeAfterTask() {
  alarmAudioEngine.stop();
  handleActiveAlarmFailure("Task completed! User selected Snooze option.");
}

// ── Submit Wakefulness Rating for Dashboard Modals ─────────────
let modalLastLogId = null;

async function submitModalWakefulness(score, btnElement, statusId = 'cm-wake-status') {
  const container = btnElement ? btnElement.closest('.wakefulness-container') : null;
  if (container) {
    container.querySelectorAll('.wake-btn-modal').forEach(b => {
      b.style.borderColor = '#e2e8f0';
      b.style.background = '#fff';
      b.style.boxShadow = 'none';
    });
  }
  if (btnElement) {
    btnElement.style.borderColor = '#2563eb';
    btnElement.style.background = '#eff6ff';
    btnElement.style.boxShadow = '0 0 0 2px rgba(37, 99, 235, 0.2)';
  }

  const statusEl = document.getElementById(statusId);
  if (statusEl) {
    statusEl.style.color = '#2563eb';
    statusEl.textContent = 'Recording wakefulness rating...';
  }

  const userId = (user && user.id) ? parseInt(user.id) : 1;

  try {
    const res = await fetch('http://localhost:8000/challenges/wakefulness', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        log_id: modalLastLogId,
        user_id: userId,
        score: score
      })
    });
    const data = await res.json();
    if (statusEl) {
      if (data.success) {
        statusEl.style.color = '#16a34a';
        statusEl.textContent = `✅ Saved! Rated ${score}/5 — ${data.label}`;
        setTimeout(() => loadCognitivePerformance(), 400);
      } else {
        statusEl.style.color = '#dc2626';
        statusEl.textContent = 'Could not record rating.';
      }
    }
  } catch (err) {
    if (statusEl) {
      statusEl.style.color = '#dc2626';
      statusEl.textContent = 'Server connection error.';
    }
  }
}

function handleActiveAlarmFailure(msg) {
  alarmAudioEngine.stop();
  if (currentActiveAlarm && currentActiveAlarm.id) {
    fetch(`http://localhost:8000/alarms/${currentActiveAlarm.id}/snooze`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ increment: true })
    }).then(r => r.json()).then(updated => {
      if (updated && currentActiveAlarm) {
        currentActiveAlarm.current_snooze_count = updated.current_snooze_count;
      }
    }).catch(() => {
      if (currentActiveAlarm) {
        currentActiveAlarm.current_snooze_count = (currentActiveAlarm.current_snooze_count || 0) + 1;
      }
    });
  }

  document.getElementById('at-challenge-section').style.display = 'none';
  document.getElementById('at-snooze-section').style.display = 'block';

  const snoozeMsg = document.getElementById('at-snooze-msg');
  if (snoozeMsg) snoozeMsg.textContent = `${msg} Alarm going into snooze retry loop.`;

  const snoozeMins = (currentActiveAlarm && currentActiveAlarm.snooze_duration) ? currentActiveAlarm.snooze_duration : 5;
  startSnoozeCountdown(snoozeMins * 60);
}

let snoozeTimeRemaining = 0;
function startSnoozeCountdown(totalSeconds) {
  if (activeAlarmSnoozeCountdown) clearInterval(activeAlarmSnoozeCountdown);
  snoozeTimeRemaining = totalSeconds;
  updateSnoozeTimerDisplay();

  activeAlarmSnoozeCountdown = setInterval(() => {
    snoozeTimeRemaining--;
    updateSnoozeTimerDisplay();
    if (snoozeTimeRemaining <= 0) {
      clearInterval(activeAlarmSnoozeCountdown);
      if (currentActiveAlarm) {
        triggerActiveAlarm(currentActiveAlarm);
      }
    }
  }, 1000);
}

function updateSnoozeTimerDisplay() {
  const disp = document.getElementById('at-snooze-timer');
  if (!disp) return;
  const m = Math.floor(snoozeTimeRemaining / 60);
  const s = snoozeTimeRemaining % 60;
  disp.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function fastForwardSnooze() {
  if (activeAlarmSnoozeCountdown) clearInterval(activeAlarmSnoozeCountdown);
  if (currentActiveAlarm) {
    triggerActiveAlarm(currentActiveAlarm);
  }
}

function closeActiveAlarmModal() {
  alarmAudioEngine.stop();
  if (activeAlarmTimer) clearInterval(activeAlarmTimer);
  if (activeAlarmSnoozeCountdown) clearInterval(activeAlarmSnoozeCountdown);
  const overlay = document.getElementById('alarmTriggerModalOverlay');
  if (overlay) overlay.classList.remove('open');
  loadMyAlarms();
}

// ── Alarm Polling Loop ────
let cachedAlarms = [];

function startAlarmPolling() {
  const userId = (user && user.id) ? parseInt(user.id) : 1;

  const fetchLatestAlarms = () => {
    fetch(`http://localhost:8000/alarms/${userId}`)
      .then(r => r.json())
      .then(alarms => { cachedAlarms = alarms; })
      .catch(() => {});
  };

  fetchLatestAlarms();

  setInterval(() => {
    fetchLatestAlarms();
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const nowHHMM = `${hh}:${mm}`;

    cachedAlarms.forEach(alarm => {
      if (!alarm.is_active) return;
      const alarmHHMM = (alarm.alarm_time || "").substring(0, 5);
      const key = `${alarm.id}_${nowHHMM}`;

      if (alarmHHMM === nowHHMM && !triggeredAlarmsMap.has(key)) {
        triggeredAlarmsMap.add(key);
        triggerActiveAlarm(alarm);
      }
    });
  }, 5000);
}

document.addEventListener('DOMContentLoaded', () => {
  renderMyAlarms();
  loadCognitivePerformance();
  loadHabitState();
  startAlarmPolling();
});

// ── HABIT SCORE INTERACTION ENGINE ─────────────────────────
function toggleHabitItem(itemEl) {
  if (!itemEl) return;
  const checkbox = itemEl.querySelector('.hs-checkbox');
  const isCompleted = itemEl.classList.contains('completed');
  
  if (isCompleted) {
    itemEl.classList.remove('completed');
    if (checkbox) checkbox.checked = false;
  } else {
    itemEl.classList.add('completed');
    if (checkbox) checkbox.checked = true;
  }

  // Save to backend
  const nameEl = itemEl.querySelector('.hs-name');
  const habitName = nameEl ? nameEl.textContent.trim() : 'Unknown Habit';
  const nowCompleted = itemEl.classList.contains('completed');
  const userId = (user && user.id) ? parseInt(user.id) : 1;

  fetch('http://localhost:8000/habits/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, habit_name: habitName, completed: nowCompleted })
  })
  .then(r => r.json())
  .then(() => loadHabitAdherence())
  .catch(() => {});
  
  updateHabitScoreProgress();
}

function updateHabitScoreProgress() {
  const allItems = document.querySelectorAll('.hs-item');
  if (!allItems.length) return;
  const completedItems = document.querySelectorAll('.hs-item.completed');
  
  const total = allItems.length;
  const count = completedItems.length;
  const percent = Math.round((count / total) * 100);
  
  const percentEl = document.getElementById('habit-progress-percent');
  const fillEl = document.getElementById('habit-progress-fill');
  const subtextEl = document.getElementById('habit-subtext');
  
  if (percentEl) percentEl.textContent = `${percent}%`;
  if (fillEl) fillEl.style.width = `${percent}%`;
  if (subtextEl) subtextEl.textContent = `${count} of ${total} Daily Habits Completed`;

  // Persist state to localStorage per user
  try {
    const userId = (user && user.id) ? user.id : 'guest';
    const state = Array.from(allItems).map(el => el.classList.contains('completed'));
    localStorage.setItem(`habit_state_${userId}`, JSON.stringify(state));
  } catch (e) {}
}

function loadHabitState() {
  try {
    const userId = (user && user.id) ? user.id : 'guest';
    const saved = localStorage.getItem(`habit_state_${userId}`);
    if (saved) {
      const state = JSON.parse(saved);
      const allItems = document.querySelectorAll('.hs-item');
      allItems.forEach((el, idx) => {
        const checkbox = el.querySelector('.hs-checkbox');
        if (state[idx]) {
          el.classList.add('completed');
          if (checkbox) checkbox.checked = true;
        } else {
          el.classList.remove('completed');
          if (checkbox) checkbox.checked = false;
        }
      });
      updateHabitScoreProgress();
    }
  } catch (e) {}
  // Also load from backend
  loadHabitAdherence();
}

async function loadHabitAdherence() {
  const userId = (user && user.id) ? parseInt(user.id) : 1;
  try {
    const res = await fetch(`http://localhost:8000/habits/${userId}`);
    if (!res.ok) return;
    const data = await res.json();

    // Update adherence % in the habit card
    const weekPct = data.adherence_7day_pct ?? 0;
    const percentEl = document.getElementById('habit-progress-percent');
    const fillEl = document.getElementById('habit-progress-fill');
    const subtextEl = document.getElementById('habit-subtext');

    if (percentEl) percentEl.textContent = `${weekPct}%`;
    if (fillEl) fillEl.style.width = `${weekPct}%`;
    if (subtextEl) subtextEl.textContent = `Active ${data.days_active} of last 7 days · ${data.completed_today} habits done today`;

    // Restore today's checkbox state from DB
    if (data.today_state && Object.keys(data.today_state).length > 0) {
      document.querySelectorAll('.hs-item').forEach(el => {
        const nameEl = el.querySelector('.hs-name');
        if (!nameEl) return;
        const name = nameEl.textContent.trim();
        const checkbox = el.querySelector('.hs-checkbox');
        if (name in data.today_state) {
          if (data.today_state[name]) {
            el.classList.add('completed');
            if (checkbox) checkbox.checked = true;
          } else {
            el.classList.remove('completed');
            if (checkbox) checkbox.checked = false;
          }
        }
      });
      updateHabitScoreProgress();
    }
  } catch (e) {}
}
