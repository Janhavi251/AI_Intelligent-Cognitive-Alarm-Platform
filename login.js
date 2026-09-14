// ── API base URL ─────────────────────────────────────────────
const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'http://localhost:8000' : '';

const takenEmails = ["admin@wellspring.io","coach@wellspring.io"];

function switchTab(tab){
  const isSignin = tab === 'signin';
  document.getElementById('tabSignin').classList.toggle('active', isSignin);
  document.getElementById('tabSignup').classList.toggle('active', !isSignin);
  document.getElementById('signinForm').classList.toggle('active', isSignin);
  document.getElementById('signupForm').classList.toggle('active', !isSignin);

  document.getElementById('panelTitle').innerHTML = isSignin ? "Welcome<br>back." : "Join the<br>network.";
  document.getElementById('panelLede').textContent = isSignin
    ? "Sign in to reach your coach, your care team, or your patients — all in one calm, secure place."
    : "Create your account and choose the role that fits how you'll use Cognitive Alarm.";
}

function toggleVis(id, btn){
  const input = document.getElementById(id);
  const isPass = input.type === 'password';
  input.type = isPass ? 'text' : 'password';
  btn.textContent = isPass ? 'HIDE' : 'SHOW';
}

function checkEmailUnique(){
  const val = document.getElementById('su-email').value.trim().toLowerCase();
  const hint = document.getElementById('emailHint');
  const input = document.getElementById('su-email');
  if(!val){
    hint.textContent = "Must be unique — we'll check availability.";
    hint.className = "hint";
    input.classList.remove('field-error');
    return;
  }
  if(takenEmails.includes(val)){
    hint.textContent = "That email is already registered.";
    hint.className = "hint err";
    input.classList.add('field-error');
  } else {
    hint.textContent = "Available.";
    hint.className = "hint ok";
    input.classList.remove('field-error');
  }
}

function checkStrength(){
  const val = document.getElementById('su-pass').value;
  const hint = document.getElementById('passHint');
  if(val.length === 0){
    hint.textContent = "Stored as a salted hash (bcrypt) — never in plain text.";
    hint.className = "hint";
  } else if(val.length < 8){
    hint.textContent = "At least 8 characters needed.";
    hint.className = "hint err";
  } else {
    hint.textContent = "Looks good — will be hashed before saving.";
    hint.className = "hint ok";
  }
}

// ── Sign In → calls FastAPI backend ──────────────────────────
async function handleSignin(e){
  e.preventDefault();
  const email    = document.getElementById('si-email').value.trim();
  const password = document.getElementById('si-pass').value;
  const btn      = e.target.querySelector('button[type="submit"]');

  if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }

  try {
    const res  = await fetch('${API_BASE}/auth/signin', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password })
    });
    const data = await res.json();

    if (!res.ok) {
      alert(data.detail || 'Sign in failed. Check your email and password.');
      if (btn) { btn.disabled = false; btn.textContent = 'Sign in'; }
      return false;
    }

    // Persist JWT + full user object for dashboard
    localStorage.setItem('token', data.token);
    localStorage.setItem('user',  JSON.stringify(data.user));
    window.location.href = 'dashboard.html';

  } catch (err) {
    alert('Cannot connect to server. Make sure the backend is running on port 8000.');
    if (btn) { btn.disabled = false; btn.textContent = 'Sign in'; }
  }
  return false;
}

// ── Sign Up → calls FastAPI backend ──────────────────────────
async function handleSignup(e){
  e.preventDefault();
  const full_name = document.getElementById('su-name').value.trim();
  const email     = document.getElementById('su-email').value.trim().toLowerCase();
  const password  = document.getElementById('su-pass').value;
  const role      = document.getElementById('su-role').value;
  const btn       = e.target.querySelector('button[type="submit"]');

  if(takenEmails.includes(email)){
    checkEmailUnique();
    return false;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Creating account…'; }

  try {
    const res  = await fetch('${API_BASE}/auth/signup', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ full_name, email, password, role })
    });
    const data = await res.json();

    if (!res.ok) {
      alert(data.detail || 'Sign up failed. Try a different email.');
      if (btn) { btn.disabled = false; btn.textContent = 'Create account'; }
      return false;
    }

    // Persist JWT + full user object for dashboard
    localStorage.setItem('token', data.token);
    localStorage.setItem('user',  JSON.stringify(data.user));
    window.location.href = 'dashboard.html';

  } catch (err) {
    alert('Cannot connect to server. Make sure the backend is running on port 8000.');
    if (btn) { btn.disabled = false; btn.textContent = 'Create account'; }
  }
  return false;
}

// ── Google OAuth ──────────────────────────────────────────────
function handleOAuth(mode){
  window.location.href = '${API_BASE}/auth/google';
}
