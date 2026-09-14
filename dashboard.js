// ── API base URL ─────────────────────────────────────────────
// localhost → local backend | Vercel production → same domain (empty = relative URLs)
const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'http://localhost:8000' : '';

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
if (!token || !user || !user.id) {
    window.location.href = 'login.html';
}

// ── Auth helper + global 401/403 handler ─────────────────────
function authHeaders(extra) {
    return Object.assign({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, extra || {});
}

// ── Handle 401 globally — disabled/expired account ───────────
async function apiFetch(url, options) {
    const res = await fetch(url, options);
    if (res.status === 401 || res.status === 403) {
        // Token invalid or account disabled — sign out immediately
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = 'login.html';
    }
    return res;
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

  // ── RBAC: only allow the user's own panel ────────────────
  const allowedPanel = getUserAllowedPanel();
  if (targetPanelId !== allowedPanel) return;
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

    // ── RBAC: hide role tabs the logged-in user cannot access ────
    const allowedP = getUserAllowedPanel();
    document.querySelectorAll('.role-tab').forEach(tab => {
      const tabTarget = tab.getAttribute('data-target');
      if (tabTarget !== allowedP) {
        tab.style.display = 'none';
        tab.setAttribute('aria-hidden', 'true');
        tab.setAttribute('tabindex', '-1');
      }
    });
    // If only one tab remains visible, hide the entire nav to keep UI clean
    const visibleTabs = Array.from(document.querySelectorAll('.role-tab')).filter(t => t.style.display !== 'none');
    if (visibleTabs.length <= 1) {
      const roleNav = document.querySelector('.role-selector-panel');
      if (roleNav) roleNav.style.display = 'none';
    }
  }

  // ── Notification permission + polling ────────────────────────
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
  setTimeout(loadNotifications, 1500);
  notifPollTimer = setInterval(loadNotifications, 90000);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#notifBellWrap')) closeNotifPanel();
  });

  // ── Load all dashboard cards for the logged-in user ─────────
  if (typeof loadCognitivePerformance  === 'function') loadCognitivePerformance();
  if (typeof loadBehavioralAnalytics   === 'function') loadBehavioralAnalytics();
  if (typeof loadHabitState            === 'function') loadHabitState();       // loads habit adherence from DB
  if (typeof loadAchievements          === 'function') loadAchievements();
  if (typeof loadCognitiveTrends       === 'function') loadCognitiveTrends();
  if (typeof loadAllScores             === 'function') loadAllScores();
  if (typeof loadRecommendations       === 'function') loadRecommendations();
  if (typeof renderMyAlarms            === 'function') renderMyAlarms();
  if (typeof startAlarmPolling         === 'function') startAlarmPolling();
  if (typeof loadUserSessions          === 'function') loadUserSessions();

  // ── Load alarms from database on page load ───────────────────
  if (user && user.id && user.id > 0) {
    apiFetch(`${API_BASE}/alarms/${user.id}`, { headers: authHeaders({}) })
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

      // ── RBAC: block cross-role tab clicks ─────────────────────
      if (targetPanelId !== getUserAllowedPanel()) return;

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
      // RBAC: only click if it matches the allowed panel
      if (targetTab.getAttribute('data-target') === getUserAllowedPanel()) targetTab.click();
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
        const res = await fetch(`${API_BASE}/alarms`, {
          method: 'POST',
          headers: authHeaders(),
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
          user_id: user ? parseInt(user.id) : null,
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
    const res = await fetch(`${API_BASE}/alarms/${alarmId}`, {
      method: 'PUT',
      headers: authHeaders(),
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
    const res  = await fetch(`${API_BASE}/alarms/${alarmId}/toggle`, { method: 'PATCH', headers: authHeaders({}) });
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
    const res = await fetch(`${API_BASE}/alarms/${alarmId}`, { method: 'DELETE', headers: authHeaders({}) });
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
  ['user','coach','admin'].forEach(r => {
    const nav = document.getElementById(`sidebar-${r}`);
    if (nav) nav.style.display = r === role ? 'flex' : 'none';
  });
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
    // User panel: show normal cards, hide sub-cards
    if (role === 'user') {
      if (grid) grid.querySelectorAll('.dashboard-card:not(.sub-card)').forEach(c => c.style.display = '');
      allSubCards.forEach(c => { c.classList.remove('sub-visible'); c.style.display = 'none'; });
    } else {
      // Coach/Admin: show ALL their sub-cards (the whole dashboard overview)
      allSubCards.forEach(c => {
        c.style.display = 'flex';
        // Only reset gridColumn if it was forced to 1/-1 previously
        // Half-cards keep their CSS class span (span 3), full-width keep span 6
        if (!c.classList.contains('coach-half-card') && !c.classList.contains('admin-half-card')) {
          c.style.gridColumn = '';
        } else {
          c.style.gridColumn = ''; // let CSS class handle it
        }
        c.classList.add('sub-visible');
      });
      // Trigger data load for the role
      if (role === 'coach' && typeof loadCoachDashboard === 'function') loadCoachDashboard();
      if (role === 'admin' && typeof loadAdminDashboard === 'function') loadAdminDashboard();
    }
  } else {
    // Hide all non-sub-cards (user panel)
    if (grid) grid.querySelectorAll('.dashboard-card:not(.sub-card)').forEach(c => c.style.display = 'none');
    // Hide all sub-cards first
    allSubCards.forEach(c => { c.classList.remove('sub-visible'); c.style.display = 'none'; });
    // Show only the matching sub-card
    const target = panel.querySelector(`.sub-card[data-sub="${sub}"]`);
    if (target) {
      target.style.display = 'flex';
      target.classList.add('sub-visible');
      target.style.gridColumn = '1 / -1';
    }
    // Data loaders per sub-section
    if (sub === 'scoring'         && typeof loadAllScores        === 'function') loadAllScores();
    if (sub === 'recommendations' && typeof loadRecommendations  === 'function') loadRecommendations();
    if (sub === 'reports'         && typeof loadReports          === 'function') loadReports();
    if (sub === 'sessions'        && typeof loadUserSessions     === 'function') loadUserSessions();
    if (sub === 'clients'         && typeof loadCoachProgress    === 'function') loadCoachProgress();
    if (sub === 'habits'          && typeof loadCoachHabits      === 'function') loadCoachHabits();
    if (sub === 'sleep'           && typeof loadCoachSleep       === 'function') loadCoachSleep();
    if (sub === 'directory'       && typeof loadCoachDirectory   === 'function') loadCoachDirectory();
    if (sub === 'analytics'       && typeof loadAdminAnalytics   === 'function') loadAdminAnalytics();
    if (sub === 'users'           && typeof loadAdminUsers       === 'function') loadAdminUsers();
    if (sub === 'reports'         && typeof loadAdminReports     === 'function') loadAdminReports();
    if (sub === 'recommendations' && role === 'admin' && typeof loadAdminRecLog === 'function') loadAdminRecLog();
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
    const res = await fetch(`${API_BASE}/challenges/history?user_id=${userId}`, { headers: authHeaders({}) });
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
    fetch(`${API_BASE}/alarms/${id}/toggle`, { method: 'PATCH', headers: authHeaders({}) }).catch(() => {});
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
    const res = await fetch(`${API_BASE}/challenges/personalized/${userId}?type=${type}`, { headers: authHeaders({}) });
    if (!res.ok) throw new Error('API Error');
    cmCurrentChallenge = await res.json();
  } catch (e) {
    try {
      const res = await fetch(`${API_BASE}/challenges/generate?type=${type}&difficulty=${diff}`, { headers: authHeaders({}) });
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
    const res = await fetch(`${API_BASE}/challenges/verify`, {
      method: 'POST',
      headers: authHeaders(),
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
  // Refresh notifications after challenge completion
  setTimeout(() => {
    if (typeof loadNotifications === 'function') loadNotifications();
  }, 1000);
}

function deleteMyAlarmCard(id) {
  if (!confirm('Are you sure you want to delete this alarm?')) return;
  myAlarmsList = myAlarmsList.filter(a => a.id !== id);
  fetch(`${API_BASE}/alarms/${id}`, { method: 'DELETE', headers: authHeaders({}) }).catch(() => {});
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

  fetch(`${API_BASE}/alarms/${id}`, {
    method: 'PUT',
    headers: authHeaders(),
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
    const res = await apiFetch(`${API_BASE}/challenges/performance/${userId}`, { headers: authHeaders({}) });
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
    loadAllScores();
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
    const res = await fetch(`${API_BASE}/analytics/behavioral/${userId}`, { headers: authHeaders({}) });
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
    const res = await fetch(`${API_BASE}/achievements/${userId}`, { headers: authHeaders({}) });
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
    const res = await fetch(`${API_BASE}/challenges/trends/${userId}`, { headers: authHeaders({}) });
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
    const res = await fetch(`${API_BASE}/challenges/generate?type=${type}&difficulty=${diff}`, { headers: authHeaders({}) });
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
    const res = await fetch(`${API_BASE}/challenges/verify`, {
      method: 'POST',
      headers: authHeaders(),
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
        fetch(`${API_BASE}/alarms/${currentActiveAlarm.id}/snooze`, {
          method: 'PATCH',
          headers: authHeaders(),
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
    const res = await fetch(`${API_BASE}/challenges/wakefulness`, {
      method: 'POST',
      headers: authHeaders(),
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
    fetch(`${API_BASE}/alarms/${currentActiveAlarm.id}/snooze`, {
      method: 'PATCH',
      headers: authHeaders(),
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

  // Log dismiss to alarm_logs
  const userId = (user && user.id) ? parseInt(user.id) : 1;
  const alarmId = currentActiveAlarm ? currentActiveAlarm.id : null;
  const delaySec = currentActiveAlarm
    ? Math.round((Date.now() - (activeAlarmStartTime || Date.now())) / 1000)
    : 0;

  fetch(`${API_BASE}/alarm-logs/dismiss`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      user_id:       userId,
      alarm_id:      alarmId,
      puzzle_solved: activeAlarmCurrentCorrect >= activeAlarmRequiredQuestions,
      delay_seconds: delaySec
    })
  }).catch(() => {});

  const overlay = document.getElementById('alarmTriggerModalOverlay');
  if (overlay) overlay.classList.remove('open');
  loadMyAlarms();
  setTimeout(() => loadCognitivePerformance(), 800);
}

// ── Alarm Polling Loop ────
let cachedAlarms = [];

function startAlarmPolling() {
  const userId = (user && user.id) ? parseInt(user.id) : 1;

  const fetchLatestAlarms = () => {
    fetch(`${API_BASE}/alarms/${userId}`, { headers: authHeaders({}) })
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

  // Alarm polling and habit state are already started by the main DOMContentLoaded block above.
  // This block wires day-chip toggles for the alarm creator.


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

  fetch(`${API_BASE}/habits/log`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ user_id: userId, habit_name: habitName, completed: nowCompleted })
  })
  .then(r => r.json())
  .then(() => {
    loadHabitAdherence();
    // Refresh notifications after habit change (debounced 2s)
    clearTimeout(window._habitNotifTimer);
    window._habitNotifTimer = setTimeout(() => {
      if (typeof loadNotifications === 'function') loadNotifications();
    }, 2000);
  })
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
    const res = await apiFetch(`${API_BASE}/habits/${userId}`, { headers: authHeaders({}) });
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


// ════════════════════════════════════════════════════════════
//  SCORING DASHBOARD — Challenge · Productivity · Sleep
// ════════════════════════════════════════════════════════════

const SCORE_CIRCUMFERENCE = 201.06; // 2 * π * 32

function animateScoreRing(ringId, score) {
  const ring = document.getElementById(ringId);
  if (!ring) return;
  const filled = Math.max(0, Math.min(100, score)) / 100 * SCORE_CIRCUMFERENCE;
  // Start from 0 and animate to filled via CSS transition
  ring.style.transition = 'none';
  ring.setAttribute('stroke-dasharray', `0 ${SCORE_CIRCUMFERENCE}`);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      ring.style.transition = 'stroke-dasharray 1s cubic-bezier(0.4,0,0.2,1)';
      ring.setAttribute('stroke-dasharray', `${filled.toFixed(2)} ${SCORE_CIRCUMFERENCE}`);
    });
  });
}

function setScoreGradeBadge(badgeId, grade) {
  const el = document.getElementById(badgeId);
  if (!el) return;
  el.textContent = `Grade ${grade}`;
  const colorMap = {
    S: { bg: '#fef9c3', color: '#b45309' },
    A: { bg: '#dcfce7', color: '#15803d' },
    B: { bg: '#dbeafe', color: '#1d4ed8' },
    C: { bg: '#fef3c7', color: '#d97706' },
    D: { bg: '#fee2e2', color: '#b91c1c' },
  };
  const c = colorMap[grade] || colorMap['C'];
  el.style.background = c.bg;
  el.style.color = c.color;
}

async function loadChallengeScore(userId) {
  try {
    const res = await fetch(`${API_BASE}/scoring/challenge/${userId}`, { headers: authHeaders({}) });
    if (!res.ok) return;
    const data = await res.json();

    const score = data.score ?? 0;
    const numEl = document.getElementById('score-challenge-val');
    if (numEl) numEl.textContent = score;
    animateScoreRing('score-ring-challenge', score);
    setScoreGradeBadge('score-challenge-grade', data.grade || 'D');

    const setEl = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    setEl('sc-accuracy',  `${data.success_rate ?? 0}%`);
    setEl('sc-points',    `${data.total_points ?? 0} pts`);
    setEl('sc-speed',     `${data.avg_speed ?? 0}s`);
    setEl('sc-attempts',  `${data.total_attempts ?? 0}`);

    return data;
  } catch (e) {
    console.warn('Challenge score load error:', e);
  }
}

async function loadProductivityScore(userId) {
  try {
    const res = await fetch(`${API_BASE}/scoring/productivity/${userId}`, { headers: authHeaders({}) });
    if (!res.ok) return;
    const data = await res.json();

    const score = data.productivity_score ?? 0;
    const numEl = document.getElementById('score-productivity-val');
    if (numEl) numEl.textContent = score;
    animateScoreRing('score-ring-productivity', score);
    setScoreGradeBadge('score-productivity-grade', data.grade || 'D');

    // Weighted bars
    const challengePct = Math.min(100, data.challenge_component ?? 0);
    const habitPct     = Math.min(100, data.habit_component ?? 0);
    const sleepPct     = Math.min(100, data.sleep_component ?? 0);

    const setCBar = (barId, labelId, val) => {
      const bar = document.getElementById(barId);
      const lbl = document.getElementById(labelId);
      if (bar) bar.style.width = `${val}%`;
      if (lbl) lbl.textContent = `${val.toFixed(1)}%`;
    };
    setCBar('sp-challenge-bar', 'sp-challenge-pct', challengePct);
    setCBar('sp-habit-bar',     'sp-habit-pct',     habitPct);
    setCBar('sp-sleep-bar',     'sp-sleep-pct',     sleepPct);

    return data;
  } catch (e) {
    console.warn('Productivity score load error:', e);
  }
}

// ── Habit Score (Weighted Scoring Model) ─────────────────────
async function loadHabitScore(userId) {
  try {
    const res = await fetch(`${API_BASE}/scoring/habit/${userId}`, { headers: authHeaders({}) });
    if (!res.ok) return;
    const data = await res.json();

    const score = data.habit_score ?? 0;
    const numEl = document.getElementById('score-habit-val');
    if (numEl) numEl.textContent = score;
    animateScoreRing('score-ring-habit', score);
    setScoreGradeBadge('score-habit-grade', data.grade || 'D');

    // Four weighted component bars
    const setHBar = (barId, labelId, val) => {
      const bar = document.getElementById(barId);
      const lbl = document.getElementById(labelId);
      if (bar) bar.style.width = `${Math.min(100, val)}%`;
      if (lbl) lbl.textContent = `${val.toFixed(1)}%`;
    };
    setHBar('sh-wakeup-bar',    'sh-wakeup-pct',    data.wakeup_consistency_score  ?? 0);
    setHBar('sh-challenge-bar', 'sh-challenge-pct', data.challenge_success_score   ?? 0);
    setHBar('sh-snooze-bar',    'sh-snooze-pct',    data.snooze_reduction_score    ?? 0);
    setHBar('sh-adherence-bar', 'sh-adherence-pct', data.sleep_adherence_score     ?? 0);

    return data;
  } catch (e) {
    console.warn('Habit score load error:', e);
  }
}

async function loadSleepScore(userId) {
  try {
    const res = await fetch(`${API_BASE}/scoring/sleep/${userId}`, { headers: authHeaders({}) });
    if (!res.ok) return;
    const data = await res.json();

    const score = data.score ?? 0;
    const numEl = document.getElementById('score-sleep-val');
    if (numEl) numEl.textContent = score;
    animateScoreRing('score-ring-sleep', score);
    setScoreGradeBadge('score-sleep-grade', data.grade || 'D');

    const setEl = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    setEl('ss-ontime',  `${data.on_time_pct ?? 0}%`);
    setEl('ss-puzzle',  `${data.puzzle_solved_pct ?? 0}%`);
    setEl('ss-delay',   data.avg_delay_seconds != null ? `${data.avg_delay_seconds}s` : '—');
    setEl('ss-total',   `${data.total_alarms ?? 0}`);

    return data;
  } catch (e) {
    console.warn('Sleep score load error:', e);
  }
}

async function loadAllScores() {
  const userId = (user && user.id) ? parseInt(user.id) : 1;

  const [cData, pData, sData, hData] = await Promise.all([
    loadChallengeScore(userId),
    loadProductivityScore(userId),
    loadSleepScore(userId),
    loadHabitScore(userId),
  ]);

  // Update summary bar
  const labelEl = document.getElementById('score-overall-label');
  const gradeEl = document.getElementById('score-overall-grade-tag');

  if (pData) {
    const grade = pData.grade || 'C';
    const score = pData.productivity_score ?? 0;
    if (labelEl) labelEl.textContent = `Overall Productivity: ${score}/100 — ${pData.label || ''}`;
    if (gradeEl) {
      gradeEl.textContent = `Grade ${grade}`;
      const colorMap = {
        S: '#b45309', A: '#15803d', B: '#1d4ed8', C: '#d97706', D: '#b91c1c'
      };
      gradeEl.style.color = colorMap[grade] || '#64748b';
    }
  } else {
    if (labelEl) labelEl.textContent = 'Complete alarm challenges to generate your scores.';
  }
}

// Auto-load scores on page load — called via loadCognitivePerformance on DOMContentLoaded


// ════════════════════════════════════════════════════════════
//  RECOMMENDATION ENGINE
//  Loads /recommendations/{user_id} and renders 5 pillars
// ════════════════════════════════════════════════════════════

async function loadRecommendations() {
  const userId = (user && user.id) ? parseInt(user.id) : 1;

  const loadingEl  = document.getElementById('rec-loading');
  const pillarsEl  = document.getElementById('rec-pillars-grid');
  const footerEl   = document.getElementById('rec-footer');
  const genAtEl    = document.getElementById('rec-generated-at');
  const chipEl     = document.getElementById('rec-high-count-chip');

  // Show loading state
  if (loadingEl)  { loadingEl.style.display  = 'block'; }
  if (pillarsEl)  { pillarsEl.style.display  = 'none';  }
  if (footerEl)   { footerEl.style.display   = 'none';  }

  let data = null;

  try {
    const res = await fetch(`${API_BASE}/recommendations/${userId}`, { headers: authHeaders({}) });
    if (res.ok) data = await res.json();
  } catch (e) {
    console.warn('Recommendations endpoint unreachable:', e);
  }

  // ── Offline / empty fallback ─────────────────────────────
  if (!data) {
    data = {
      generated_at: new Date().toISOString(),
      high_priority_count: 0,
      recommendations: [
        {
          pillar: "Sleep Improvement",
          pillar_icon: "🌙",
          items: [{
            title: "Set Your First Alarm",
            body: "Set an alarm with a cognitive challenge to start tracking your sleep routine and build your wake-up score.",
            icon: "🌙", priority: "🟡 Suggested", action: "Set Alarm"
          }]
        },
        {
          pillar: "Wake-up Optimisation",
          pillar_icon: "⏱️",
          items: [{
            title: "Track Your Wake-up Pattern",
            body: "Dismiss your first few alarms so the system can detect your wake-up consistency and recommend the ideal window.",
            icon: "🌅", priority: "🟡 Suggested", action: "Dismiss First Alarm"
          }]
        },
        {
          pillar: "Habit Improvement",
          pillar_icon: "📋",
          items: [{
            title: "Log Your First Habit",
            body: "Start tracking daily habits — even one logged habit per day builds the consistency data needed to generate personalised guidance.",
            icon: "📋", priority: "🟡 Suggested", action: "Log a Habit"
          }]
        },
        {
          pillar: "Productivity",
          pillar_icon: "🚀",
          items: [{
            title: "Complete Your First Challenge",
            body: "Solve an alarm challenge to activate your productivity score. Even one session generates your first baseline data point.",
            icon: "🚀", priority: "🟡 Suggested", action: "Start Challenge"
          }]
        },
        {
          pillar: "Personalised Challenge",
          pillar_icon: "🧠",
          items: [{
            title: "Try a Math Warm-up",
            body: "Math Problems are the best starting point — they activate prefrontal cortex engagement fastest after waking. Start with Beginner difficulty.",
            icon: "🧩", priority: "🟡 Suggested", action: "Start Math Challenge"
          }]
        }
      ]
    };
  }

  // ── Render pillars ────────────────────────────────────────
  if (!pillarsEl) return;

  const pillars = data.recommendations || [];

  // Priority badge CSS class helper
  function priorityClass(p) {
    if (p.includes('High'))      return 'rec-badge-high';
    if (p.includes('Keep'))      return 'rec-badge-low';
    return 'rec-badge-medium';
  }

  // Map action labels → JS calls
  function actionHandler(action) {
    const a = (action || '').toLowerCase();

    // ── Alarm actions ─────────────────────────────────────
    if (a.includes('set alarm') || a.includes('adjust alarm') || a.includes('advance alarm') ||
        a.includes('maintain schedule') || a.includes('consistent time') ||
        a.includes('reduce snooze') || a.includes('enable bedtime')) {
      return `onclick="openAlarmModal()"`;
    }

    // ── My Alarms navigation ──────────────────────────────
    if (a.includes('dismiss') || a.includes('my alarm')) {
      return `onclick="(function(){ var b=document.querySelector('#sidebar-user .sidebar-item:nth-child(2)'); showSubSection('user','my-alarms',b); })()"`;
    }

    // ── Habit actions ─────────────────────────────────────
    if (a.includes('log a habit') || a.includes('log habit') || a.includes('review habit') ||
        a.includes('add new habit') || a.includes('prep night') || a.includes('create habit') ||
        a.includes('habit stack') || a.includes('keep going') || a.includes('hydrate')) {
      return `onclick="recActionLogHabit()"`;
    }

    // ── Math warm-up ──────────────────────────────────────
    if (a.includes('start math') || a.includes('math warm') || a.includes('math challenge')) {
      return `onclick="openChallengeModal('math','beginner','Math Warm-up')"`;
    }

    // ── Generic challenge start ───────────────────────────
    if (a.includes('start challenge') || a.includes('complete') || a.includes('switch challenge') ||
        a.includes('level up') || a.includes('reduce difficulty') || a.includes('use as warm')) {
      return `onclick="openChallengeModal('math','medium','Practice Challenge')"`;
    }

    // ── Practice specific type: "Practice Word Games" etc ─
    const practiceMatch = a.match(/practice (math|logic|memory|word|pattern|riddle|quiz)/);
    if (practiceMatch) {
      return `onclick="openChallengeModal('${practiceMatch[1]}','medium','${action}')"`;
    }

    // ── Try difficulty: "Try Medium" etc ──────────────────
    const tryDiffMatch = a.match(/try (beginner|easy|medium|hard|expert)/);
    if (tryDiffMatch) {
      return `onclick="openChallengeModal('math','${tryDiffMatch[1]}','${action}')"`;
    }

    // ── Default fallback ──────────────────────────────────
    return `onclick="openChallengeModal('math','medium','Challenge')"`;
  }

  // Build pillar HTML — CSS nth-child handles spanning (no JS class needed)
  pillarsEl.innerHTML = pillars.map((pillar) => {
    const itemsHTML = (pillar.items || []).map(item => `
      <div class="rec-item">
        <div class="rec-item-top">
          <span class="rec-item-icon">${item.icon || '💡'}</span>
          <span class="rec-item-title">${item.title}</span>
          <span class="rec-priority-badge ${priorityClass(item.priority || '')}">${item.priority || '🟡 Suggested'}</span>
        </div>
        <p class="rec-item-body">${item.body}</p>
        <button class="rec-item-action" type="button" ${actionHandler(item.action)}>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"
            stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
          ${item.action || 'View'}
        </button>
      </div>
    `).join('');

    return `
      <div class="rec-pillar-card">
        <div class="rec-pillar-head">
          <span class="rec-pillar-emoji">${pillar.pillar_icon || '💡'}</span>
          <span class="rec-pillar-name">${pillar.pillar}</span>
        </div>
        ${itemsHTML}
      </div>
    `;
  }).join('');

  // ── High priority chip ────────────────────────────────────
  const highCount = data.high_priority_count || 0;
  if (chipEl) {
    if (highCount > 0) {
      chipEl.textContent = `🔴 ${highCount} High Priority`;
      chipEl.style.display = 'inline-flex';
    } else {
      chipEl.style.display = 'none';
    }
  }

  // ── Footer timestamp ──────────────────────────────────────
  if (genAtEl && data.generated_at) {
    const dt = new Date(data.generated_at);
    genAtEl.textContent = `Generated ${dt.toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric'
    })} at ${dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  }

  // ── Show content ──────────────────────────────────────────
  if (loadingEl) loadingEl.style.display  = 'none';
  if (pillarsEl) pillarsEl.style.display  = 'grid';
  if (footerEl)  footerEl.style.display   = 'flex';
}

// ── Recommendation action: Log a Habit ───────────────────────
// Navigates to Dashboard overview → scrolls to Habit Score card → highlights it
function recActionLogHabit() {
  // Switch to user panel overview
  const userRole = (user && user.role === 'admin') ? 'admin'
                 : (user && user.role === 'wellness_coach') ? 'coach'
                 : 'user';

  // Navigate to overview sub-section
  const overviewBtn = document.querySelector('#sidebar-user .sidebar-item:first-child');
  showSubSection('user', 'overview', overviewBtn);

  // Small delay to let the panel switch, then scroll to Habit Score card
  setTimeout(() => {
    const habitCard = document.querySelector('.hs-card-container');
    if (habitCard) {
      habitCard.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Flash highlight
      habitCard.style.transition = 'box-shadow 0.3s ease, transform 0.3s ease';
      habitCard.style.boxShadow = '0 0 0 3px #2563eb, 0 8px 32px rgba(37,99,235,0.25)';
      habitCard.style.transform = 'translateY(-3px)';

      setTimeout(() => {
        habitCard.style.boxShadow = '';
        habitCard.style.transform = '';
      }, 2000);
    }
  }, 350);
}
 


// ════════════════════════════════════════════════════════════
//  WELLNESS COACH DASHBOARD — data loaders
// ════════════════════════════════════════════════════════════

async function loadCoachDashboard() {
  await Promise.all([
    loadCoachBehaviorInsights(),
    loadCoachHabits(),
    loadCoachSleep(),
    loadCoachProgress(),
    loadCoachDirectory(),
  ]);
}

async function loadCoachBehaviorInsights() {
  try {
    const res  = await fetch(`${API_BASE}/coach/behavior-insights`, { headers: authHeaders({}) });
    if (!res.ok) throw new Error();
    const data = await res.json();

    const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setEl('coach-sleep-quality',   data.avg_sleep_quality   != null ? data.avg_sleep_quality + '%'   : '—');
    setEl('coach-avg-wake',        data.avg_wake_time        || '—');
    setEl('coach-habit-adh',       data.habit_adherence_rate != null ? data.habit_adherence_rate + '%' : '—');
    setEl('coach-avg-puzzle',      data.avg_puzzle_time_s    != null ? data.avg_puzzle_time_s + 's'  : '—');
    setEl('coach-total-challenges',data.total_challenges     ?? '—');
    setEl('coach-total-alarms',    data.total_alarm_events   ?? '—');
    setEl('coach-total-users-badge', data.total_active_users != null ? data.total_active_users + ' active users' : '—');
    // Coaching summary card
    setEl('coach-summary-users',      data.total_active_users ?? '—');
    setEl('coach-summary-challenges', data.total_challenges   ?? '—');
    setEl('coach-summary-alarms',     data.total_alarm_events ?? '—');
  } catch {
    // Backend offline — leave dashes
  }
}

async function loadCoachHabits() {
  const listEl = document.getElementById('coach-habit-list');
  if (!listEl) return;
  try {
    const res  = await fetch(`${API_BASE}/coach/habit-analytics`, { headers: authHeaders({}) });
    if (!res.ok) throw new Error();
    const data = await res.json();
    const habits = data.habits || [];

    if (!habits.length) {
      listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);">No habit data yet.</div>';
      return;
    }

    listEl.innerHTML = habits.map(h => {
      const color = h.pct >= 75 ? '#16a34a' : h.pct >= 50 ? '#d97706' : '#dc2626';
      return `
        <div class="habit-progress-row">
          <span class="habit-label">${h.name}</span>
          <div class="progress-bar-small">
            <div class="progress-fill" style="width:${h.pct}%;background:${color};"></div>
          </div>
          <span class="habit-percent" style="color:${color};">${h.pct}%</span>
        </div>`;
    }).join('');
  } catch {
    listEl.innerHTML = '<div style="text-align:center;padding:16px;color:var(--muted);">Could not load habit data.</div>';
  }
}

async function loadCoachSleep() {
  try {
    const res  = await fetch(`${API_BASE}/coach/sleep-trends`, { headers: authHeaders({}) });
    if (!res.ok) throw new Error();
    const data = await res.json();

    const labels  = data.labels  || [];
    const scores  = data.scores  || [];
    const summary = data.summary || '';

    // Update labels row
    const labelsEl = document.getElementById('coach-sleep-labels');
    if (labelsEl) labelsEl.innerHTML = labels.map(l => `<span>${l}</span>`).join('');

    // Draw SVG line chart  (220×80 viewBox)
    const W = 220, H = 78, PAD = 10;
    const n = scores.length;
    if (n < 2) return;

    const xStep = (W - PAD * 2) / (n - 1);
    const pts = scores.map((s, i) => {
      const x = PAD + i * xStep;
      const y = H - PAD - ((s || 0) / 100) * (H - PAD * 2);
      return { x, y };
    });

    const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    const areaPath = linePath + ` L ${pts[n-1].x.toFixed(1)} ${H} L ${pts[0].x.toFixed(1)} ${H} Z`;

    const lineEl = document.getElementById('coach-sleep-line');
    const areaEl = document.getElementById('coach-sleep-area');
    if (lineEl) lineEl.setAttribute('d', linePath);
    if (areaEl) areaEl.setAttribute('d', areaPath);

    // Summary text
    const filled   = scores.filter(s => s > 0);
    const avg      = filled.length ? Math.round(filled.reduce((a, b) => a + b, 0) / filled.length) : 0;
    const summaryEl = document.getElementById('coach-sleep-summary');
    if (summaryEl) summaryEl.innerHTML = `7-day avg on-time dismissal rate: <strong>${avg}%</strong>. ${summary}`;

  } catch {
    const summaryEl = document.getElementById('coach-sleep-summary');
    if (summaryEl) summaryEl.textContent = 'Sleep trend data unavailable.';
  }
}

async function loadCoachProgress() {
  const tbody = document.getElementById('coach-progress-tbody');
  const countEl = document.getElementById('coach-client-count');
  if (!tbody) return;

  try {
    const res  = await fetch(`${API_BASE}/coach/progress-monitoring`, { headers: authHeaders({}) });
    if (!res.ok) throw new Error();
    const data = await res.json();
    const users = data.users || [];

    if (countEl) countEl.textContent = `${users.length} client${users.length !== 1 ? 's' : ''}`;

    if (!users.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:24px;">No user data yet. Users need to log in and use the app.</td></tr>';
      return;
    }

    const statusBadge = (s) => {
      const map = {
        'Optimal':       'badge-success',
        'On Track':      'badge-success',
        'New':           'badge-warning',
        'Needs Support': 'badge-danger',
      };
      return `<span class="badge ${map[s] || 'badge-warning'}">${s}</span>`;
    };

    const habitColor = (p) => p >= 75 ? 'text-success' : p >= 50 ? 'text-warning' : 'text-danger';

    tbody.innerHTML = users.map(u => `
      <tr>
        <td><strong>${u.name}</strong><br><span style="font-size:0.75rem;color:var(--muted);">${u.email}</span></td>
        <td>${u.wakeup_goal}</td>
        <td>${u.avg_wakeup}</td>
        <td class="font-semibold ${habitColor(u.habit_pct)}">${u.habit_pct}%</td>
        <td class="font-semibold ${habitColor(u.acc_pct)}">${u.acc_pct}%</td>
        <td>${statusBadge(u.cog_status)}</td>
        <td style="color:var(--muted);font-size:0.82rem;">${u.last_active}</td>
      </tr>`).join('');

  } catch {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:24px;">Could not load client data. Make sure backend is running.</td></tr>';
  }
}


// ════════════════════════════════════════════════════════════
//  ADMIN DASHBOARD — data loaders
// ════════════════════════════════════════════════════════════

async function loadAdminDashboard() {
  await Promise.all([
    loadAdminAnalytics(),
    loadAdminUsers(),
    loadAdminReports(),
    loadAdminRecLog(),
  ]);
}

async function loadAdminAnalytics() {
  try {
    const res  = await fetch(`${API_BASE}/admin/platform-analytics`, { headers: authHeaders({}) });
    if (!res.ok) throw new Error();
    const data = await res.json();

    const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setEl('admin-total-users',    data.total_users    ?? '—');
    setEl('admin-active-alarms',  data.active_alarms  ?? '—');
    setEl('admin-new-users',      data.new_users_week != null ? '+' + data.new_users_week : '—');
    setEl('admin-success-rate',   data.challenge_success_rate != null ? data.challenge_success_rate + '%' : '—');
    setEl('admin-api-status',     'API Status: ' + (data.api_status || 'Online'));
    setEl('admin-total-challenges', (data.total_challenges ?? '—') + ' challenges logged');
    // Quick overview card (duplicate summary)
    setEl('admin-qs-users',   data.total_users    ?? '—');
    setEl('admin-qs-alarms',  data.active_alarms  ?? '—');
    setEl('admin-qs-success', data.challenge_success_rate != null ? data.challenge_success_rate + '%' : '—');
    setEl('admin-qs-new',     data.new_users_week != null ? '+' + data.new_users_week : '—');
  } catch {
    const el = document.getElementById('admin-api-status');
    if (el) { el.textContent = 'API Status: Offline'; el.style.color = '#dc2626'; }
  }
}

async function loadAdminUsers() {
  const tbody  = document.getElementById('admin-users-tbody');
  const countEl = document.getElementById('admin-user-count-tag');
  if (!tbody) return;

  try {
    const res  = await fetch(`${API_BASE}/admin/users`, { headers: authHeaders({}) });
    if (!res.ok) throw new Error();
    const users = await res.json();

    if (countEl) countEl.textContent = users.length + ' users';

    if (!users.length) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:24px;">No users registered yet.</td></tr>';
      return;
    }

    const roleClass = { user: 'role-user', wellness_coach: 'role-coach', admin: 'role-admin' };
    const roleLabel = { user: 'User', wellness_coach: 'Wellness Coach', admin: 'Admin' };

    tbody.innerHTML = users.map(u => `
      <tr id="admin-user-row-${u.id}">
        <td style="font-weight:700;color:var(--muted);font-size:0.8rem;">#${u.id}</td>
        <td><strong>${u.full_name}</strong></td>
        <td style="font-size:0.82rem;">${u.email}</td>
        <td><span class="badge-role ${roleClass[u.role] || 'role-user'}">${roleLabel[u.role] || u.role}</span></td>
        <td><span style="font-size:0.78rem;background:#f1f5f9;padding:2px 8px;border-radius:6px;color:var(--muted);">${u.provider}</span></td>
        <td>
          <span class="badge ${u.is_active ? 'badge-success' : 'badge-danger'}" id="admin-status-${u.id}">
            ${u.is_active ? 'Active' : 'Disabled'}
          </span>
        </td>
        <td style="font-size:0.82rem;color:var(--muted);">${u.created_at}</td>
        <td>
          <button class="btn-action ${u.is_active ? 'urgent' : ''}"
            onclick="adminToggleUser(${u.id}, this)"
            style="padding:5px 12px;font-size:0.78rem;${!u.is_active ? 'border-color:#2563eb;color:#2563eb;' : ''}">
            ${u.is_active ? 'Disable' : 'Enable'}
          </button>
        </td>
        <td>
          <button class="pn-table-btn" onclick="pnSelectUser(${u.id}, '${u.full_name.replace(/'/g,"\\'")}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" width="13" height="13">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
            Notify
          </button>
        </td>
      </tr>`).join('');

    // ── Populate recipient dropdown in the composer ───────────
    const sel = document.getElementById('pn-user-select');
    if (sel) {
      sel.innerHTML = '<option value="">— Select user —</option>' +
        users.map(u => `<option value="${u.id}">${u.full_name} (${u.email})</option>`).join('');
    }

  } catch {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:24px;">Could not load users. Make sure backend is running.</td></tr>';
  }
}

async function adminToggleUser(userId, btn) {
  // Guard: prevent admin from disabling their own account
  if (user && user.id === userId) {
    alert('You cannot disable your own account while logged in.');
    return;
  }

  const isCurrentlyActive = btn && btn.textContent.trim() === 'Disable';

  // Confirm before disabling
  if (isCurrentlyActive) {
    if (!confirm(`Disable this user's account? They will not be able to log in until re-enabled.`)) return;
  }

  // Loading state
  if (btn) {
    btn._origText = btn.textContent.trim();
    btn.textContent = '...';
    btn.disabled    = true;
    btn.style.opacity = '0.6';
  }

  try {
    const res  = await fetch(`${API_BASE}/admin/users/${userId}/toggle`, { method: 'PATCH', headers: authHeaders({}) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    // Update status badge
    const statusEl = document.getElementById(`admin-status-${userId}`);
    if (statusEl) {
      statusEl.textContent = data.is_active ? 'Active' : 'Disabled';
      statusEl.className   = `badge ${data.is_active ? 'badge-success' : 'badge-danger'}`;
    }

    // Update button
    if (btn) {
      btn.disabled      = false;
      btn.style.opacity = '';
      btn.textContent   = data.is_active ? 'Disable' : 'Enable';
      // Red border = Disable (urgent), Blue border = Enable
      if (data.is_active) {
        btn.className        = 'btn-action urgent';
        btn.style.padding    = '5px 12px';
        btn.style.fontSize   = '0.78rem';
      } else {
        btn.className        = 'btn-action';
        btn.style.padding    = '5px 12px';
        btn.style.fontSize   = '0.78rem';
        btn.style.borderColor = '#2563eb';
        btn.style.color       = '#2563eb';
      }
    }

    // Brief success flash
    const row = document.getElementById(`admin-user-row-${userId}`);
    if (row) {
      row.style.transition  = 'background 0.3s';
      row.style.background  = data.is_active ? '#f0fdf4' : '#fef2f2';
      setTimeout(() => { row.style.background = ''; }, 1200);
    }

  } catch (err) {
    console.error('Toggle user failed:', err);
    // Restore button
    if (btn) {
      btn.disabled      = false;
      btn.style.opacity = '';
      btn.textContent   = btn._origText || 'Action';
    }
    alert('Could not update user status. Make sure backend is running.');
  }
}

async function loadAdminReports() {
  const listEl   = document.getElementById('admin-reports-list');
  const genAtEl  = document.getElementById('sr-generated-at');
  const setSum   = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v ?? '—'; };

  if (!listEl) return;

  // Show skeletons while loading
  listEl.innerHTML = Array(4).fill('<div class="sr-tile sr-skeleton"></div>').join('');

  // Icon SVGs keyed by type
  const iconSvg = {
    db_health: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>`,
    challenge: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    habit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
    alarm_log: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  };

  // Colour theme per type
  const theme = {
    db_health: { bg: '#eff6ff', icon: '#2563eb', bar: '#2563eb' },
    challenge: { bg: '#f0fdf4', icon: '#16a34a', bar: '#16a34a' },
    habit:     { bg: '#fefce8', icon: '#ca8a04', bar: '#ca8a04' },
    alarm_log: { bg: '#fdf4ff', icon: '#9333ea', bar: '#9333ea' },
  };

  // Status badge colours
  const statusStyle = {
    healthy: { bg: '#dcfce7', color: '#15803d', label: '● Healthy' },
    good:    { bg: '#dcfce7', color: '#15803d', label: '● Good'    },
    warning: { bg: '#fef9c3', color: '#b45309', label: '⚠ Warning' },
    low:     { bg: '#fee2e2', color: '#b91c1c', label: '↓ Low'     },
    empty:   { bg: '#f1f5f9', color: '#64748b', label: '○ No Data' },
  };

  try {
    const res  = await fetch(`${API_BASE}/admin/system-reports`, { headers: authHeaders({}) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    // ── Summary strip ─────────────────────────────────────────
    const s = data.summary || {};
    setSum('sr-total-records', (s.total_records ?? 0).toLocaleString());
    setSum('sr-db-size',       (s.db_size_mb    ?? '—') + ' MB');
    setSum('sr-active-users',  s.active_users   ?? '—');
    setSum('sr-new-week',      s.new_users_week != null ? '+' + s.new_users_week : '—');
    if (genAtEl) genAtEl.textContent = 'Generated ' + (data.generated_at || '—');

    // ── Report tiles ──────────────────────────────────────────
    const reports = data.reports || [];
    listEl.innerHTML = reports.map(r => {
      const t   = theme[r.type]  || theme.db_health;
      const st  = statusStyle[r.status] || statusStyle.empty;
      const svg = iconSvg[r.type] || iconSvg.db_health;
      const pct = (r.rate != null) ? Math.min(100, r.rate) : null;

      return `
        <div class="sr-tile">
          <!-- Left: icon -->
          <div class="sr-tile-icon" style="background:${t.bg};color:${t.icon};">
            ${svg}
          </div>

          <!-- Middle: info -->
          <div class="sr-tile-body">
            <div class="sr-tile-top">
              <span class="sr-tile-title">${r.title}</span>
              <span class="sr-status-badge" style="background:${st.bg};color:${st.color};">${st.label}</span>
            </div>
            <div class="sr-tile-detail">${r.detail_a}</div>
            <div class="sr-tile-detail sr-muted">${r.detail_b}</div>
            ${pct !== null ? `
            <div class="sr-rate-bar-wrap">
              <div class="sr-rate-bar-track">
                <div class="sr-rate-bar-fill" style="width:${pct}%;background:${t.bar};"></div>
              </div>
              <span class="sr-rate-pct">${pct}%</span>
            </div>` : ''}
            <div class="sr-tile-meta">
              <span>${r.rows.toLocaleString()} rows · ${r.size}</span>
              <span class="sr-week-delta">${r.week_delta}</span>
            </div>
          </div>

          <!-- Right: download button -->
          <button class="sr-dl-btn" onclick="downloadAdminReport('${r.type}', this)" title="Download CSV">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
              stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            CSV
          </button>
        </div>`;
    }).join('');

  } catch (err) {
    listEl.innerHTML = `
      <div class="sr-error">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" width="28" height="28">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <p>Could not load system reports.</p>
        <span>Make sure the backend is running and you are logged in as admin.</span>
        <button class="sr-retry-btn" onclick="loadAdminReports()">Retry</button>
      </div>`;
    if (genAtEl) genAtEl.textContent = 'Failed to load';
    console.warn('loadAdminReports error:', err);
  }
}

async function loadAdminRecLog() {
  const logEl = document.getElementById('admin-rec-log');
  if (!logEl) return;

  try {
    const res  = await fetch(`${API_BASE}/admin/recommendation-log`, { headers: authHeaders({}) });
    if (!res.ok) throw new Error();
    const data = await res.json();
    const events = data.events || [];

    if (!events.length) {
      logEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);">No challenge events yet. Users need to complete challenges.</div>';
      return;
    }

    const typeIcon = { success: '✅', warning: '⚠️' };
    logEl.innerHTML = events.map(e => `
      <div class="rec-log-item">
        <span class="timestamp">${e.time}</span>
        <span class="log-text">${typeIcon[e.type] || '📌'} ${e.message}</span>
      </div>`).join('');

  } catch {
    logEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);">Could not load recommendation log.</div>';
  }
}


// ════════════════════════════════════════════════════════════
//  NOTIFICATION & REMINDER SYSTEM
//  6 types: bedtime · wakeup · habit · challenge · progress · announcement
// ════════════════════════════════════════════════════════════

let allNotifications  = [];   // full list from API
let shownNotifIds     = new Set(JSON.parse(sessionStorage.getItem('shownNotifs') || '[]'));
let notifPanelOpen    = false;
let notifCurrentFilter = 'all';
let notifPollTimer    = null;

// ── Boot handled in main DOMContentLoaded block above ────────


// ── Load from API ─────────────────────────────────────────────
async function loadNotifications() {
  const userId = (user && user.id) ? parseInt(user.id) : 1;
  try {
    // Fetch user-specific notifications + global admin announcements in parallel
    const [userRes, adminRes] = await Promise.allSettled([
      fetch(`${API_BASE}/notifications/${userId}`, { headers: authHeaders({}) }),
      fetch(`${API_BASE}/admin/announcements`, { headers: authHeaders({}) })
    ]);

    let data = { notifications: [], unread: 0, high_priority: 0, generated_at: new Date().toISOString() };

    if (userRes.status === 'fulfilled' && userRes.value.ok) {
      data = await userRes.value.json();
    } else {
      throw new Error('backend offline');
    }

    // Merge admin announcements (prepend, avoid duplicates)
    if (adminRes.status === 'fulfilled' && adminRes.value.ok) {
      const adminData = await adminRes.value.json();
      const adminNotifs = (adminData.announcements || []).filter(
        a => !data.notifications.some(n => n.id === a.id)
      );
      // Add to front if high priority, otherwise to back
      const highAdmin   = adminNotifs.filter(a => a.priority === 'high');
      const normalAdmin = adminNotifs.filter(a => a.priority !== 'high');
      data.notifications = [...highAdmin, ...data.notifications, ...normalAdmin];
      data.unread += adminNotifs.length;
      data.high_priority += highAdmin.length;
    }

    allNotifications = data.notifications || [];
    updateNotifBadge(data.unread || 0, data.high_priority || 0);
    renderNotifList(notifCurrentFilter);

    // Update footer timestamp
    const genEl = document.getElementById('notif-generated-at');
    if (genEl && data.generated_at) {
      const dt = new Date(data.generated_at);
      genEl.textContent = `Updated ${dt.toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'})}`;
    }
    // Update unread sub-label
    const subEl = document.getElementById('notif-unread-count');
    if (subEl) subEl.textContent = `${data.unread} unread · ${data.high_priority} high priority`;

    // Show toast for new HIGH priority items
    showNewNotifToasts(data.notifications || []);

  } catch {
    // Backend offline — show offline placeholder
    const subEl = document.getElementById('notif-unread-count');
    if (subEl) subEl.textContent = 'Backend offline';
    const listEl = document.getElementById('notif-list');
    if (listEl && !listEl.innerHTML.includes('notif-item')) {
      listEl.innerHTML = `<div class="notif-empty">
        <div style="font-size:2rem;margin-bottom:8px;">🔌</div>
        Start the backend to load your notifications.
      </div>`;
    }
  }
}

// ── Show toasts for new high-priority notifs ──────────────────
function showNewNotifToasts(notifs) {
  const highNew = notifs.filter(n => n.priority === 'high' && !shownNotifIds.has(n.id));
  // Show max 3 toasts at once
  highNew.slice(0, 3).forEach((n, idx) => {
    setTimeout(() => showToast(n), idx * 600);
    shownNotifIds.add(n.id);
  });
  sessionStorage.setItem('shownNotifs', JSON.stringify([...shownNotifIds]));
}

// ── Badge update ──────────────────────────────────────────────
function updateNotifBadge(unread, highCount) {
  const badge = document.getElementById('notifBadge');
  const btn   = document.getElementById('notifBellBtn');
  if (unread > 0) {
    if (badge) { badge.textContent = unread > 9 ? '9+' : unread; badge.style.display = 'flex'; }
    if (btn && highCount > 0) btn.classList.add('has-unread');
    else if (btn) btn.classList.remove('has-unread');
  } else {
    if (badge) badge.style.display = 'none';
    if (btn)   btn.classList.remove('has-unread');
  }
}

// ── Toggle panel ──────────────────────────────────────────────
function toggleNotifPanel() {
  const panel = document.getElementById('notifPanel');
  if (!panel) return;
  notifPanelOpen = !notifPanelOpen;
  panel.style.display = notifPanelOpen ? 'flex' : 'none';
  if (notifPanelOpen) loadNotifications();
}

function closeNotifPanel() {
  const panel = document.getElementById('notifPanel');
  if (panel) panel.style.display = 'none';
  notifPanelOpen = false;
}

// ── Filter tabs ───────────────────────────────────────────────
function filterNotif(type, btn) {
  notifCurrentFilter = type;
  document.querySelectorAll('.notif-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderNotifList(type);
}

// ── Render list ───────────────────────────────────────────────
function renderNotifList(filter) {
  const listEl = document.getElementById('notif-list');
  if (!listEl) return;

  const filtered = filter === 'all'
    ? allNotifications
    : allNotifications.filter(n => n.type === filter);

  if (!filtered.length) {
    listEl.innerHTML = `<div class="notif-empty">
      <div style="font-size:2rem;margin-bottom:8px;">${filter === 'all' ? '🔔' : '✅'}</div>
      ${filter === 'all' ? 'No notifications right now.' : `No ${filter} notifications.`}
    </div>`;
    return;
  }

  const iconBg = {
    bedtime:      'notif-icon-bedtime',
    wakeup:       'notif-icon-wakeup',
    habit:        'notif-icon-habit',
    challenge:    'notif-icon-challenge',
    progress:     'notif-icon-progress',
    announcement: 'notif-icon-announcement',
  };

  listEl.innerHTML = filtered.map(n => `
    <div class="notif-item ${n.read ? '' : 'unread'}"
      id="notif-item-${n.id}"
      onclick="handleNotifAction('${n.action || ''}','${n.action_label || ''}',${n.id})">
      <div class="notif-item-icon ${iconBg[n.type] || 'notif-icon-announcement'}">${n.icon}</div>
      <div class="notif-item-body">
        <div class="notif-item-title">${n.title}</div>
        <div class="notif-item-text">${n.body}</div>
        <div class="notif-item-meta">
          <span class="notif-item-time">${n.date} · ${n.timestamp}</span>
          <div style="display:flex;align-items:center;gap:6px;">
            <span class="notif-priority-dot ${n.priority}"></span>
            ${n.action ? `<button class="notif-action-btn" onclick="event.stopPropagation();handleNotifAction('${n.action}','${n.action_label}',${n.id})">${n.action_label}</button>` : ''}
          </div>
        </div>
      </div>
    </div>`).join('');
}

// ── Handle action clicks ──────────────────────────────────────
function handleNotifAction(action, label, notifId) {
  // Mark as read
  const item = document.getElementById(`notif-item-${notifId}`);
  if (item) item.classList.remove('unread');
  const notif = allNotifications.find(n => n.id === notifId);
  if (notif) notif.read = true;

  // Route action
  switch (action) {
    case 'set_alarm':
    case 'open_alarm':
      closeNotifPanel();
      openAlarmModal();
      break;
    case 'log_habit':
      closeNotifPanel();
      recActionLogHabit();
      break;
    case 'open_challenge':
      closeNotifPanel();
      openChallengeModal('math', 'medium', label || 'Cognitive Challenge');
      break;
    default:
      // Just mark read, no navigation
      break;
  }
  // Refresh badge count
  const unreadLeft = allNotifications.filter(n => !n.read).length;
  const highLeft   = allNotifications.filter(n => !n.read && n.priority === 'high').length;
  updateNotifBadge(unreadLeft, highLeft);
}

// ── Mark all read ─────────────────────────────────────────────
function markAllNotifRead() {
  allNotifications.forEach(n => { n.read = true; });
  updateNotifBadge(0, 0);
  renderNotifList(notifCurrentFilter);
  // Clear session shown set
  shownNotifIds.clear();
  sessionStorage.removeItem('shownNotifs');
}

// ── Toast system ──────────────────────────────────────────────
function showToast(notif) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${notif.priority || 'normal'}`;
  toast.innerHTML = `
    <div class="toast-icon">${notif.icon}</div>
    <div class="toast-content">
      <div class="toast-title">${notif.title}</div>
      <div class="toast-body">${notif.body.length > 90 ? notif.body.slice(0, 87) + '...' : notif.body}</div>
    </div>
    <button class="toast-close" onclick="dismissToast(this.closest('.toast'))">&times;</button>
  `;
  toast.onclick = (e) => {
    if (e.target.classList.contains('toast-close')) return;
    handleNotifAction(notif.action || '', notif.action_label || '', notif.id);
    dismissToast(toast);
  };
  container.appendChild(toast);
  // Auto-dismiss after 6 seconds
  setTimeout(() => dismissToast(toast), 6000);
  // Also send browser notification if permission granted
  sendBrowserNotif(notif);
}

function dismissToast(toast) {
  if (!toast || toast.classList.contains('removing')) return;
  toast.classList.add('removing');
  setTimeout(() => toast.remove(), 280);
}

// ── Browser (OS) notifications ────────────────────────────────
function sendBrowserNotif(notif) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    const n = new Notification(`Cognitive Alarm — ${notif.title}`, {
      body:    notif.body.length > 120 ? notif.body.slice(0,117)+'...' : notif.body,
      icon:    'favicon.ico',
      tag:     `cogalarm-${notif.id}`,
      silent:  notif.priority === 'low',
    });
    n.onclick = () => {
      window.focus();
      handleNotifAction(notif.action || '', notif.action_label || '', notif.id);
      n.close();
    };
    setTimeout(() => n.close(), 8000);
  } catch {/* silently fail */}
}

// ── Admin: Send Broadcast Announcement ───────────────────────
async function sendAdminAnnouncement() {
  const title    = document.getElementById('admin-announce-title')?.value.trim();
  const body     = document.getElementById('admin-announce-body')?.value.trim();
  const priority = document.getElementById('admin-announce-priority')?.value || 'normal';
  const icon     = document.getElementById('admin-announce-icon')?.value || '📢';
  const statusEl = document.getElementById('admin-announce-status');

  if (!title || !body) {
    if (statusEl) { statusEl.textContent = '⚠️ Please fill in both title and message.'; statusEl.style.color = '#b45309'; }
    return;
  }

  if (statusEl) { statusEl.textContent = 'Sending...'; statusEl.style.color = '#64748b'; }

  try {
    const res = await fetch(`${API_BASE}/admin/announcements`, {
      method:  'POST',
      headers: authHeaders(),
      body:    JSON.stringify({ title, body, priority, icon })
    });
    if (!res.ok) throw new Error();

    // Clear form
    const titleEl = document.getElementById('admin-announce-title');
    const bodyEl  = document.getElementById('admin-announce-body');
    if (titleEl) titleEl.value = '';
    if (bodyEl)  bodyEl.value  = '';

    if (statusEl) { statusEl.textContent = '✅ Announcement sent to all users!'; statusEl.style.color = '#16a34a'; }

    // Refresh notification bell to show the new announcement
    setTimeout(() => {
      loadNotifications();
      if (statusEl) statusEl.textContent = '';
    }, 2500);

  } catch {
    if (statusEl) { statusEl.textContent = '❌ Failed — make sure backend is running.'; statusEl.style.color = '#dc2626'; }
  }
}


// ════════════════════════════════════════════════════════════
//  REPORTS & EXPORT SYSTEM
// ════════════════════════════════════════════════════════════

async function loadReports() {
  const userId   = (user && user.id) ? parseInt(user.id) : 1;
  const loadEl   = document.getElementById('reports-loading');
  const gridEl   = document.getElementById('reports-grid');
  const footerEl = document.getElementById('reports-footer');
  const genAtEl  = document.getElementById('reports-generated-at');

  if (loadEl)  loadEl.style.display  = 'block';
  if (gridEl)  gridEl.style.display  = 'none';
  if (footerEl) footerEl.style.removeProperty('display');

  try {
    const res = await fetch(`${API_BASE}/reports/summary/${userId}`, { headers: authHeaders({}) });
    if (!res.ok) throw new Error('Backend error ' + res.status);
    const d = await res.json();

    // ── Habit Report ─────────────────────────────────────────
    setEl('rpt-habit-pct',   `${d.habit_report.completion_pct}%`);
    setEl('rpt-habit-done',  d.habit_report.done_this_week);
    setEl('rpt-habit-total', d.habit_report.total_logged);
    setEl('rpt-habit-trend', d.habit_report.trend);
    setBar('rpt-habit-bar',  d.habit_report.completion_pct);

    // ── Wake-up Report ────────────────────────────────────────
    setEl('rpt-wake-time',        d.wakeup_report.avg_wake_time);
    setEl('rpt-wake-ontime',      `${d.wakeup_report.on_time_count} (${d.wakeup_report.on_time_pct}%)`);
    setEl('rpt-wake-snoozed',     d.wakeup_report.snoozed_count);
    setEl('rpt-wake-consistency', d.wakeup_report.consistency);
    setBar('rpt-wake-bar',        d.wakeup_report.on_time_pct);

    // ── Challenge Report ──────────────────────────────────────
    setEl('rpt-ch-acc',   `${d.challenge_report.accuracy_pct}%`);
    setEl('rpt-ch-total', d.challenge_report.total_attempts);
    setEl('rpt-ch-score', `${d.challenge_report.total_score} pts`);
    setEl('rpt-ch-time',  `${d.challenge_report.avg_solve_time}s`);
    setEl('rpt-ch-level', d.challenge_report.recommended_level);
    setBar('rpt-ch-bar',  d.challenge_report.accuracy_pct);
    // Type breakdown mini bars
    const bdEl = document.getElementById('rpt-ch-breakdown');
    if (bdEl && d.challenge_report.type_breakdown) {
      bdEl.innerHTML = d.challenge_report.type_breakdown.slice(0, 4).map(t => `
        <div class="rpt-type-row">
          <span class="rpt-type-label">${t.type}</span>
          <div class="rpt-type-track"><div class="rpt-type-fill" style="width:${t.accuracy}%;"></div></div>
          <span class="rpt-type-pct">${t.accuracy}%</span>
        </div>`).join('');
    }

    // ── Productivity Report ───────────────────────────────────
    setEl('rpt-prod-score', d.productivity_report.score);
    setEl('rpt-prod-grade', `Grade ${d.productivity_report.grade}`);
    setEl('rpt-prod-ch',    `${d.productivity_report.challenge_component}%`);
    setEl('rpt-prod-h',     `${d.productivity_report.habit_component}%`);
    setEl('rpt-prod-sl',    `${d.productivity_report.sleep_component}%`);
    setEl('rpt-prod-insight', d.productivity_report.insights);
    setBar('rpt-prod-bar',  d.productivity_report.score);
    // Grade badge colour
    const gradeEl = document.getElementById('rpt-prod-grade');
    if (gradeEl) {
      const gc = {S:'#b45309',A:'#15803d',B:'#1d4ed8',C:'#d97706',D:'#b91c1c'};
      const bg = {S:'#fef3c7',A:'#dcfce7',B:'#dbeafe',C:'#fef9c3',D:'#fee2e2'};
      const g  = d.productivity_report.grade;
      gradeEl.style.color      = gc[g] || '#475569';
      gradeEl.style.background = bg[g] || '#f1f5f9';
    }

    // ── Sleep Analytics ───────────────────────────────────────
    setEl('rpt-sleep-score',  `${d.sleep_report.sleep_score}%`);
    setEl('rpt-sleep-wake',   `${d.sleep_report.avg_wakefulness}/5`);
    setEl('rpt-sleep-events', d.sleep_report.total_alarm_events);
    setEl('rpt-sleep-label',  d.sleep_report.wakefulness_label);
    // 7-day bar chart
    const barsEl   = document.getElementById('rpt-sleep-bars');
    const labelsEl = document.getElementById('rpt-sleep-labels');
    if (barsEl && d.sleep_report.days_scores) {
      const scores = d.sleep_report.days_scores;
      const labels = d.sleep_report.days_labels;
      const maxS   = Math.max(...scores, 1);
      barsEl.innerHTML = scores.map((s, i) => {
        const h = Math.max(4, Math.round((s / 100) * 72));
        return `<div class="sleep-day-bar" style="height:${h}px;" data-val="${s}%" title="${labels[i]}: ${s}%"></div>`;
      }).join('');
      if (labelsEl) labelsEl.innerHTML = labels.map(l => `<span>${l}</span>`).join('');
    }

    // Footer
    if (genAtEl && d.generated_at) {
      const dt = new Date(d.generated_at);
      genAtEl.textContent = `Generated ${dt.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})} at ${dt.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}`;
    }

    if (loadEl)  loadEl.style.display = 'none';
    if (gridEl)  gridEl.style.display = 'block';
    if (footerEl) footerEl.style.display = 'flex';

  } catch (e) {
    if (loadEl) loadEl.innerHTML = `
      <div style="font-size:2rem;margin-bottom:10px;">🔌</div>
      <div>Start the backend to load your reports.</div>
      <div style="font-size:0.8rem;margin-top:6px;color:#94a3b8;">${e.message}</div>`;
  }
}

// Helper: set element text
function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val ?? '—';
}

// Helper: set progress bar width
function setBar(id, pct) {
  const el = document.getElementById(id);
  if (el) el.style.width = `${Math.min(100, Math.max(0, pct || 0))}%`;
}

// ── Export as Excel/CSV ───────────────────────────────────────
async function exportReportExcel(reportType, btnEl) {
  const userId = (user && user.id) ? parseInt(user.id) : 1;
  const btn    = btnEl || null;

  if (btn) {
    btn._origText = btn.innerHTML;
    btn.innerHTML = '⏳';
    btn.disabled  = true;
  }

  try {
    const res = await fetch(`${API_BASE}/reports/export/${userId}?report_type=${reportType}`, { headers: authHeaders({}) });
    if (!res.ok) throw new Error('HTTP ' + res.status);

    const disposition = res.headers.get('Content-Disposition') || '';
    const match       = disposition.match(/filename=([^\s;]+)/);
    const filename    = match ? match[1] : `report_${reportType}.csv`;

    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    if (btn) {
      btn.innerHTML = '✓';
      btn.style.color       = '#16a34a';
      btn.style.borderColor = '#16a34a';
      btn.disabled = false;
      setTimeout(() => {
        btn.innerHTML         = btn._origText || '⬇';
        btn.style.color       = '';
        btn.style.borderColor = '';
      }, 2500);
    }
  } catch (err) {
    console.warn('Export failed:', err);
    if (btn) {
      btn.innerHTML   = '✗ Failed';
      btn.style.color = '#dc2626';
      btn.disabled    = false;
      setTimeout(() => { btn.innerHTML = btn._origText || '⬇'; btn.style.color = ''; }, 3000);
    }
  }
}

// ── Export as PDF (browser print) ────────────────────────────
async function exportReportPDF() {
  const userId = (user && user.id) ? parseInt(user.id) : 1;
  const btn    = document.getElementById('btn-export-pdf');

  if (btn) {
    btn._origHTML = btn.innerHTML;
    btn.innerHTML = '⏳ Preparing...';
    btn.disabled  = true;
  }

  try {
    const res  = await fetch(`${API_BASE}/reports/export-text/${userId}`, { headers: authHeaders({}) });
    if (!res.ok) throw new Error();
    const data = await res.json();

    // Open a clean print window with the report text
    const win  = window.open('', '_blank', 'width=800,height=700');
    win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Cognitive Alarm Report — ${data.name}</title>
  <style>
    body { font-family: 'Courier New', monospace; font-size: 13px; color: #1a1a1a;
           max-width: 700px; margin: 40px auto; padding: 20px; line-height: 1.7; }
    pre  { white-space: pre-wrap; word-wrap: break-word; }
    h1   { font-family: Arial, sans-serif; font-size: 18px; color: #1e3a5f;
           border-bottom: 2px solid #1e3a5f; padding-bottom: 8px; margin-bottom: 20px; }
    .footer { margin-top: 40px; font-size: 11px; color: #888; border-top: 1px solid #ccc; padding-top: 10px; }
    @media print {
      body { margin: 20px; }
      button { display: none; }
    }
  </style>
</head>
<body>
  <h1>Cognitive Alarm — Personal Performance Report</h1>
  <pre>${data.text}</pre>
  <div class="footer">Generated: ${data.generated_at} · Cognitive Alarm Platform</div>
  <br>
  <button onclick="window.print()" style="padding:10px 24px;background:#1e3a5f;color:#fff;border:none;border-radius:6px;font-size:14px;cursor:pointer;">
    🖨️ Print / Save as PDF
  </button>
</body>
</html>`);
    win.document.close();
    if (btn) {
      btn.innerHTML = '✓ Ready';
      btn.disabled = false;
    }
    setTimeout(() => {
      if (btn) btn.innerHTML = btn._origHTML || '⬇ Export PDF';
    }, 3000);

  } catch {
    if (btn) {
      btn.innerHTML = '✗ Failed';
      btn.disabled = false;
    }
    setTimeout(() => {
      if (btn) btn.innerHTML = btn._origHTML || '⬇ Export PDF';
    }, 3000);
  }
}

// ── Admin System Reports Download ────────────────────────────
// Downloads CSV from /admin/reports/download/{type}
// Called by System Reports card buttons: downloadAdminReport('db_health', this)
async function downloadAdminReport(reportType, btnEl) {
  const btn = btnEl || null;
  if (btn) {
    btn._origText = btn.textContent.trim();
    btn.textContent = '⏳ Preparing...';
    btn.disabled    = true;
  }

  try {
    const res = await fetch(`${API_BASE}/admin/reports/download/${reportType}`, { headers: authHeaders({}) });
    if (!res.ok) throw new Error('HTTP ' + res.status);

    // Get filename from Content-Disposition header
    const disposition = res.headers.get('Content-Disposition') || '';
    const match       = disposition.match(/filename=([^\s;]+)/);
    const filename    = match ? match[1] : `${reportType}_report.csv`;

    // Trigger browser download
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Success feedback
    if (btn) {
      btn.textContent       = '✓ Downloaded';
      btn.style.color       = '#16a34a';
      btn.style.borderColor = '#16a34a';
      btn.disabled          = false;
      setTimeout(() => {
        btn.textContent       = btn._origText || 'Download';
        btn.style.color       = '';
        btn.style.borderColor = '';
      }, 3000);
    }

  } catch (err) {
    console.warn('Admin report download failed:', err);
    if (btn) {
      btn.textContent = '✗ Failed';
      btn.style.color = '#dc2626';
      btn.disabled    = false;
      setTimeout(() => {
        btn.textContent = btn._origText || 'Download';
        btn.style.color = '';
      }, 3000);
    }
  }
}

// ── Role-based access: map each role to its allowed panel ────
const ROLE_PANEL_MAP = {
  'admin':          'admin-panel',
  'wellness_coach': 'coach-panel',
  'user':           'user-panel',
};
function getUserAllowedPanel() {
  return ROLE_PANEL_MAP[user && user.role] || 'user-panel';
}


// ════════════════════════════════════════════════════════════
//  ADMIN — PERSONAL NOTIFICATION COMPOSER
// ════════════════════════════════════════════════════════════

// Wire up textarea character counter on page load
document.addEventListener('DOMContentLoaded', () => {
  const bodyEl = document.getElementById('pn-body-input');
  const countEl = document.getElementById('pn-char-count');
  if (bodyEl && countEl) {
    bodyEl.addEventListener('input', () => {
      const len = bodyEl.value.length;
      countEl.textContent = `${len} / 300`;
      countEl.style.color = len > 270 ? '#dc2626' : len > 200 ? '#d97706' : '#94a3b8';
    });
  }
});

/**
 * Called by the "Notify" button in each user row.
 * Pre-selects that user in the composer dropdown and scrolls to it.
 */
function pnSelectUser(userId, userName) {
  const sel = document.getElementById('pn-user-select');
  if (sel) {
    sel.value = String(userId);
    // Highlight so admin knows it was auto-selected
    sel.style.borderColor = '#2563eb';
    sel.style.background  = '#eff6ff';
    setTimeout(() => {
      sel.style.borderColor = '';
      sel.style.background  = '';
    }, 1800);
  }
  // Scroll the composer into view
  const composer = document.querySelector('.pn-composer');
  if (composer) composer.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Pre-fill a friendly title placeholder
  const titleEl = document.getElementById('pn-title-input');
  if (titleEl && !titleEl.value) titleEl.placeholder = `Message for ${userName}…`;
}

/**
 * Toggles the live preview strip above the Send button.
 */
function pnTogglePreview() {
  const preview  = document.getElementById('pn-preview');
  const icon     = document.getElementById('pn-icon-select')?.value  || '📬';
  const title    = document.getElementById('pn-title-input')?.value  || '—';
  const body     = document.getElementById('pn-body-input')?.value   || '—';

  document.getElementById('pn-preview-icon').textContent  = icon;
  document.getElementById('pn-preview-title').textContent = title;
  document.getElementById('pn-preview-body').textContent  = body;

  const isVisible = preview.style.display !== 'none';
  preview.style.display = isVisible ? 'none' : 'flex';
}

/**
 * Sends a personal notification to the selected user via POST /admin/notifications/personal
 */
async function sendPersonalNotification() {
  const userId   = document.getElementById('pn-user-select')?.value;
  const type     = document.getElementById('pn-type-select')?.value     || 'announcement';
  const priority = document.getElementById('pn-priority-select')?.value || 'normal';
  const icon     = document.getElementById('pn-icon-select')?.value     || '📬';
  const title    = document.getElementById('pn-title-input')?.value.trim();
  const body     = document.getElementById('pn-body-input')?.value.trim();
  const statusEl = document.getElementById('pn-send-status');
  const sendBtn  = document.getElementById('pn-send-btn');

  // ── Validation ───────────────────────────────────────────
  if (!userId) {
    pnSetStatus('⚠️ Please select a recipient.', 'warn'); return;
  }
  if (!title) {
    pnSetStatus('⚠️ Please enter a notification title.', 'warn'); return;
  }
  if (!body) {
    pnSetStatus('⚠️ Please enter a message body.', 'warn'); return;
  }

  // ── Sending state ─────────────────────────────────────────
  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '⏳ Sending…'; }
  pnSetStatus('', '');

  try {
    const res = await fetch(`${API_BASE}/admin/notifications/personal`, {
      method:  'POST',
      headers: authHeaders(),
      body:    JSON.stringify({
        user_id:  parseInt(userId),
        type,
        priority,
        icon,
        title,
        body,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }

    const data = await res.json();

    // ── Success ───────────────────────────────────────────
    pnSetStatus(`✅ Notification sent to ${data.notification.target_name}!`, 'ok');

    // Clear form
    document.getElementById('pn-title-input').value = '';
    document.getElementById('pn-body-input').value  = '';
    document.getElementById('pn-char-count').textContent = '0 / 300';
    document.getElementById('pn-preview').style.display  = 'none';

    // Refresh history
    loadPersonalNotifHistory();

  } catch (err) {
    pnSetStatus(`❌ Failed: ${err.message}`, 'error');
    console.warn('sendPersonalNotification error:', err);
  } finally {
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
        <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
      </svg> Send Notification`;
    }
  }
}

/** Sets the status bar text + style */
function pnSetStatus(msg, type) {
  const el = document.getElementById('pn-send-status');
  if (!el) return;
  el.textContent = msg;
  el.className   = 'pn-status' + (type === 'ok' ? ' pn-status-ok' : type === 'warn' ? ' pn-status-warn' : type === 'error' ? ' pn-status-error' : '');
  if (msg) setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 5000);
}

/**
 * Loads sent personal notification history from GET /admin/notifications/personal
 * and renders it in the #pn-history-list container.
 */
async function loadPersonalNotifHistory() {
  const listEl = document.getElementById('pn-history-list');
  if (!listEl) return;

  listEl.innerHTML = '<div class="pn-history-loading">Loading…</div>';

  try {
    const res = await fetch(`${API_BASE}/admin/notifications/personal`, {
      headers: authHeaders({})
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const notifs = data.notifications || [];

    if (!notifs.length) {
      listEl.innerHTML = '<div class="pn-history-empty">No notifications sent yet.</div>';
      return;
    }

    const priorityDot = { high: '🔴', normal: '🟡', low: '🟢' };

    listEl.innerHTML = notifs.map(n => `
      <div class="pn-history-row">
        <span class="pn-hist-icon">${n.icon}</span>
        <div class="pn-hist-body">
          <div class="pn-hist-top">
            <strong class="pn-hist-title">${n.title}</strong>
            <span class="pn-hist-priority">${priorityDot[n.priority] || '🟡'} ${n.priority}</span>
          </div>
          <div class="pn-hist-msg">${n.body}</div>
          <div class="pn-hist-meta">
            <span>To: <strong>${n.target_name}</strong></span>
            <span>${n.date} · ${n.timestamp}</span>
            <span class="pn-hist-type-badge">${n.type}</span>
          </div>
        </div>
      </div>`).join('');

  } catch (err) {
    listEl.innerHTML = `<div class="pn-history-empty">Could not load history — make sure the backend is running.</div>`;
    console.warn('loadPersonalNotifHistory error:', err);
  }
}


// ════════════════════════════════════════════════════════════
//  COACH — CLIENT DIRECTORY & SESSION SCHEDULER
// ════════════════════════════════════════════════════════════

let _cdAllClients = [];   // full client list for client-side filtering

// Set today as default date for scheduler on load
document.addEventListener('DOMContentLoaded', () => {
  const dateEl = document.getElementById('sched-date');
  if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
  const timeEl = document.getElementById('sched-time');
  if (timeEl) timeEl.value = '10:00';
});

// ── Status helpers ────────────────────────────────────────────
function cdSetSchedStatus(msg, type) {
  const el = document.getElementById('sched-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'cd-sched-status' +
    (type === 'ok'    ? ' cd-status-ok'    :
     type === 'warn'  ? ' cd-status-warn'  :
     type === 'error' ? ' cd-status-error' : '');
  if (msg) setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 5000);
}

// ── Load full client directory ────────────────────────────────
async function loadCoachDirectory() {
  const listEl   = document.getElementById('cd-client-list');
  const countEl  = document.getElementById('cd-client-count');
  const selEl    = document.getElementById('sched-client-select');
  if (!listEl) return;

  listEl.innerHTML = '<div class="cd-loading">Loading client directory…</div>';

  try {
    const res = await fetch(`${API_BASE}/coach/client-directory`, {
      headers: authHeaders({})
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    _cdAllClients = data.clients || [];
    if (countEl) countEl.textContent = _cdAllClients.length + ' clients';

    // Populate scheduler dropdown
    if (selEl) {
      selEl.innerHTML = '<option value="">— Select client —</option>' +
        _cdAllClients.map(c =>
          `<option value="${c.id}" data-name="${c.full_name}">${c.full_name} (${c.email})</option>`
        ).join('');
    }

    cdRenderClients(_cdAllClients);

    // Load session history separately after clients render
    await loadSessionHistory();

  } catch (err) {
    listEl.innerHTML = `<div class="cd-error">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round" width="26" height="26">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <p>Could not load clients.</p>
      <span>Make sure the backend is running.</span>
      <button class="cd-retry-btn" onclick="loadCoachDirectory()">Retry</button>
    </div>`;
    console.warn('loadCoachDirectory error:', err);
  }
}

// ── Render client cards ───────────────────────────────────────
function cdRenderClients(clients) {
  const listEl = document.getElementById('cd-client-list');
  if (!listEl) return;

  if (!clients.length) {
    listEl.innerHTML = '<div class="cd-empty">No clients found.</div>';
    return;
  }

  const statusCls = {
    'Optimal':       'cd-status-optimal',
    'On Track':      'cd-status-ontrack',
    'New':           'cd-status-new',
    'Needs Support': 'cd-status-needs',
  };

  const wakeBadge = w =>
    w === null ? '—' :
    w >= 4.5 ? `<span class="cd-wake-badge cd-wake-great">${w} ⚡</span>` :
    w >= 3.5 ? `<span class="cd-wake-badge cd-wake-good">${w} 🙂</span>` :
               `<span class="cd-wake-badge cd-wake-low">${w} 😴</span>`;

  listEl.innerHTML = clients.map(c => `
    <div class="cd-client-row" id="cd-row-${c.id}">

      <!-- Avatar + name block -->
      <div class="cd-client-identity">
        <div class="cd-avatar">${c.full_name.split(' ').map(p => p[0]).join('').slice(0,2).toUpperCase()}</div>
        <div class="cd-client-info">
          <span class="cd-client-name">${c.full_name}</span>
          <span class="cd-client-email">${c.email}</span>
          <span class="cd-client-joined">Joined ${c.joined}</span>
        </div>
      </div>

      <!-- Stats pills -->
      <div class="cd-stats-grid">
        <div class="cd-stat-pill">
          <span class="cd-stat-val">${c.accuracy_pct}%</span>
          <span class="cd-stat-lbl">Accuracy</span>
        </div>
        <div class="cd-stat-pill">
          <span class="cd-stat-val">${c.total_challenges}</span>
          <span class="cd-stat-lbl">Challenges</span>
        </div>
        <div class="cd-stat-pill">
          <span class="cd-stat-val">${c.habit_pct}%</span>
          <span class="cd-stat-lbl">Habits</span>
        </div>
        <div class="cd-stat-pill">
          <span class="cd-stat-val">${c.sleep_pct}%</span>
          <span class="cd-stat-lbl">Sleep Score</span>
        </div>
        <div class="cd-stat-pill">
          <span class="cd-stat-val">${wakeBadge(c.avg_wakefulness)}</span>
          <span class="cd-stat-lbl">Wakefulness</span>
        </div>
        <div class="cd-stat-pill">
          <span class="cd-stat-val">${c.challenges_week}</span>
          <span class="cd-stat-lbl">This Week</span>
        </div>
      </div>

      <!-- Progress bar (accuracy) -->
      <div class="cd-progress-col">
        <div class="cd-prog-label">
          <span>Top challenge: <strong>${c.top_challenge_type}</strong></span>
          <span>Difficulty: <strong>${c.top_difficulty}</strong></span>
        </div>
        <div class="cd-prog-track">
          <div class="cd-prog-fill" style="width:${c.accuracy_pct}%;background:${
            c.accuracy_pct >= 75 ? '#16a34a' :
            c.accuracy_pct >= 50 ? '#d97706' : '#dc2626'
          };"></div>
        </div>
        <div class="cd-prog-foot">
          <span class="${statusCls[c.cog_status] || 'cd-status-new'} cd-cog-badge">${c.cog_status}</span>
          <span class="cd-last-active">Last active: ${c.last_active}</span>
        </div>
      </div>

      <!-- Action buttons -->
      <div class="cd-actions-col">
        ${c.upcoming_sessions > 0
          ? `<span class="cd-upcoming-badge">${c.upcoming_sessions} upcoming</span>`
          : ''}
        <button class="cd-btn-schedule-quick" onclick="cdQuickSchedule(${c.id}, '${c.full_name.replace(/'/g,"\\'")}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" width="13" height="13">
            <rect x="3" y="4" width="18" height="18" rx="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          Schedule
        </button>
        <div class="cd-avg-score">Avg score: <strong>${c.avg_score} pts</strong></div>
      </div>

    </div>`).join('');
}

// ── Client-side search filter ─────────────────────────────────
function cdFilterClients(query) {
  const q = (query || '').toLowerCase().trim();
  const filtered = q
    ? _cdAllClients.filter(c =>
        c.full_name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q))
    : _cdAllClients;
  cdRenderClients(filtered);
}

// ── Quick-schedule from a client row ─────────────────────────
function cdQuickSchedule(clientId, clientName) {
  const sel = document.getElementById('sched-client-select');
  if (sel) {
    sel.value = String(clientId);
    sel.style.borderColor = '#7c3aed';
    sel.style.background  = '#f5f3ff';
    setTimeout(() => { sel.style.borderColor = ''; sel.style.background = ''; }, 1800);
  }
  // Scroll to scheduler
  const sched = document.getElementById('cd-scheduler');
  if (sched) sched.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Book session ──────────────────────────────────────────────
async function scheduleSession() {
  const clientSel  = document.getElementById('sched-client-select');
  const dateEl     = document.getElementById('sched-date');
  const timeEl     = document.getElementById('sched-time');
  const durEl      = document.getElementById('sched-duration');
  const topicEl    = document.getElementById('sched-topic');
  const notesEl    = document.getElementById('sched-notes');
  const btn        = document.querySelector('.cd-btn-schedule');

  const clientId   = clientSel?.value;
  const clientName = clientSel?.options[clientSel.selectedIndex]?.dataset?.name || '';
  const date       = dateEl?.value;
  const time       = timeEl?.value;
  const duration   = parseInt(durEl?.value || '30');
  const topic      = topicEl?.value || 'General Check-in';
  const notes      = notesEl?.value.trim() || '';

  // Validation
  if (!clientId)  { cdSetSchedStatus('⚠️ Please select a client.', 'warn');  return; }
  if (!date)      { cdSetSchedStatus('⚠️ Please pick a date.', 'warn');      return; }
  if (!time)      { cdSetSchedStatus('⚠️ Please pick a time.', 'warn');      return; }

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Booking…'; }
  cdSetSchedStatus('', '');

  try {
    const res = await fetch(`${API_BASE}/coach/sessions`, {
      method:  'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        client_id:    parseInt(clientId),
        client_name:  clientName,
        date, time, duration_min: duration, topic, notes
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'HTTP ' + res.status);
    }
    const data = await res.json();
    const s    = data.session;

    cdSetSchedStatus(
      `✅ Session booked with ${s.client_name} on ${s.date} at ${s.time} (${s.duration_min} min)`,
      'ok'
    );

    // Clear form
    if (clientSel) clientSel.value = '';
    if (notesEl)   notesEl.value   = '';

    // Refresh history only (not the full directory — avoids race condition)
    await loadSessionHistory();

  } catch (err) {
    cdSetSchedStatus(`❌ ${err.message}`, 'error');
    console.warn('scheduleSession error:', err);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg> Book Session`;
    }
  }
}

// ── Load & render session history ─────────────────────────────
async function loadSessionHistory() {
  const listEl = document.getElementById('cd-sessions-list');
  if (!listEl) return;

  listEl.innerHTML = '<div class="cd-sessions-empty" style="padding:12px;">Loading…</div>';

  try {
    const res = await fetch(`${API_BASE}/coach/sessions`, {
      headers: authHeaders({})
    });

    // Surface auth / permission errors clearly
    if (res.status === 401 || res.status === 403) {
      listEl.innerHTML = '<div class="cd-sessions-empty">⚠️ Permission denied. Make sure you are logged in as Wellness Coach.</div>';
      return;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);

    const data     = await res.json();
    const sessions = data.sessions || [];

    if (!sessions.length) {
      listEl.innerHTML = '<div class="cd-sessions-empty">No sessions scheduled yet. Book a session above to get started.</div>';
      return;
    }

    const statusCls = {
      scheduled:  'cd-sess-scheduled',
      completed:  'cd-sess-completed',
      cancelled:  'cd-sess-cancelled',
    };
    const statusLabel = {
      scheduled: '🗓 Scheduled',
      completed: '✅ Completed',
      cancelled: '✗ Cancelled',
    };

    const topicIcon = {
      'Cognitive Challenge Review':     '🧠',
      'Progress & Goals Check-in':      '📊',
      'Habit Building Strategy':        '📋',
      'Sleep Pattern Analysis':         '🌙',
      'Wakefulness & Energy Coaching':  '⚡',
      'Difficulty Level Planning':      '🎯',
      'General Check-in':               '💬',
    };

    listEl.innerHTML = sessions.map(s => `
      <div class="cd-sess-row ${statusCls[s.status] || ''}">
        <div class="cd-sess-icon">${topicIcon[s.topic] || '💬'}</div>
        <div class="cd-sess-body">
          <div class="cd-sess-top">
            <strong class="cd-sess-client">${s.client_name}</strong>
            <span class="cd-sess-topic">${s.topic}</span>
            <span class="cd-sess-badge ${statusCls[s.status] || ''}">${statusLabel[s.status] || s.status}</span>
          </div>
          <div class="cd-sess-meta">
            <span>📅 ${s.date} · ⏰ ${s.time} · ⌛ ${s.duration_min} min</span>
            ${s.notes ? `<span class="cd-sess-notes">📝 ${s.notes}</span>` : ''}
          </div>
        </div>
        <div class="cd-sess-actions">
          ${s.status === 'scheduled' ? `
            <button class="cd-sess-btn cd-sess-done"
              onclick="updateSessionStatus(${s.id}, 'completed', this)">✓ Done</button>
            <button class="cd-sess-btn cd-sess-cancel"
              onclick="updateSessionStatus(${s.id}, 'cancelled', this)">✗ Cancel</button>
          ` : ''}
        </div>
      </div>`).join('');

  } catch (err) {
    listEl.innerHTML = '<div class="cd-sessions-empty">Could not load sessions.</div>';
    console.warn('loadSessionHistory error:', err);
  }
}

// ── Update session status ─────────────────────────────────────
async function updateSessionStatus(sessionId, status, btn) {
  if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }
  try {
    const res = await fetch(
      `${API_BASE}/coach/sessions/${sessionId}/status?status=${status}`,
      { method: 'PATCH', headers: authHeaders({}) }
    );
    if (!res.ok) throw new Error('HTTP ' + res.status);
    loadSessionHistory();
  } catch (err) {
    if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    console.warn('updateSessionStatus error:', err);
  }
}


// ════════════════════════════════════════════════════════════
//  USER — MY COACHING SESSIONS
// ════════════════════════════════════════════════════════════

async function loadUserSessions() {
  const listEl      = document.getElementById('ms-sessions-list');
  const emptyEl     = document.getElementById('ms-empty-state');
  const badgeEl     = document.getElementById('user-sessions-badge');
  const upEl        = document.getElementById('ms-count-upcoming');
  const doneEl      = document.getElementById('ms-count-completed');
  const totalEl     = document.getElementById('ms-count-total');
  const coachEl     = document.getElementById('ms-coach-name');

  const userId = user && user.id ? parseInt(user.id) : null;
  if (!userId) return;

  if (listEl) listEl.innerHTML = '<div class="ms-loading">Loading your sessions…</div>';
  if (emptyEl) emptyEl.style.display = 'none';

  try {
    const res = await fetch(`${API_BASE}/user/sessions/${userId}`, {
      headers: authHeaders({})
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data     = await res.json();
    const sessions = data.sessions || [];

    // Summary counts
    const upcoming  = sessions.filter(s => s.status === 'scheduled');
    const completed = sessions.filter(s => s.status === 'completed');
    if (upEl)    upEl.textContent    = upcoming.length;
    if (doneEl)  doneEl.textContent  = completed.length;
    if (totalEl) totalEl.textContent = sessions.length;

    // Coach name from first session that has one
    const coachName = sessions.find(s => s.coach_name)?.coach_name || '—';
    if (coachEl) coachEl.textContent = coachName;

    // Sidebar badge — show upcoming count
    if (badgeEl) {
      if (upcoming.length > 0) {
        badgeEl.textContent    = upcoming.length;
        badgeEl.style.display  = 'inline-flex';
      } else {
        badgeEl.style.display  = 'none';
      }
    }

    // Empty state
    if (!sessions.length) {
      if (listEl)  listEl.innerHTML = '';
      if (emptyEl) emptyEl.style.display = 'flex';
      return;
    }

    // Topic icons
    const topicIcon = {
      'Cognitive Challenge Review':    '🧠',
      'Progress & Goals Check-in':     '📊',
      'Habit Building Strategy':       '📋',
      'Sleep Pattern Analysis':        '🌙',
      'Wakefulness & Energy Coaching': '⚡',
      'Difficulty Level Planning':     '🎯',
      'General Check-in':              '💬',
    };

    const statusCfg = {
      scheduled: { cls: 'ms-sess-scheduled', label: '🗓 Upcoming',   badge: 'ms-badge-scheduled' },
      completed: { cls: 'ms-sess-completed', label: '✅ Completed',  badge: 'ms-badge-completed' },
      cancelled: { cls: 'ms-sess-cancelled', label: '✗ Cancelled',   badge: 'ms-badge-cancelled' },
    };

    if (listEl) {
      listEl.innerHTML = sessions.map(s => {
        const st   = statusCfg[s.status] || statusCfg.scheduled;
        const icon = topicIcon[s.topic]   || '💬';
        const isUpcoming = s.status === 'scheduled';

        return `
          <div class="ms-sess-row ${st.cls}">

            <!-- Date block -->
            <div class="ms-date-block ${isUpcoming ? 'ms-date-upcoming' : ''}">
              <span class="ms-date-day">${s.date ? s.date.split('-')[2] : '—'}</span>
              <span class="ms-date-mon">${s.date ? new Date(s.date + 'T00:00').toLocaleString('en-GB',{month:'short'}) : ''}</span>
              <span class="ms-date-when ${isUpcoming ? 'ms-when-soon' : ''}">${s.when || s.date}</span>
            </div>

            <!-- Icon -->
            <div class="ms-topic-icon">${icon}</div>

            <!-- Body -->
            <div class="ms-sess-body">
              <div class="ms-sess-top">
                <span class="ms-sess-topic">${s.topic}</span>
                <span class="ms-sess-badge ${st.badge}">${st.label}</span>
              </div>
              <div class="ms-sess-meta">
                <span>⏰ ${s.time}</span>
                <span>⌛ ${s.duration_min} min</span>
                <span>👤 ${s.coach_name || 'Your Coach'}</span>
              </div>
              ${s.notes ? `<div class="ms-sess-notes">📝 ${s.notes}</div>` : ''}
            </div>

          </div>`;
      }).join('');
    }

  } catch (err) {
    if (listEl) listEl.innerHTML = `
      <div class="ms-error">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" width="24" height="24">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <p>Could not load sessions.</p>
        <button onclick="loadUserSessions()" class="ms-retry-btn">Retry</button>
      </div>`;
    console.warn('loadUserSessions error:', err);
  }
}
