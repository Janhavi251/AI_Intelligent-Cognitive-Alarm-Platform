from typing import List, Optional, Any
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.sessions import SessionMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
import sys, os

# Ensure backend directory is always on the path (needed for Vercel serverless)
_here = os.path.dirname(os.path.abspath(__file__))
if _here not in sys.path:
    sys.path.insert(0, _here)

try:
    from database import get_db, engine
    from models import User, Alarm, ChallengeLog, HabitLog, Achievement, AlarmLog, Base, CoachSession, PersonalNotification
    from schemas import ChallengeResponse, ChallengeVerifyRequest, ChallengeVerifyResponse, AchievementItem, LearningTrendResponse, WakefulnessLogRequest, BehavioralAnalyticsResponse
    from challenge_generator import generate_cognitive_challenge
    from auth import hash_password, verify_password, create_token, decode_token
except ImportError:
    from backend.database import get_db, engine
    from backend.models import User, Alarm, ChallengeLog, HabitLog, Achievement, AlarmLog, Base, CoachSession, PersonalNotification
    from backend.schemas import ChallengeResponse, ChallengeVerifyRequest, ChallengeVerifyResponse, AchievementItem, LearningTrendResponse, WakefulnessLogRequest, BehavioralAnalyticsResponse
    from backend.challenge_generator import generate_cognitive_challenge
    from backend.auth import hash_password, verify_password, create_token, decode_token
from authlib.integrations.starlette_client import OAuth
from urllib.parse import quote
import traceback
import os

app = FastAPI(title="Wellspring API")

# Ensure database tables & schema migrations
try:
    Base.metadata.create_all(bind=engine)
    with engine.connect() as conn:
        from sqlalchemy import text
        for query in [
            "ALTER TABLE challenge_logs ADD COLUMN alarm_id INTEGER REFERENCES alarms(id) ON DELETE SET NULL;",
            "ALTER TABLE challenge_logs ADD COLUMN wakefulness_score INTEGER;",
            "ALTER TABLE alarms ADD COLUMN question_count INTEGER DEFAULT 2;"
        ]:
            try:
                conn.execute(text(query))
                conn.commit()
            except Exception:
                pass
except Exception as e:
    print(f"Startup DB migration info: {e}")


# ── Middleware ───────────────────────────────────────────────
app.add_middleware(SessionMiddleware, secret_key=os.getenv("SECRET_KEY", "changeme"))
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "*").split(","),
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
    allow_credentials=True,
)

# ── Security: add X-Content-Type-Options, X-Frame-Options headers ──
from starlette.middleware.base import BaseHTTPMiddleware

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"]        = "DENY"
        response.headers["Referrer-Policy"]        = "strict-origin-when-cross-origin"
        return response

app.add_middleware(SecurityHeadersMiddleware)

# ── Simple in-memory rate limiter for auth endpoints ─────────
import time
from collections import defaultdict

_login_attempts: dict = defaultdict(list)   # ip → [timestamps]
_RATE_LIMIT_WINDOW = 60   # seconds
_RATE_LIMIT_MAX    = 10   # max login attempts per window

def check_rate_limit(ip: str):
    now = time.time()
    attempts = [t for t in _login_attempts[ip] if now - t < _RATE_LIMIT_WINDOW]
    _login_attempts[ip] = attempts
    if len(attempts) >= _RATE_LIMIT_MAX:
        raise HTTPException(status_code=429, detail="Too many login attempts. Try again in a minute.")
    _login_attempts[ip].append(now)

# ── Google OAuth ─────────────────────────────────────────────
oauth = OAuth()
oauth.register(
    name="google",
    client_id=os.getenv("GOOGLE_CLIENT_ID"),
    client_secret=os.getenv("GOOGLE_CLIENT_SECRET"),
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={"scope": "openid email profile"},
)

# ── Global error handler ─────────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    print("=== SERVER ERROR ===")
    print(traceback.format_exc())
    # Don't leak internal details to clients
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


# ── Health check (monitoring / deployment probes) ─────────────
@app.get("/health", tags=["Monitoring"])
def health_check(db: Session = Depends(get_db)):
    """Liveness + DB connectivity check for load balancers and uptime monitors."""
    import time
    start = time.time()
    try:
        from sqlalchemy import text
        db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False
    latency_ms = round((time.time() - start) * 1000, 1)
    status = "ok" if db_ok else "degraded"
    return {
        "status":     status,
        "db":         "connected" if db_ok else "unreachable",
        "latency_ms": latency_ms,
        "version":    "1.0.0",
    }


# ══════════════════════════════════════════════════════════════
#  AUTH DEPENDENCY
# ══════════════════════════════════════════════════════════════

_bearer_scheme = HTTPBearer(auto_error=False)

def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
    db: Session = Depends(get_db)
) -> User:
    """Decode the JWT from the Authorization header and return the matching User.
    Raises 401 if the token is missing, invalid, or the user no longer exists."""
    token = credentials.credentials if credentials else None
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user_id = int(payload.get("sub", 0))
    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or disabled")
    return user


# ══════════════════════════════════════════════════════════════
#  AUTH
# ══════════════════════════════════════════════════════════════

class SignupRequest(BaseModel):
    full_name: str
    email: EmailStr
    password: str
    role: str = "user"

class SigninRequest(BaseModel):
    email: EmailStr
    password: str


@app.middleware("http")
async def vercel_path_rewrite_middleware(request: Request, call_next):
    vpath = request.query_params.get("__vpath")
    if vpath:
        request.scope["path"] = vpath
    else:
        path = request.scope.get("path", "")
        if path.startswith("/api/index.py"):
            request.scope["path"] = path.replace("/api/index.py", "", 1) or "/"
    return await call_next(request)

@app.post("/auth/signup")
@app.post("/api/auth/signup")
def signup(data: SignupRequest, request: Request, db: Session = Depends(get_db)):
    check_rate_limit(request.client.host if request.client else "unknown")
    # Sanitise inputs
    data.email     = data.email.strip().lower()
    data.full_name = data.full_name.strip()
    if len(data.password) < 6:
        raise HTTPException(status_code=422, detail="Password must be at least 6 characters")
    existing = db.query(User).filter(User.email == data.email).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    user = User(
        full_name=data.full_name,
        email=data.email,
        password_hash=hash_password(data.password),
        role=data.role,
        provider="local"
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_token(user.id, user.role)
    return {
        "token": token,
        "user": {"id": user.id, "full_name": user.full_name,
                 "email": user.email, "role": user.role}
    }


@app.post("/auth/signin")
@app.post("/api/auth/signin")
def signin(data: SigninRequest, request: Request, db: Session = Depends(get_db)):
    check_rate_limit(request.client.host if request.client else "unknown")
    data.email = data.email.strip().lower()
    user = db.query(User).filter(User.email == data.email).first()

    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is disabled")

    token = create_token(user.id, user.role)
    return {
        "token": token,
        "user": {"id": user.id, "full_name": user.full_name,
                 "email": user.email, "role": user.role}
    }



@app.get("/auth/google")
async def google_login(request: Request):
    redirect_uri = "http://localhost:8000/auth/google/callback"
    return await oauth.google.authorize_redirect(request, redirect_uri)


@app.get("/auth/google/callback")
async def google_callback(request: Request, db: Session = Depends(get_db)):
    token = await oauth.google.authorize_access_token(request)
    user_info = token.get("userinfo")
    email     = user_info["email"]
    full_name = user_info.get("name", email)

    user = db.query(User).filter(User.email == email).first()
    if not user:
        user = User(full_name=full_name, email=email,
                    password_hash=None, role="user", provider="google")
        db.add(user)
        db.commit()
        db.refresh(user)

    jwt_token = create_token(user.id, user.role)
    safe_name = quote(user.full_name)
    return RedirectResponse(
        url=f"http://127.0.0.1:5500/dashboard.html?token={jwt_token}&name={safe_name}&role={user.role}&id={user.id}"
    )


# ══════════════════════════════════════════════════════════════
#  ALARMS
# ══════════════════════════════════════════════════════════════

class AlarmCreate(BaseModel):
    user_id: int
    title: str = "My Alarm"
    alarm_time: str
    alarm_type: str = "daily"
    repeat_days: str = "Mon-Fri"
    difficulty_level: str = "medium"
    challenge: str = "math"
    sound: str = "default"
    vibration: bool = True
    snooze_enabled: bool = True
    snooze_duration: int = 5
    max_snooze_count: int = 3
    question_count: int = 2

class AlarmUpdate(BaseModel):
    title: str
    alarm_time: str
    alarm_type: str = "daily"
    repeat_days: str = "Mon-Fri"
    difficulty_level: str = "medium"
    sound: str = "default"
    vibration: bool = True
    snooze_enabled: bool = True
    snooze_duration: int = 5
    max_snooze_count: int = 3
    current_snooze_count: Optional[int] = 0
    question_count: Optional[int] = 2


def alarm_to_dict(a: Alarm) -> dict:
    return {
        "id":                   a.id,
        "user_id":              a.user_id,
        "title":                a.title,
        "alarm_time":           str(a.alarm_time),
        "alarm_type":           a.alarm_type,
        "repeat_days":          a.repeat_days,
        "is_active":            a.is_active,
        "difficulty_level":     a.difficulty_level,
        "challenge":            a.challenge,
        "sound":                a.sound,
        "vibration":            a.vibration,
        "snooze_enabled":       a.snooze_enabled,
        "snooze_duration":      getattr(a, "snooze_duration", 5),
        "max_snooze_count":     getattr(a, "max_snooze_count", 3),
        "current_snooze_count": getattr(a, "current_snooze_count", 0),
        "question_count":       getattr(a, "question_count", 2),
        "created_at":           str(a.created_at),
        "updated_at":           str(a.updated_at),
    }


@app.post("/alarms")
def create_alarm(data: AlarmCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if data.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Cannot create alarms for another user")
    alarm = Alarm(
        user_id=data.user_id,
        title=data.title,
        alarm_time=data.alarm_time,
        alarm_type=data.alarm_type,
        repeat_days=data.repeat_days,
        difficulty_level=data.difficulty_level,
        challenge=data.challenge,
        sound=data.sound,
        vibration=data.vibration,
        snooze_enabled=data.snooze_enabled,
        snooze_duration=data.snooze_duration,
        max_snooze_count=data.max_snooze_count,
        question_count=data.question_count,
        current_snooze_count=0
    )
    db.add(alarm)
    db.commit()
    db.refresh(alarm)
    return alarm_to_dict(alarm)


@app.get("/alarms/{user_id}")
def get_alarms(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if user_id != current_user.id and current_user.role not in ("admin", "wellness_coach"):
        raise HTTPException(status_code=403, detail="Access denied")
    alarms = db.query(Alarm).filter(Alarm.user_id == user_id).order_by(Alarm.created_at.desc()).all()
    return [alarm_to_dict(a) for a in alarms]


@app.put("/alarms/{alarm_id}")
def update_alarm(alarm_id: int, data: AlarmUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    alarm = db.query(Alarm).filter(Alarm.id == alarm_id).first()
    if not alarm:
        raise HTTPException(status_code=404, detail="Alarm not found")
    if alarm.user_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Access denied")

    alarm.title            = data.title
    alarm.alarm_time       = data.alarm_time
    alarm.alarm_type       = data.alarm_type
    alarm.repeat_days      = data.repeat_days
    alarm.difficulty_level = data.difficulty_level
    alarm.sound            = data.sound
    alarm.vibration        = data.vibration
    alarm.snooze_enabled   = data.snooze_enabled
    alarm.snooze_duration  = data.snooze_duration
    alarm.max_snooze_count = data.max_snooze_count
    if data.question_count is not None:
        alarm.question_count = data.question_count
    if data.current_snooze_count is not None:
        alarm.current_snooze_count = data.current_snooze_count
    db.commit()
    db.refresh(alarm)
    return alarm_to_dict(alarm)


@app.patch("/alarms/{alarm_id}/toggle")
def toggle_alarm(alarm_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    alarm = db.query(Alarm).filter(Alarm.id == alarm_id).first()
    if not alarm:
        raise HTTPException(status_code=404, detail="Alarm not found")
    if alarm.user_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Access denied")
    alarm.is_active = not alarm.is_active
    db.commit()
    return {"alarm_id": alarm.id, "is_active": alarm.is_active}


class AlarmSnoozeUpdate(BaseModel):
    increment: bool = True
    reset: bool = False

@app.patch("/alarms/{alarm_id}/snooze")
def update_alarm_snooze(alarm_id: int, data: AlarmSnoozeUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    alarm = db.query(Alarm).filter(Alarm.id == alarm_id).first()
    if not alarm:
        raise HTTPException(status_code=404, detail="Alarm not found")
    if alarm.user_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Access denied")
    if data.reset:
        alarm.current_snooze_count = 0
    elif data.increment:
        alarm.current_snooze_count = getattr(alarm, "current_snooze_count", 0) + 1
    db.commit()
    db.refresh(alarm)
    return alarm_to_dict(alarm)


@app.delete("/alarms/{alarm_id}")
def delete_alarm(alarm_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    alarm = db.query(Alarm).filter(Alarm.id == alarm_id).first()
    if not alarm:
        raise HTTPException(status_code=404, detail="Alarm not found")
    if alarm.user_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Access denied")
    db.delete(alarm)
    db.commit()
    return {"message": f"Alarm {alarm_id} deleted"}


# ══════════════════════════════════════════════════════════════
#  COGNITIVE CHALLENGES
# ══════════════════════════════════════════════════════════════

@app.get("/challenges/types")
def get_challenge_types():
    return {
        "types": [
            {"id": "math", "name": "Math Problems", "description": "Mental arithmetic & multi-step calculations"},
            {"id": "logic", "name": "Logic Puzzles", "description": "Boolean logic, ordering & syllogisms"},
            {"id": "memory", "name": "Memory Challenges", "description": "Sequence recall & spatial/reverse digit memory"},
            {"id": "word", "name": "Word Games", "description": "Anagram scrambles & vocabulary association"},
            {"id": "pattern", "name": "Pattern Recognition", "description": "Sequence predictions & matrix logic"},
            {"id": "riddle", "name": "Riddles", "description": "Lateral thinking & cognitive brain-teasers"},
            {"id": "quiz", "name": "Quick Quizzes", "description": "General knowledge & analytical trivia"}
        ],
        "difficulties": ["beginner", "easy", "medium", "hard", "expert"]
    }


@app.get("/challenges/generate", response_model=ChallengeResponse)
def generate_challenge(type: str = "math", difficulty: str = "medium"):
    return generate_cognitive_challenge(challenge_type=type, difficulty=difficulty)


@app.post("/challenges/verify", response_model=ChallengeVerifyResponse)
def verify_challenge(data: ChallengeVerifyRequest, db: Session = Depends(get_db)):
    user_ans = data.user_answer.strip().lower()
    correct_ans = data.answer_key.strip().lower()

    # Direct match or numeric equivalence
    is_correct = False
    if user_ans == correct_ans:
        is_correct = True
    else:
        try:
            if float(user_ans) == float(correct_ans):
                is_correct = True
        except ValueError:
            pass

    score = 0
    if is_correct:
        base_score = 100
        # Time bonus: faster answer = higher score
        speed_bonus = max(0, int(50 - data.time_taken_seconds))
        score = base_score + speed_bonus
        msg = f"Correct! Excellent brain activation. Score: {score} pts."
    else:
        msg = f"Incorrect. The correct answer was: {data.answer_key}."

    target_user_id = data.user_id if (data.user_id and data.user_id > 0) else 1
    log_id = None

    # Log to DB
    try:
        log = ChallengeLog(
            user_id=target_user_id,
            alarm_id=data.alarm_id,
            challenge_type=data.challenge_type or "math",
            difficulty=data.difficulty or "medium",
            success=is_correct,
            score=score,
            time_taken_seconds=data.time_taken_seconds
        )
        db.add(log)
        db.commit()
        db.refresh(log)
        log_id = log.id
    except Exception as e:
        db.rollback()
        print(f"Error logging challenge: {e}")

    return ChallengeVerifyResponse(
        success=is_correct,
        message=msg,
        correct_answer=data.answer_key,
        score=score,
        log_id=log_id
    )


@app.post("/challenges/wakefulness")
def record_wakefulness(data: WakefulnessLogRequest, db: Session = Depends(get_db)):
    """Records user's self-assessed morning wakefulness on a 1 to 5 scale."""
    if data.score < 1 or data.score > 5:
        raise HTTPException(status_code=400, detail="Wakefulness scale must be between 1 and 5")

    log = None
    if data.log_id:
        log = db.query(ChallengeLog).filter(ChallengeLog.id == data.log_id).first()
    elif data.user_id:
        log = db.query(ChallengeLog).filter(ChallengeLog.user_id == data.user_id).order_by(ChallengeLog.created_at.desc()).first()
    else:
        log = db.query(ChallengeLog).order_by(ChallengeLog.created_at.desc()).first()

    if not log:
        raise HTTPException(status_code=404, detail="Challenge log not found to associate wakefulness score")

    log.wakefulness_score = data.score
    db.commit()
    db.refresh(log)

    scale_labels = {
        1: "Very Drowsy 😴",
        2: "Somewhat Sleepy 🥱",
        3: "Moderately Awake 😐",
        4: "Mostly Alert 🙂",
        5: "Fully Energized ⚡"
    }

    return {
        "success": True,
        "log_id": log.id,
        "wakefulness_score": log.wakefulness_score,
        "label": scale_labels.get(log.wakefulness_score, "Awake"),
        "message": f"Recorded wakefulness rating: {log.wakefulness_score}/5 ({scale_labels.get(log.wakefulness_score, '')})"
    }


@app.get("/challenges/personalized/{user_id}", response_model=ChallengeResponse)
def get_personalized_challenge(user_id: int, type: str = "math", db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Personalized Challenge Selection algorithm based on user history in DB:
    - Previous performance (accuracy %, total score)
    - Average time taken
    - Difficulty level completed
    - Frustration prevention auto-softening (2 consecutive fails -> step down difficulty)
    Adaptive Rule: High performance (>80% accuracy) -> Level Up. Low performance (<40% accuracy) -> Level Down."""
    if user_id != current_user.id and current_user.role not in ("admin", "wellness_coach"):
        raise HTTPException(status_code=403, detail="Access denied")

    logs = db.query(ChallengeLog).filter(ChallengeLog.user_id == user_id).order_by(ChallengeLog.created_at.desc()).limit(10).all()
    
    levels = ["beginner", "easy", "medium", "hard", "expert"]
    target_difficulty = "medium"
    
    if logs:
        total = len(logs)
        success_count = sum(1 for l in logs if l.success)
        accuracy = (success_count / total) * 100
        recent_difficulty = logs[0].difficulty if logs[0].difficulty in levels else "medium"
        curr_idx = levels.index(recent_difficulty)
        
        # Frustration Prevention Auto-Softening Check
        consecutive_fails = 0
        for l in logs[:2]:
            if not l.success:
                consecutive_fails += 1
        
        if consecutive_fails >= 2:
            # Auto-soften difficulty to prevent frustration & save streak
            target_difficulty = levels[max(curr_idx - 1, 0)]
        elif accuracy >= 80 and total >= 3:
            target_difficulty = levels[min(curr_idx + 1, len(levels) - 1)]
        elif accuracy <= 40 and total >= 3:
            target_difficulty = levels[max(curr_idx - 1, 0)]
        else:
            target_difficulty = recent_difficulty

    return generate_cognitive_challenge(challenge_type=type, difficulty=target_difficulty)


@app.get("/achievements/{user_id}", response_model=List[AchievementItem])
def get_user_achievements(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Gamified Achievements & Badges Evaluation Engine."""
    if user_id != current_user.id and current_user.role not in ("admin", "wellness_coach"):
        raise HTTPException(status_code=403, detail="Access denied")
    from datetime import datetime
    logs = db.query(ChallengeLog).filter(ChallengeLog.user_id == user_id).order_by(ChallengeLog.created_at.desc()).all()

    total_attempts = len(logs)
    successes = sum(1 for l in logs if l.success)
    total_score = sum(l.score for l in logs)
    
    # Fast solve check
    fastest_time = min([l.time_taken_seconds for l in logs if l.success], default=999.0)
    
    # 5-day streak calculation
    successful_dates = sorted(list(set(l.created_at.date() for l in logs if l.success)), reverse=True)
    streak = 0
    if successful_dates:
        from datetime import datetime
        today = datetime.now().date()
        if (today - successful_dates[0]).days <= 1:
            streak = 1
            for i in range(1, len(successful_dates)):
                if (successful_dates[i-1] - successful_dates[i]).days == 1:
                    streak += 1
                else:
                    break

    # Early bird count (wake up challenges solved before 7 AM)
    early_bird_count = sum(1 for l in logs if l.success and l.created_at and l.created_at.hour < 7)

    # Master logic solver check (logic/math accuracy)
    logic_math_logs = [l for l in logs if (l.challenge_type or "").lower() in ["logic", "math"]]
    logic_math_success = sum(1 for l in logic_math_logs if l.success)

    badges_def = [
        {
            "badge_key": "early_bird",
            "title": "Early Bird",
            "description": "Solve 3 alarm challenges before 7:00 AM",
            "icon": "🌅",
            "unlocked": early_bird_count >= 3,
            "progress_percent": min(100, int((early_bird_count / 3) * 100))
        },
        {
            "badge_key": "streak_master",
            "title": "Streak Master",
            "description": "Maintain a 5-day wake-up challenge streak",
            "icon": "🔥",
            "unlocked": streak >= 5,
            "progress_percent": min(100, int((streak / 5) * 100))
        },
        {
            "badge_key": "speed_demon",
            "title": "Speed Demon",
            "description": "Solve a cognitive challenge in under 10 seconds",
            "icon": "⚡",
            "unlocked": fastest_time <= 10.0 and total_attempts > 0,
            "progress_percent": 100 if fastest_time <= 10.0 and total_attempts > 0 else (50 if fastest_time <= 20.0 else 20)
        },
        {
            "badge_key": "logic_virtuoso",
            "title": "Logic Virtuoso",
            "description": "Solve 5 Math or Logic puzzles successfully",
            "icon": "🧩",
            "unlocked": logic_math_success >= 5,
            "progress_percent": min(100, int((logic_math_success / 5) * 100))
        },
        {
            "badge_key": "cognitive_master",
            "title": "Cognitive Master",
            "description": "Accumulate over 500 total performance points",
            "icon": "🧠",
            "unlocked": total_score >= 500,
            "progress_percent": min(100, int((total_score / 500) * 100))
        }
    ]

    result = []
    for b in badges_def:
        result.append(AchievementItem(
            badge_key=b["badge_key"],
            title=b["title"],
            description=b["description"],
            icon=b["icon"],
            unlocked=b["unlocked"],
            progress_percent=b["progress_percent"],
            unlocked_at=str(datetime.now()) if b["unlocked"] else None
        ))

    return result


@app.get("/challenges/trends/{user_id}", response_model=LearningTrendResponse)
def get_learning_trends(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Advanced Learning Pattern & Trend Analysis Endpoint."""
    if user_id != current_user.id and current_user.role not in ("admin", "wellness_coach"):
        raise HTTPException(status_code=403, detail="Access denied")
    from datetime import datetime, timedelta

    logs = db.query(ChallengeLog).filter(ChallengeLog.user_id == user_id).order_by(ChallengeLog.created_at.asc()).all()

    if not logs:
        return LearningTrendResponse(
            user_id=user_id,
            growth_rate_percent=0.0,
            speed_improvement_percent=0.0,
            category_balance={"math": 0, "memory": 0, "logic": 0, "speed": 0},
            strongest_domain="N/A",
            focus_domain="All",
            recommendation="Solve your first morning alarm challenge to build your personalized cognitive growth profile!",
            weekly_velocity=[
                {"week": "W1", "accuracy": 0, "speed_avg": 0.0},
                {"week": "W2", "accuracy": 0, "speed_avg": 0.0},
                {"week": "W3", "accuracy": 0, "speed_avg": 0.0},
                {"week": "W4", "accuracy": 0, "speed_avg": 0.0}
            ]
        )

    # Category performance breakdown with sub-type mapping
    def map_category(raw_type: str) -> str:
        t = (raw_type or "math").lower()
        if t in ["math"]:
            return "math"
        elif t in ["memory"]:
            return "memory"
        elif t in ["logic", "pattern"]:
            return "logic"
        else: # word, riddle, quiz, speed
            return "speed"

    cat_counts = {"math": 0, "memory": 0, "logic": 0, "speed": 0}
    cat_success = {"math": 0, "memory": 0, "logic": 0, "speed": 0}

    for l in logs:
        c = map_category(l.challenge_type)
        cat_counts[c] += 1
        if l.success:
            cat_success[c] += 1

    cat_balance = {}
    for k in ["math", "memory", "logic", "speed"]:
        if cat_counts[k] > 0:
            cat_balance[k] = round((cat_success[k] / cat_counts[k]) * 100)
        else:
            cat_balance[k] = 0

    # Strongest vs Focus Domain
    sorted_cats = sorted(cat_balance.items(), key=lambda x: x[1], reverse=True)
    strongest = sorted_cats[0][0].capitalize() if sorted_cats and sorted_cats[0][1] > 0 else "Math"
    focus = sorted_cats[-1][0].capitalize() if sorted_cats else "Memory"

    # Overall growth & speed trends
    total = len(logs)
    if total < 4:
        recent_acc = (sum(1 for l in logs if l.success) / total) * 100
        growth = round(recent_acc, 1)
        older_speed = sum(l.time_taken_seconds for l in logs) / total
        speed_imp = round(max(0.0, ((30.0 - older_speed) / 30.0) * 100), 1)
    else:
        recent_half = logs[max(0, total // 2):]
        older_half = logs[:max(1, total // 2)]
        recent_acc = (sum(1 for l in recent_half if l.success) / max(1, len(recent_half))) * 100
        older_acc = (sum(1 for l in older_half if l.success) / max(1, len(older_half))) * 100
        growth = round(recent_acc - older_acc, 1)
        recent_speed = sum(l.time_taken_seconds for l in recent_half) / max(1, len(recent_half))
        older_speed = sum(l.time_taken_seconds for l in older_half) / max(1, len(older_half))
        
        if older_speed > 0 and older_speed > recent_speed:
            speed_imp = round(((older_speed - recent_speed) / older_speed) * 100, 1)
        elif recent_speed > 0 and recent_speed <= 30.0:
            # Baseline speed boost vs 30s benchmark when recent solves are fast
            speed_imp = round(max(0.0, ((30.0 - recent_speed) / 30.0) * 100), 1)
        else:
            speed_imp = 0.0

    rec_msg = f"Your highest cognitive sharpness is in {strongest}. Focus on {focus} challenges to maintain balanced neural agility."

    weekly_velocity = [
        {"week": "W1", "accuracy": int(growth * 0.8), "speed_avg": round(older_speed, 1)},
        {"week": "W2", "accuracy": int(growth), "speed_avg": round(older_speed, 1)},
        {"week": "W3", "accuracy": int(growth), "speed_avg": round(older_speed, 1)},
        {"week": "W4", "accuracy": int(growth), "speed_avg": round(older_speed, 1)}
    ]

    return LearningTrendResponse(
        user_id=user_id,
        growth_rate_percent=growth if growth > 0 else 0.0,
        speed_improvement_percent=speed_imp if speed_imp > 0 else 0.0,
        category_balance=cat_balance,
        strongest_domain=strongest,
        focus_domain=focus,
        recommendation=rec_msg,
        weekly_velocity=weekly_velocity
    )


@app.get("/challenges/performance/{user_id}")
def get_user_performance(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Returns analytics for Dashboard Challenge Performance Card, Streak & Pie Chart."""
    if user_id != current_user.id and current_user.role not in ("admin", "wellness_coach"):
        raise HTTPException(status_code=403, detail="Access denied")
    from datetime import datetime, timedelta

    logs = db.query(ChallengeLog).filter(ChallengeLog.user_id == user_id).order_by(ChallengeLog.created_at.desc()).all()
    
    if not logs:
        return {
            "total_attempts": 0,
            "success_rate": 0,
            "total_score": 0,
            "avg_time_seconds": 0,
            "recommended_difficulty": "medium",
            "categories": {"math": 0, "memory": 0, "logic": 0, "speed": 0},
            "recent_logs": [],
            "day_streak": 0,
            "breakdown": {"on_time": 0, "snoozed": 0, "failed": 0},
            "wakeup_stats": {
                "sleep_score": 88,
                "avg_wakeup_time": "06:45 AM",
                "wakeup_consistency": "Excellent",
                "avg_sleep_duration": "7h 42m"
            }
        }
    
    total = len(logs)
    successes = sum(1 for l in logs if l.success)
    accuracy = round((successes / total) * 100, 1)
    total_score = sum(l.score for l in logs)
    avg_time = round(sum(l.time_taken_seconds for l in logs) / total, 1)

    # Calculate streak (consecutive days with successful alarm challenge logs)
    successful_dates = sorted(list(set(l.created_at.date() for l in logs if l.success)), reverse=True)
    streak = 0
    if successful_dates:
        today = datetime.now().date()
        curr = successful_dates[0]
        if (today - curr).days <= 1:
            streak = 1
            for i in range(1, len(successful_dates)):
                if (successful_dates[i-1] - successful_dates[i]).days == 1:
                    streak += 1
                else:
                    break

    # Calculate Breakdown for Pie Chart
    on_time = sum(1 for l in logs if l.success and (l.time_taken_seconds or 0) <= 15)
    snoozed = sum(1 for l in logs if l.success and (l.time_taken_seconds or 0) > 15)
    failed = sum(1 for l in logs if not l.success)
    breakdown = {"on_time": on_time, "snoozed": snoozed, "failed": failed}

    # Category breakdown stats
    cat_counts = {"math": 0, "memory": 0, "logic": 0, "speed": 0}
    cat_successes = {"math": 0, "memory": 0, "logic": 0, "speed": 0}

    for l in logs:
        ctype = (l.challenge_type or "math").lower()
        if ctype in ["math", "memory", "logic"]:
            cat_key = ctype
        else:
            cat_key = "speed"
        cat_counts[cat_key] += 1
        if l.success:
            cat_successes[cat_key] += 1

    categories = {}
    for k in cat_counts:
        if cat_counts[k] > 0:
            categories[k] = round((cat_successes[k] / cat_counts[k]) * 100)
        else:
            categories[k] = 0
    
    levels = ["beginner", "easy", "medium", "hard", "expert"]
    recent_diff = logs[0].difficulty if logs[0].difficulty in levels else "medium"
    curr_idx = levels.index(recent_diff)
    
    if accuracy >= 80 and total >= 3:
        recommended = levels[min(curr_idx + 1, len(levels) - 1)]
    elif accuracy <= 40 and total >= 3:
        recommended = levels[max(curr_idx - 1, 0)]
    else:
        recommended = recent_diff

    # Dynamic Productivity Insights calculation based on user logs
    wake_hours = [l.created_at.hour + (l.created_at.minute / 60.0) for l in logs if l.created_at]
    avg_hour = (sum(wake_hours) / len(wake_hours)) if wake_hours else 7.5
    
    peak_start_m = int((avg_hour * 60 + 30) % 1440)
    peak_end_m = int((avg_hour * 60 + 120) % 1440)
    
    def fmt_m(m):
        h = (m // 60) % 24
        mins = m % 60
        period = "AM" if h < 12 else "PM"
        disp_h = h % 12 or 12
        return f"{disp_h}:{mins:02d} {period}"

    peak_start_str = fmt_m(peak_start_m)
    peak_end_str = fmt_m(peak_end_m)
    
    insights = {
        "peak_window": f"Peak: {peak_start_str} - {peak_end_str}",
        "clarity_pill": f"{int(max(8, avg_time))} SEC AVG",
        "clarity_desc": f"Your average cognitive response speed is {avg_time}s after alarm trigger.",
        "synergy_pill": f"+{int(min(40, accuracy * 0.25))}% SPEED",
        "synergy_desc": f"Maintaining a {accuracy}% success rate boosts overall daily focus and alertness."
    }

    # Calculate Wake-up Statistics
    sleep_score = min(98, max(65, int(75 + min(12, streak * 2) + (accuracy * 0.15) - min(10, avg_time * 0.2))))
    
    avg_wakeup_time = "06:45 AM"
    if wake_hours:
        avg_h_m = int(avg_hour * 60)
        avg_wakeup_time = fmt_m(avg_h_m)

    consistency = "Excellent" if (accuracy >= 75 and streak >= 2) else ("Good" if accuracy >= 50 else "Improving")

    scale_labels = {
        1: "Very Drowsy 😴",
        2: "Somewhat Sleepy 🥱",
        3: "Moderately Awake 😐",
        4: "Mostly Alert 🙂",
        5: "Fully Energized ⚡"
    }

    # Calculate Wakefulness Rating Stats
    wakefulness_scores = [l.wakefulness_score for l in logs if l.wakefulness_score is not None]
    avg_wakefulness = round(sum(wakefulness_scores) / len(wakefulness_scores), 1) if wakefulness_scores else 4.0
    rounded_wake_score = int(round(avg_wakefulness))
    wakefulness_label = scale_labels.get(rounded_wake_score, "Mostly Alert 🙂")

    wakeup_stats = {
        "sleep_score": sleep_score,
        "avg_wakeup_time": avg_wakeup_time,
        "wakeup_consistency": consistency,
        "avg_sleep_duration": "7h 42m",
        "avg_wakefulness_score": avg_wakefulness,
        "wakefulness_label": wakefulness_label
    }

    return {
        "total_attempts": total,
        "success_rate": accuracy,
        "total_score": total_score,
        "avg_time_seconds": avg_time,
        "recommended_difficulty": recommended,
        "categories": categories,
        "day_streak": max(1, streak),
        "breakdown": breakdown,
        "insights": insights,
        "wakeup_stats": wakeup_stats,
        "recent_logs": [
            {
                "id": l.id,
                "type": l.challenge_type,
                "difficulty": l.difficulty,
                "success": l.success,
                "score": l.score,
                "time_taken": l.time_taken_seconds,
                "wakefulness_score": l.wakefulness_score,
                "wakefulness_label": scale_labels.get(l.wakefulness_score, "N/A") if l.wakefulness_score else "N/A",
                "timestamp": str(l.created_at)
            } for l in logs[:5]
        ]
    }


@app.get("/challenges/history")
def get_challenge_history(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # Always scope to the authenticated user; admins may pass an optional override via query param
    user_id = current_user.id
    query = db.query(ChallengeLog).filter(ChallengeLog.user_id == user_id)
    
    logs = query.order_by(ChallengeLog.created_at.desc()).limit(30).all()
    
    scale_labels = {
        1: "Very Drowsy 😴",
        2: "Somewhat Sleepy 🥱",
        3: "Moderately Awake 😐",
        4: "Mostly Alert 🙂",
        5: "Fully Energized ⚡"
    }

    result = []
    for l in logs:
        alarm_label = "Cognitive Alarm"
        set_time_str = "07:00 AM"
        if l.alarm_id:
            alarm = db.query(Alarm).filter(Alarm.id == l.alarm_id).first()
            if alarm:
                alarm_label = alarm.title or "Morning Alarm"
                if alarm.alarm_time:
                    set_time_str = alarm.alarm_time.strftime("%I:%M %p")

        created_dt = l.created_at or datetime.now()
        date_str = created_dt.strftime("%d %b %Y")
        dismiss_time_str = created_dt.strftime("%I:%M:%S %p")
        delay_val = round(l.time_taken_seconds, 1) if l.time_taken_seconds else 0.0
        delay_str = f"{delay_val}s"
        
        ctype = (l.challenge_type or "Math").title()
        cdiff = (l.difficulty or "Medium").title()

        result.append({
            "id": l.id,
            "date": date_str,
            "set_time": set_time_str,
            "label": alarm_label,
            "alarm_type": ctype,
            "dismiss_time": dismiss_time_str,
            "delay": delay_str,
            "puzzle_solved": f"{ctype} · {cdiff}",
            "success": l.success,
            "status": "Solved" if l.success else "Failed",
            "score": l.score,
            "wakefulness_score": l.wakefulness_score,
            "wakefulness_label": scale_labels.get(l.wakefulness_score, "N/A") if l.wakefulness_score else "N/A",
            "timestamp": str(l.created_at)
        })
    return result


# ══════════════════════════════════════════════════════════════
#  BEHAVIORAL ANALYTICS ENGINE
# ══════════════════════════════════════════════════════════════

@app.get("/analytics/behavioral/{user_id}", response_model=BehavioralAnalyticsResponse)
def get_behavioral_analytics(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    Behavioral Analytics Engine Endpoint.
    Analyzes circadian rhythm variance, snooze habits, sleep inertia latency,
    predictive wakefulness forecasting, and provides targeted AI behavioral nudges.
    """
    if user_id != current_user.id and current_user.role not in ("admin", "wellness_coach"):
        raise HTTPException(status_code=403, detail="Access denied")
    logs = db.query(ChallengeLog).filter(ChallengeLog.user_id == user_id).order_by(ChallengeLog.created_at.desc()).all()

    # Default fallback data if no logs available
    if not logs:
        return BehavioralAnalyticsResponse(
            user_id=user_id,
            circadian_consistency={
                "consistency_score": 88,
                "wake_variance_minutes": 12.5,
                "rhythm_stability": "High Stability"
            },
            snooze_profile={
                "snooze_frequency_percent": 15.0,
                "avg_snoozes_per_alarm": 0.4,
                "snooze_risk_level": "Low",
                "risk_badge_color": "#10b981",
                "peak_snooze_day": "Monday",
                "avg_snooze_delay_minutes": 5.0,
                "habitual_pattern": "Low Dependency"
            },
            snooze_pattern_analysis={
                "snooze_rate_pct": 15.0,
                "primary_snooze_trigger": "Habitual Micro-Delay",
                "peak_snooze_day": "Monday",
                "avg_delay_mins": 5.0,
                "relapse_probability_pct": 18,
                "pattern_summary": "Minimal Snooze Dependency (15.0% rate, peak on Monday)",
                "daily_snooze_trend": [
                    {"day": "Mon", "snoozes": 2.5, "delay_mins": 12.5},
                    {"day": "Tue", "snoozes": 1.8, "delay_mins": 9.0},
                    {"day": "Wed", "snoozes": 0.8, "delay_mins": 4.0},
                    {"day": "Thu", "snoozes": 0.4, "delay_mins": 2.0},
                    {"day": "Fri", "snoozes": 0.6, "delay_mins": 3.0},
                    {"day": "Sat", "snoozes": 1.5, "delay_mins": 7.5},
                    {"day": "Sun", "snoozes": 2.0, "delay_mins": 10.0}
                ]
            },
            sleep_inertia={
                "inertia_index_seconds": 18.2,
                "warmup_rate_percent": 78.5,
                "peak_alertness_window": "07:15 AM - 07:45 AM"
            },
            predictive_forecast={
                "predicted_wakefulness_score": 4.2,
                "forecast_label": "High Alertness Expected 🙂",
                "confidence_percent": 88
            },
            behavioral_nudges=[
                "Maintain your current consistent wake time to solidify your circadian rhythm.",
                "Your morning cognitive response speed is optimal. Try increasing puzzle difficulty to Level Hard.",
                "Zero snooze dependencies detected in recent sessions—excellent wakefulness momentum!"
            ]
        )

    # 1. Circadian Consistency Calculation
    wake_times = [l.created_at for l in logs if l.created_at]
    wake_minutes_of_day = [t.hour * 60 + t.minute for t in wake_times]
    
    if len(wake_minutes_of_day) > 1:
        avg_min = sum(wake_minutes_of_day) / len(wake_minutes_of_day)
        variance = (sum((m - avg_min) ** 2 for m in wake_minutes_of_day) / len(wake_minutes_of_day)) ** 0.5
    else:
        variance = 10.0
    
    wake_variance_min = round(min(120.0, variance), 1)
    consistency_score = int(max(30, min(100, 100 - (wake_variance_min * 0.8))))
    rhythm_stability = "High Stability" if consistency_score >= 80 else ("Moderate Rhythm" if consistency_score >= 60 else "Irregular Pattern")

    # 2. Snooze Profile & Risk Index
    total_logs = len(logs)
    snoozed_logs = [l for l in logs if (l.time_taken_seconds or 0) > 15.0]
    snooze_freq_pct = round((len(snoozed_logs) / total_logs) * 100, 1) if total_logs > 0 else 0.0
    avg_snoozes = round(snooze_freq_pct / 50.0, 1)

    if snooze_freq_pct < 25.0:
        snooze_risk = "Low"
        badge_color = "#10b981" # green
    elif snooze_freq_pct < 55.0:
        snooze_risk = "Moderate"
        badge_color = "#f59e0b" # amber
    else:
        snooze_risk = "High"
        badge_color = "#ef4444" # red

    # Calculate Snooze Pattern Breakdown
    days_map = {0: "Monday", 1: "Tuesday", 2: "Wednesday", 3: "Thursday", 4: "Friday", 5: "Saturday", 6: "Sunday"}
    day_counts = {}
    for l in snoozed_logs:
        if l.created_at:
            day_name = days_map[l.created_at.weekday()]
            day_counts[day_name] = day_counts.get(day_name, 0) + 1
    
    peak_snooze_day = max(day_counts, key=day_counts.get) if day_counts else "Monday"
    relapse_prob = int(min(95, max(10, snooze_freq_pct * 1.2)))
    pattern_summary = (
        f"High Snooze Relapse ({snooze_freq_pct}% rate, peak on {peak_snooze_day})" if snooze_freq_pct >= 40 
        else f"Minimal Snooze Dependency ({snooze_freq_pct}% rate, peak on {peak_snooze_day})"
    )

    days_short = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    days_map_short = {0: "Mon", 1: "Tue", 2: "Wed", 3: "Thu", 4: "Fri", 5: "Sat", 6: "Sun"}
    day_snooze_map = {d: 0.0 for d in days_short}
    if snoozed_logs:
        for l in snoozed_logs:
            if l.created_at:
                ds = days_map_short[l.created_at.weekday()]
                day_snooze_map[ds] += 1.0
    else:
        day_snooze_map = {"Mon": 2.5, "Tue": 1.8, "Wed": 0.8, "Thu": 0.4, "Fri": 0.6, "Sat": 1.5, "Sun": 2.0}

    daily_snooze_trend = [
        {"day": d, "snoozes": round(day_snooze_map[d], 1), "delay_mins": round(day_snooze_map[d] * 5.0, 1)}
        for d in days_short
    ]

    snooze_pattern = {
        "snooze_rate_pct": snooze_freq_pct,
        "primary_snooze_trigger": "Morning Sleep Inertia" if (sum([l.time_taken_seconds or 0 for l in logs]) / (total_logs or 1)) > 20 else "Habitual Micro-Delay",
        "peak_snooze_day": peak_snooze_day,
        "avg_delay_mins": round(avg_snoozes * 5.0, 1),
        "relapse_probability_pct": relapse_prob,
        "pattern_summary": pattern_summary,
        "daily_snooze_trend": daily_snooze_trend
    }

    # 3. Sleep Inertia Curve & Warmup Rate
    times = [l.time_taken_seconds for l in logs if l.time_taken_seconds and l.time_taken_seconds > 0]
    avg_latency = round(sum(times) / len(times), 1) if times else 15.0
    warmup_rate = round(max(20.0, min(99.0, 100.0 - (avg_latency * 1.5))), 1)
    
    avg_wake_m = int(sum(wake_minutes_of_day) / len(wake_minutes_of_day)) if wake_minutes_of_day else 420
    peak_start = (avg_wake_m + 30) % 1440
    peak_end = (avg_wake_m + 75) % 1440
    def fmt_time(m):
        h = (m // 60) % 24
        mins = m % 60
        period = "AM" if h < 12 else "PM"
        dh = h % 12 or 12
        return f"{dh}:{mins:02d} {period}"
    peak_window = f"{fmt_time(peak_start)} - {fmt_time(peak_end)}"

    # 4. Predictive Wakefulness Forecast
    recent_wake_scores = [l.wakefulness_score for l in logs if l.wakefulness_score is not None]
    if recent_wake_scores:
        avg_wake_rating = sum(recent_wake_scores) / len(recent_wake_scores)
    else:
        avg_wake_rating = 4.0
    
    success_rate = (sum(1 for l in logs if l.success) / total_logs) if total_logs > 0 else 0.8
    pred_score = round(min(5.0, max(1.0, (avg_wake_rating * 0.5) + (success_rate * 2.0) + ((100 - snooze_freq_pct) * 0.005))), 1)

    if pred_score >= 4.2:
        forecast_label = "Optimal Energy & High Alertness ⚡"
    elif pred_score >= 3.2:
        forecast_label = "Moderate Alertness Expected 🙂"
    else:
        forecast_label = "Sleep Inertia Risk Warning 🥱"

    confidence_pct = min(96, max(65, 60 + (total_logs * 3)))

    # 5. Targeted AI Behavioral Nudges
    nudges = []
    if snooze_risk in ["High", "Moderate"]:
        nudges.append(f"Snooze Dependency Detected ({snooze_freq_pct}% snooze rate on {peak_snooze_day}s). Try enabling Multi-Step 3-Question cognitive verification to eliminate snooze relapses.")
    else:
        nudges.append("Zero snooze relapse observed in recent sessions—your wake-up discipline is strong!")

    if wake_variance_min > 25.0:
        nudges.append(f"Wake-up variance is ±{wake_variance_min} minutes. Aligning weekend wake times within 15 mins will improve your Circadian Consistency Score.")
    else:
        nudges.append(f"Excellent circadian alignment! Your wake-up time variance is low (±{wake_variance_min} mins).")

    if avg_latency > 25.0:
        nudges.append(f"Morning Sleep Inertia is elevated ({avg_latency}s initial latency). Consider switching your primary challenge to Word or Logic puzzles for faster brain activation.")
    else:
        nudges.append(f"Fast cognitive reaction speed detected ({avg_latency}s average latency). Peak sharpness achieved rapidly!")

    return BehavioralAnalyticsResponse(
        user_id=user_id,
        circadian_consistency={
            "consistency_score": consistency_score,
            "wake_variance_minutes": wake_variance_min,
            "rhythm_stability": rhythm_stability
        },
        snooze_profile={
            "snooze_frequency_percent": snooze_freq_pct,
            "avg_snoozes_per_alarm": avg_snoozes,
            "snooze_risk_level": snooze_risk,
            "risk_badge_color": badge_color,
            "peak_snooze_day": peak_snooze_day,
            "avg_snooze_delay_minutes": round(avg_snoozes * 5.0, 1),
            "habitual_pattern": "Snooze Habit Risk" if snooze_risk == "High" else "Low Dependency"
        },
        snooze_pattern_analysis=snooze_pattern,
        sleep_inertia={
            "inertia_index_seconds": avg_latency,
            "warmup_rate_percent": warmup_rate,
            "peak_alertness_window": peak_window
        },
        predictive_forecast={
            "predicted_wakefulness_score": pred_score,
            "forecast_label": forecast_label,
            "confidence_percent": confidence_pct
        },
        behavioral_nudges=nudges
    )


# ══════════════════════════════════════════════════════════════
#  HABIT ADHERENCE SCORING
# ══════════════════════════════════════════════════════════════

class HabitLogRequest(BaseModel):
    user_id:    int
    habit_name: str
    completed:  bool


@app.post("/habits/log")
def log_habit(data: HabitLogRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Save or update today's habit completion state for a user."""
    if data.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Cannot log habits for another user")
    from datetime import date as dt_date
    from sqlalchemy import cast, Date as SADate

    today = dt_date.today()
    existing = db.query(HabitLog).filter(
        HabitLog.user_id    == data.user_id,
        HabitLog.habit_name == data.habit_name,
        cast(HabitLog.log_date, SADate) == today
    ).first()

    if existing:
        existing.completed = data.completed
    else:
        existing = HabitLog(
            user_id=data.user_id,
            habit_name=data.habit_name,
            completed=data.completed
        )
        db.add(existing)

    db.commit()
    db.refresh(existing)
    return {"success": True, "habit": data.habit_name, "completed": data.completed}


@app.get("/habits/{user_id}")
def get_habit_adherence(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Returns today's habit state + 7-day adherence score for the user."""
    if user_id != current_user.id and current_user.role not in ("admin", "wellness_coach"):
        raise HTTPException(status_code=403, detail="Access denied")
    from datetime import date as dt_date, timedelta
    from sqlalchemy import cast, Date as SADate

    today = dt_date.today()

    # Today's habits
    today_logs = db.query(HabitLog).filter(
        HabitLog.user_id == user_id,
        cast(HabitLog.log_date, SADate) == today
    ).all()

    today_state = {log.habit_name: log.completed for log in today_logs}

    # 7-day adherence
    seven_days_ago = today - timedelta(days=7)
    week_logs = db.query(HabitLog).filter(
        HabitLog.user_id == user_id,
        cast(HabitLog.log_date, SADate) >= seven_days_ago,
        HabitLog.completed == True
    ).all()

    # Group by date to calculate daily completion
    from collections import defaultdict
    days_with_completions = defaultdict(int)
    for log in week_logs:
        day = log.log_date.date() if hasattr(log.log_date, 'date') else log.log_date
        days_with_completions[str(day)] += 1

    days_any_completed = len(days_with_completions)
    adherence_pct = round((days_any_completed / 7) * 100)

    total_completed_today = sum(1 for v in today_state.values() if v)

    return {
        "user_id":          user_id,
        "today":            str(today),
        "today_state":      today_state,
        "completed_today":  total_completed_today,
        "adherence_7day_pct": adherence_pct,
        "days_active":      days_any_completed
    }


# ══════════════════════════════════════════════════════════════
#  ALARM LOG — dismiss tracking for Sleep Routine Scoring
# ══════════════════════════════════════════════════════════════

class AlarmDismissRequest(BaseModel):
    alarm_id:      Optional[int] = None
    user_id:       int
    puzzle_solved: bool = True
    delay_seconds: int  = 0


@app.post("/alarm-logs/dismiss")
def log_alarm_dismiss(data: AlarmDismissRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Called when user completes challenge and exits alarm modal."""
    if data.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Cannot log dismiss for another user")
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    status = "on_time" if data.delay_seconds < 120 else "delayed"

    log = AlarmLog(
        alarm_id=data.alarm_id,
        user_id=data.user_id,
        triggered_at=now,
        dismissed_at=now,
        status=status,
        delay_seconds=data.delay_seconds,
        puzzle_solved=data.puzzle_solved
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return {"success": True, "log_id": log.id, "status": status}


# ══════════════════════════════════════════════════════════════
#  CHALLENGE COMPLETION SCORING
# ══════════════════════════════════════════════════════════════

@app.get("/scoring/challenge/{user_id}")
def get_challenge_score(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Challenge Completion Score — based on accuracy, speed, difficulty."""
    if user_id != current_user.id and current_user.role not in ("admin", "wellness_coach"):
        raise HTTPException(status_code=403, detail="Access denied")
    logs = db.query(ChallengeLog).filter(ChallengeLog.user_id == user_id).all()
    if not logs:
        return {"score": 0, "grade": "N/A", "total_attempts": 0,
                "success_rate": 0, "total_points": 0, "avg_speed": 0}

    total       = len(logs)
    successes   = sum(1 for l in logs if l.success)
    total_pts   = sum(l.score for l in logs)
    avg_speed   = round(sum(l.time_taken_seconds for l in logs) / total, 1)
    accuracy    = round((successes / total) * 100, 1)

    # Difficulty weight bonus
    diff_weights = {"beginner": 0.5, "easy": 0.8, "medium": 1.0, "hard": 1.3, "expert": 1.6}
    weighted_pts = sum(
        l.score * diff_weights.get(l.difficulty or "medium", 1.0)
        for l in logs if l.success
    )
    challenge_score = min(100, round((accuracy * 0.5) + (min(weighted_pts, 5000) / 50)))

    grade = (
        "S" if challenge_score >= 90 else
        "A" if challenge_score >= 75 else
        "B" if challenge_score >= 60 else
        "C" if challenge_score >= 45 else "D"
    )

    return {
        "score":          challenge_score,
        "grade":          grade,
        "total_attempts": total,
        "success_rate":   accuracy,
        "total_points":   total_pts,
        "avg_speed":      avg_speed,
        "label":          f"Challenge Score: {challenge_score}/100 (Grade {grade})"
    }


# ══════════════════════════════════════════════════════════════
#  SLEEP ROUTINE SCORING
# ══════════════════════════════════════════════════════════════

@app.get("/scoring/sleep/{user_id}")
def get_sleep_score(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Sleep Routine Score — based on alarm dismiss history."""
    if user_id != current_user.id and current_user.role not in ("admin", "wellness_coach"):
        raise HTTPException(status_code=403, detail="Access denied")
    logs = db.query(AlarmLog).filter(AlarmLog.user_id == user_id).all()

    if not logs:
        return {
            "score": 50, "grade": "C",
            "on_time_pct": 0, "snooze_pct": 0, "puzzle_solved_pct": 0,
            "label": "No alarm history yet — score starts at 50"
        }

    total           = len(logs)
    on_time         = sum(1 for l in logs if l.status == "on_time")
    solved          = sum(1 for l in logs if l.puzzle_solved)
    avg_delay       = round(sum(l.delay_seconds or 0 for l in logs) / total)
    on_time_pct     = round((on_time / total) * 100)
    solved_pct      = round((solved / total) * 100)

    # Score formula
    delay_penalty   = min(30, avg_delay // 60)   # each minute of avg delay = -1 pt (max -30)
    sleep_score     = max(0, min(100,
        (on_time_pct * 0.5) + (solved_pct * 0.3) + 20 - delay_penalty
    ))
    sleep_score     = round(sleep_score)

    grade = (
        "S" if sleep_score >= 90 else
        "A" if sleep_score >= 75 else
        "B" if sleep_score >= 60 else
        "C" if sleep_score >= 45 else "D"
    )

    return {
        "score":             sleep_score,
        "grade":             grade,
        "on_time_pct":       on_time_pct,
        "puzzle_solved_pct": solved_pct,
        "avg_delay_seconds": avg_delay,
        "total_alarms":      total,
        "label":             f"Sleep Score: {sleep_score}/100 (Grade {grade})"
    }


# ══════════════════════════════════════════════════════════════
#  HABIT SCORE  (Weighted Scoring Model)
#  Wake-Up Consistency        35 %
#  Challenge Completion       25 %
#  Snooze Reduction           20 %
#  Sleep Schedule Adherence   20 %
# ══════════════════════════════════════════════════════════════

@app.get("/scoring/habit/{user_id}")
def get_habit_score(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    Weighted Habit Score model:
      Wake-Up Consistency      35%  — circadian variance & on-time alarm dismissals
      Challenge Completion     25%  — challenge success rate from ChallengeLog
      Snooze Reduction         20%  — inverse of snooze frequency
      Sleep Schedule Adherence 20%  — on-time alarm log rate + habit adherence
    """
    if user_id != current_user.id and current_user.role not in ("admin", "wellness_coach"):
        raise HTTPException(status_code=403, detail="Access denied")
    from datetime import datetime

    challenge_logs = db.query(ChallengeLog).filter(ChallengeLog.user_id == user_id).all()
    alarm_logs     = db.query(AlarmLog).filter(AlarmLog.user_id == user_id).all()
    habit_logs     = db.query(HabitLog).filter(HabitLog.user_id == user_id).all()

    # ── 1. Wake-Up Consistency (35%) ─────────────────────────
    # Based on circadian variance of challenge solve timestamps
    wake_times = [l.created_at for l in challenge_logs if l.created_at]
    if len(wake_times) > 1:
        wake_mins = [t.hour * 60 + t.minute for t in wake_times]
        avg_m = sum(wake_mins) / len(wake_mins)
        variance = (sum((m - avg_m) ** 2 for m in wake_mins) / len(wake_mins)) ** 0.5
        # Max variance ~60 min = 0, min variance = 100
        wakeup_consistency_score = max(0.0, min(100.0, 100.0 - (variance * 1.5)))
    elif alarm_logs:
        # Fallback: use on-time ratio if not enough timestamps
        on_time = sum(1 for l in alarm_logs if l.status == "on_time")
        wakeup_consistency_score = round((on_time / len(alarm_logs)) * 100, 1)
    else:
        wakeup_consistency_score = 50.0   # neutral default for new users

    # ── 2. Challenge Completion Success (25%) ────────────────
    if challenge_logs:
        successes = sum(1 for l in challenge_logs if l.success)
        challenge_success_score = round((successes / len(challenge_logs)) * 100, 1)
    else:
        challenge_success_score = 0.0

    # ── 3. Snooze Reduction (20%) ────────────────────────────
    # Snooze score = 100 − snooze_frequency_percent
    if challenge_logs:
        snoozed = sum(1 for l in challenge_logs if (l.time_taken_seconds or 0) > 15.0)
        snooze_freq_pct = (snoozed / len(challenge_logs)) * 100
    else:
        snooze_freq_pct = 0.0
    snooze_reduction_score = max(0.0, min(100.0, 100.0 - snooze_freq_pct))

    # ── 4. Sleep Schedule Adherence (20%) ────────────────────
    # Average of: AlarmLog on-time rate + HabitLog 7-day adherence
    if alarm_logs:
        on_time_pct = (sum(1 for l in alarm_logs if l.status == "on_time") / len(alarm_logs)) * 100
    else:
        on_time_pct = 50.0

    if habit_logs:
        habit_adherence_pct = (sum(1 for l in habit_logs if l.completed) / len(habit_logs)) * 100
    else:
        habit_adherence_pct = 50.0

    sleep_adherence_score = round((on_time_pct + habit_adherence_pct) / 2.0, 1)

    # ── Weighted Composite ────────────────────────────────────
    habit_score = round(
        (wakeup_consistency_score * 0.35) +
        (challenge_success_score  * 0.25) +
        (snooze_reduction_score   * 0.20) +
        (sleep_adherence_score    * 0.20)
    )
    habit_score = max(0, min(100, habit_score))

    grade = (
        "S" if habit_score >= 90 else
        "A" if habit_score >= 75 else
        "B" if habit_score >= 60 else
        "C" if habit_score >= 45 else "D"
    )

    return {
        "habit_score":               habit_score,
        "grade":                     grade,
        # Component scores (0–100 each)
        "wakeup_consistency_score":  round(wakeup_consistency_score, 1),
        "challenge_success_score":   challenge_success_score,
        "snooze_reduction_score":    round(snooze_reduction_score, 1),
        "sleep_adherence_score":     sleep_adherence_score,
        # Weights applied
        "weights": {
            "wakeup_consistency":  0.35,
            "challenge_completion": 0.25,
            "snooze_reduction":    0.20,
            "sleep_adherence":     0.20
        },
        # Weighted contributions (component × weight)
        "contributions": {
            "wakeup_consistency":  round(wakeup_consistency_score * 0.35, 1),
            "challenge_completion": round(challenge_success_score  * 0.25, 1),
            "snooze_reduction":    round(snooze_reduction_score   * 0.20, 1),
            "sleep_adherence":     round(sleep_adherence_score    * 0.20, 1),
        },
        "label": f"Habit Score: {habit_score}/100 (Grade {grade})"
    }


# ══════════════════════════════════════════════════════════════
#  PRODUCTIVITY SCORING
#  Weighted average of:  Challenge 40% · Habits 35% · Sleep 25%
# ══════════════════════════════════════════════════════════════

@app.get("/scoring/productivity/{user_id}")
def get_productivity_score(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    Overall Productivity Score:
      Challenge Completion Success  40%
      Habit Score (weighted model)  35%
      Sleep Routine (on-time rate)  25%
    """
    if user_id != current_user.id and current_user.role not in ("admin", "wellness_coach"):
        raise HTTPException(status_code=403, detail="Access denied")

    # 1. Challenge accuracy (feeds 40%)
    challenge_logs = db.query(ChallengeLog).filter(ChallengeLog.user_id == user_id).all()
    acc = (
        sum(1 for l in challenge_logs if l.success) / len(challenge_logs) * 100
        if challenge_logs else 0.0
    )

    # 2. Habit adherence (feeds 35%) — re-use weighted habit score
    habit_data = get_habit_score(user_id, db, current_user)
    habit_component = habit_data["habit_score"]

    # 3. Sleep routine on-time rate (feeds 25%)
    alarm_logs = db.query(AlarmLog).filter(AlarmLog.user_id == user_id).all()
    on_time_pct = (
        sum(1 for l in alarm_logs if l.status == "on_time") / len(alarm_logs) * 100
        if alarm_logs else 50.0
    )

    productivity = round(
        (acc             * 0.40) +
        (habit_component * 0.35) +
        (on_time_pct     * 0.25)
    )
    productivity = max(0, min(100, productivity))

    grade = (
        "S" if productivity >= 90 else
        "A" if productivity >= 75 else
        "B" if productivity >= 60 else
        "C" if productivity >= 45 else "D"
    )

    return {
        "productivity_score":  productivity,
        "grade":               grade,
        "challenge_component": round(acc, 1),
        "habit_component":     round(habit_component, 1),
        "sleep_component":     round(on_time_pct, 1),
        "label":               f"Productivity Score: {productivity}/100 (Grade {grade})"
    }


# ══════════════════════════════════════════════════════════════
#  RECOMMENDATION ENGINE
#  5 pillars: Sleep · Wake-up · Habit · Productivity · Challenge
# ══════════════════════════════════════════════════════════════

@app.get("/recommendations/{user_id}")
def get_recommendations(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if user_id != current_user.id and current_user.role not in ("admin", "wellness_coach"):
        raise HTTPException(status_code=403, detail="Access denied")
    """
    Personalised Recommendation Engine — analyses all user data and returns
    actionable recommendations across 5 pillars:
      1. Sleep Improvement
      2. Wake-up Optimisation
      3. Habit Improvement
      4. Productivity
      5. Personalised Challenge
    """
    from datetime import datetime, timedelta

    # ── Pull raw data ──────────────────────────────────────────
    challenge_logs = db.query(ChallengeLog).filter(
        ChallengeLog.user_id == user_id
    ).order_by(ChallengeLog.created_at.desc()).all()

    alarm_logs = db.query(AlarmLog).filter(
        AlarmLog.user_id == user_id
    ).order_by(AlarmLog.triggered_at.desc()).all()

    habit_logs = db.query(HabitLog).filter(
        HabitLog.user_id == user_id
    ).order_by(HabitLog.log_date.desc()).all()

    alarms = db.query(Alarm).filter(
        Alarm.user_id == user_id, Alarm.is_active == True
    ).all()

    # ── Helper: level tag ─────────────────────────────────────
    def tag(level: str) -> str:
        return {"high": "🔴 High Priority", "medium": "🟡 Suggested",
                "low": "🟢 Keep it up"}.get(level, "🟡 Suggested")

    recommendations = []

    # ════════════════════════════════
    # PILLAR 1 — SLEEP IMPROVEMENT
    # ════════════════════════════════
    total_logs = len(alarm_logs)
    on_time    = sum(1 for l in alarm_logs if l.status == "on_time")
    snoozed    = sum(1 for l in alarm_logs if l.status == "snoozed")
    avg_delay  = (
        sum(l.delay_seconds or 0 for l in alarm_logs) / total_logs
        if total_logs else 0
    )

    if total_logs == 0:
        sleep_recs = [
            {
                "title": "Set Your First Alarm",
                "body": "Set an alarm with a cognitive challenge to start tracking your sleep routine and build your wake-up score.",
                "icon": "🌙",
                "priority": tag("medium"),
                "action": "Set Alarm"
            }
        ]
    elif avg_delay > 300:   # >5 min average delay
        sleep_recs = [
            {
                "title": "Reduce Wake-up Delay",
                "body": f"Your average wake-up delay is {int(avg_delay // 60)}m {int(avg_delay % 60)}s. Move your alarm 15 minutes earlier to build a better sleep buffer before your target wake time.",
                "icon": "🌙",
                "priority": tag("high"),
                "action": "Adjust Alarm Time"
            },
            {
                "title": "Limit Blue Light Before Bed",
                "body": "Screen exposure within 90 minutes of bedtime reduces melatonin by up to 50%. Enable a device bedtime mode at 9:30 PM to improve deep sleep quality.",
                "icon": "📵",
                "priority": tag("medium"),
                "action": "Enable Bedtime Mode"
            }
        ]
    elif snoozed > on_time:
        sleep_recs = [
            {
                "title": "Break the Snooze Cycle",
                "body": f"You snoozed {snoozed} out of {total_logs} alarms. Fragmented sleep after snooze deepens sleep inertia. Try reducing snooze duration by 2 minutes each week.",
                "icon": "⏰",
                "priority": tag("high"),
                "action": "Reduce Snooze Time"
            }
        ]
    else:
        sleep_recs = [
            {
                "title": "Great Sleep Consistency!",
                "body": f"You dismissed {on_time} of {total_logs} alarms on time. Maintain your schedule even on weekends to lock in your circadian rhythm.",
                "icon": "🌙",
                "priority": tag("low"),
                "action": "Keep Going"
            }
        ]

    recommendations.append({
        "pillar": "Sleep Improvement",
        "pillar_icon": "🌙",
        "items": sleep_recs
    })

    # ════════════════════════════════
    # PILLAR 2 — WAKE-UP OPTIMISATION
    # ════════════════════════════════
    wake_hours = [
        l.triggered_at.hour + l.triggered_at.minute / 60.0
        for l in alarm_logs if l.triggered_at
    ]
    avg_wake = sum(wake_hours) / len(wake_hours) if wake_hours else 7.0

    # Consistency — std-dev proxy
    if len(wake_hours) >= 3:
        mean = avg_wake
        variance = sum((h - mean) ** 2 for h in wake_hours) / len(wake_hours)
        std_dev = variance ** 0.5
    else:
        std_dev = 0.0

    def fmt_hour(h: float) -> str:
        hh = int(h) % 24
        mm = int((h % 1) * 60)
        period = "AM" if hh < 12 else "PM"
        disp = hh % 12 or 12
        return f"{disp}:{mm:02d} {period}"

    if std_dev > 1.5:
        wakeup_recs = [
            {
                "title": "Stabilise Your Wake-up Window",
                "body": f"Your wake-up time varies by ±{std_dev:.1f} hours across recent days (avg {fmt_hour(avg_wake)}). Aim to wake within a 30-minute window daily — even on weekends — to anchor your circadian clock.",
                "icon": "⏱️",
                "priority": tag("high"),
                "action": "Set Consistent Time"
            }
        ]
    elif avg_wake < 5.5:
        wakeup_recs = [
            {
                "title": "Consider a Later Wake Window",
                "body": f"You consistently wake at {fmt_hour(avg_wake)}, which may cut into deep sleep stages. If possible, shift to a 6:00–7:30 AM window for optimal cognitive restoration.",
                "icon": "🌅",
                "priority": tag("medium"),
                "action": "Adjust Alarm"
            }
        ]
    elif avg_wake > 9.0:
        wakeup_recs = [
            {
                "title": "Earlier Wake-up Boosts Cognition",
                "body": f"Your average wake time ({fmt_hour(avg_wake)}) shifts your cortisol peak later, reducing morning mental sharpness. Try moving your alarm 30 minutes earlier each week until you reach your target.",
                "icon": "☀️",
                "priority": tag("medium"),
                "action": "Advance Alarm"
            }
        ]
    else:
        wakeup_recs = [
            {
                "title": "Ideal Wake-up Window",
                "body": f"Waking consistently around {fmt_hour(avg_wake)} aligns with your cortisol peak for maximum morning alertness. Keep it up!",
                "icon": "🌅",
                "priority": tag("low"),
                "action": "Maintain Schedule"
            }
        ]

    recommendations.append({
        "pillar": "Wake-up Optimisation",
        "pillar_icon": "⏱️",
        "items": wakeup_recs
    })

    # ════════════════════════════════
    # PILLAR 3 — HABIT IMPROVEMENT
    # ════════════════════════════════
    today       = datetime.now().date()
    week_start  = today - timedelta(days=7)
    recent_habits = [h for h in habit_logs if h.log_date and (h.log_date.date() if hasattr(h.log_date, 'date') else h.log_date) >= week_start] if habit_logs else []
    total_h   = len(recent_habits)
    done_h    = sum(1 for h in recent_habits if h.completed)
    habit_pct = round((done_h / total_h) * 100) if total_h else 0

    if total_h == 0:
        habit_recs = [
            {
                "title": "Log Your First Habit",
                "body": "Start tracking daily habits — even 1 logged habit per day builds the consistency data needed to generate personalised guidance.",
                "icon": "📋",
                "priority": tag("medium"),
                "action": "Log a Habit"
            }
        ]
    elif habit_pct < 40:
        habit_recs = [
            {
                "title": "Boost Habit Completion Rate",
                "body": f"Only {habit_pct}% of your habits were completed this week. Try the 2-minute rule: if a habit takes less than 2 minutes, do it immediately after waking up.",
                "icon": "📋",
                "priority": tag("high"),
                "action": "Review Habits"
            },
            {
                "title": "Anchor Habits to Your Alarm",
                "body": "Stack your morning habits directly after your alarm dismissal challenge. Habit stacking after a cognitive win increases completion rate by ~60%.",
                "icon": "🔗",
                "priority": tag("medium"),
                "action": "Create Habit Stack"
            }
        ]
    elif habit_pct < 70:
        habit_recs = [
            {
                "title": "Strengthen Mid-Week Consistency",
                "body": f"You're completing {habit_pct}% of habits. Most drops happen Wednesday–Thursday. Prepare the night before by laying out anything needed for morning habits.",
                "icon": "📈",
                "priority": tag("medium"),
                "action": "Prep Night Before"
            }
        ]
    else:
        habit_recs = [
            {
                "title": "Excellent Habit Adherence!",
                "body": f"You completed {habit_pct}% of your habits this week. Consider adding one new habit to keep growing your routine without overwhelming yourself.",
                "icon": "✅",
                "priority": tag("low"),
                "action": "Add New Habit"
            }
        ]

    recommendations.append({
        "pillar": "Habit Improvement",
        "pillar_icon": "📋",
        "items": habit_recs
    })

    # ════════════════════════════════
    # PILLAR 4 — PRODUCTIVITY
    # ════════════════════════════════
    total_c   = len(challenge_logs)
    success_c = sum(1 for l in challenge_logs if l.success)
    acc_c     = round((success_c / total_c) * 100) if total_c else 0
    avg_t     = (sum(l.time_taken_seconds for l in challenge_logs) / total_c) if total_c else 0

    # Recent trend — last 5 vs previous 5
    recent5   = challenge_logs[:5]
    prev5     = challenge_logs[5:10]
    recent_acc = (sum(1 for l in recent5 if l.success) / len(recent5) * 100) if recent5 else 0
    prev_acc   = (sum(1 for l in prev5  if l.success) / len(prev5)  * 100) if prev5 else 0
    trending_up = recent_acc >= prev_acc

    if total_c == 0:
        prod_recs = [
            {
                "title": "Complete Your First Challenge",
                "body": "Solve an alarm challenge to activate your productivity score. Even one session generates your first baseline data point.",
                "icon": "🚀",
                "priority": tag("medium"),
                "action": "Start Challenge"
            }
        ]
    elif acc_c < 50:
        prod_recs = [
            {
                "title": "Lower Difficulty to Build Momentum",
                "body": f"Your challenge accuracy is {acc_c}%. Switch to Beginner or Easy difficulty to rebuild confidence and accuracy streaks, then progressively step up.",
                "icon": "🎯",
                "priority": tag("high"),
                "action": "Reduce Difficulty"
            },
            {
                "title": "Morning Hydration Boosts Performance",
                "body": "Drinking 500ml of water within 10 minutes of waking increases cognitive processing speed by ~14%. Try pairing this with your alarm challenge.",
                "icon": "💧",
                "priority": tag("medium"),
                "action": "Hydrate First"
            }
        ]
    elif not trending_up and total_c >= 10:
        prod_recs = [
            {
                "title": "Performance Plateau Detected",
                "body": f"Your recent accuracy ({int(recent_acc)}%) is lower than your previous sessions ({int(prev_acc)}%). Mix in a different challenge type this week to re-engage different neural pathways.",
                "icon": "📊",
                "priority": tag("medium"),
                "action": "Switch Challenge Type"
            }
        ]
    else:
        prod_recs = [
            {
                "title": "Strong Productivity Trend",
                "body": f"Accuracy: {acc_c}%, avg solve time: {avg_t:.1f}s. You're on a positive trajectory. Consider stepping up to a harder difficulty to keep your brain growing.",
                "icon": "🚀",
                "priority": tag("low"),
                "action": "Level Up"
            }
        ]

    recommendations.append({
        "pillar": "Productivity",
        "pillar_icon": "🚀",
        "items": prod_recs
    })

    # ════════════════════════════════
    # PILLAR 5 — PERSONALISED CHALLENGE
    # ════════════════════════════════
    levels = ["beginner", "easy", "medium", "hard", "expert"]

    # Category accuracy breakdown
    cat_data: dict[str, dict] = {}
    for l in challenge_logs:
        c = (l.challenge_type or "math").lower()
        if c not in cat_data:
            cat_data[c] = {"total": 0, "success": 0, "times": []}
        cat_data[c]["total"]   += 1
        if l.success:
            cat_data[c]["success"] += 1
        cat_data[c]["times"].append(l.time_taken_seconds)

    weakest_cat = None
    strongest_cat = None
    if cat_data:
        acc_map = {
            k: round(v["success"] / v["total"] * 100) if v["total"] else 0
            for k, v in cat_data.items()
        }
        weakest_cat   = min(acc_map, key=acc_map.get)
        strongest_cat = max(acc_map, key=acc_map.get)

    # Recommended next difficulty
    recent_diff = challenge_logs[0].difficulty if challenge_logs and challenge_logs[0].difficulty in levels else "medium"
    curr_idx    = levels.index(recent_diff)
    if acc_c >= 80 and total_c >= 3:
        next_diff = levels[min(curr_idx + 1, len(levels) - 1)]
        diff_advice = f"Your {acc_c}% accuracy qualifies you for {next_diff.capitalize()} difficulty."
    elif acc_c <= 40 and total_c >= 3:
        next_diff = levels[max(curr_idx - 1, 0)]
        diff_advice = f"Step back to {next_diff.capitalize()} to rebuild accuracy before advancing."
    else:
        next_diff = recent_diff
        diff_advice = f"Continue at {next_diff.capitalize()} — your performance is stable."

    challenge_recs = []

    if not challenge_logs:
        challenge_recs.append({
            "title": "Try a Math Warm-up",
            "body": "Math Problems are the best starting point — they activate prefrontal cortex engagement fastest after waking. Start with Beginner difficulty.",
            "icon": "🧠",
            "priority": tag("medium"),
            "action": "Start Math Challenge"
        })
    else:
        challenge_recs.append({
            "title": f"Recommended: {next_diff.capitalize()} Difficulty",
            "body": diff_advice + " Consistent difficulty progression is the single biggest predictor of long-term cognitive improvement.",
            "icon": "🧩",
            "priority": tag("medium") if next_diff == recent_diff else tag("high"),
            "action": f"Try {next_diff.capitalize()}"
        })

        if weakest_cat:
            weak_label = {"math": "Math Problems", "logic": "Logic Puzzles",
                          "memory": "Memory Challenges", "word": "Word Games",
                          "pattern": "Pattern Recognition", "riddle": "Riddles",
                          "quiz": "Quick Quizzes"}.get(weakest_cat, weakest_cat.capitalize())
            challenge_recs.append({
                "title": f"Focus Area: {weak_label}",
                "body": f"Your accuracy in {weak_label} is your current lowest category. Dedicating 2 sessions per week to this type will close the gap and produce the fastest cognitive gains.",
                "icon": "🎯",
                "priority": tag("medium"),
                "action": f"Practice {weak_label}"
            })

        if strongest_cat and strongest_cat != weakest_cat:
            strong_label = {"math": "Math Problems", "logic": "Logic Puzzles",
                            "memory": "Memory Challenges", "word": "Word Games",
                            "pattern": "Pattern Recognition", "riddle": "Riddles",
                            "quiz": "Quick Quizzes"}.get(strongest_cat, strongest_cat.capitalize())
            challenge_recs.append({
                "title": f"Your Strongest: {strong_label}",
                "body": f"You excel at {strong_label}. Use this as your confidence builder on days when you feel less sharp — it activates flow state faster.",
                "icon": "⭐",
                "priority": tag("low"),
                "action": f"Use as Warm-up"
            })

    recommendations.append({
        "pillar": "Personalised Challenge",
        "pillar_icon": "🧠",
        "items": challenge_recs
    })

    # ── Summary stats ─────────────────────────────────────────
    total_recs   = sum(len(p["items"]) for p in recommendations)
    high_count   = sum(
        1 for p in recommendations
        for i in p["items"] if "High" in i["priority"]
    )

    return {
        "user_id":        user_id,
        "generated_at":   datetime.now().isoformat(),
        "total_recommendations": total_recs,
        "high_priority_count":   high_count,
        "recommendations":        recommendations
    }



from fastapi.responses import FileResponse, Response

# ── Static File & Page Handlers ────────────────────────────────
@app.get("/{filename}.css")
def get_css(filename: str):
    for p in [
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", f"{filename}.css")),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", f"{filename}.css")),
        os.path.abspath(f"{filename}.css")
    ]:
        if os.path.exists(p):
            return FileResponse(p, media_type="text/css")
    return Response(status_code=404)

@app.get("/{filename}.js")
def get_js(filename: str):
    for p in [
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", f"{filename}.js")),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", f"{filename}.js")),
        os.path.abspath(f"{filename}.js")
    ]:
        if os.path.exists(p):
            return FileResponse(p, media_type="application/javascript")
    return Response(status_code=404)

@app.get("/login")
@app.get("/login.html")
def get_login_page():
    for p in [
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "login.html")),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "login.html")),
        os.path.abspath("login.html")
    ]:
        if os.path.exists(p):
            return FileResponse(p)
    return Response(status_code=404)

@app.get("/dashboard")
@app.get("/dashboard.html")
def get_dashboard_page():
    for p in [
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "dashboard.html")),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "dashboard.html")),
        os.path.abspath("dashboard.html")
    ]:
        if os.path.exists(p):
            return FileResponse(p)
    return Response(status_code=404)

@app.get("/challenge")
@app.get("/challenge.html")
def get_challenge_page():
    for p in [
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "challenge.html")),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "challenge.html")),
        os.path.abspath("challenge.html")
    ]:
        if os.path.exists(p):
            return FileResponse(p)
    return Response(status_code=404)

# ── Health check & Root ─────────────────────────────────────────
@app.get("/api")
def api_status():
    return {"status": "Wellspring API is running"}

@app.get("/")
def root():
    for p in [
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "index.html")),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "index.html")),
        os.path.abspath("index.html")
    ]:
        if os.path.exists(p):
            return FileResponse(p)
    return {"status": "Wellspring API is running"}




# ══════════════════════════════════════════════════════════════
#  WELLNESS COACH — 4 endpoints
# ══════════════════════════════════════════════════════════════

@app.get("/coach/behavior-insights")
def coach_behavior_insights(db: Session = Depends(get_db)):
    """Platform-wide behaviour stats for the coach overview."""
    from datetime import datetime, timedelta
    from collections import defaultdict

    users       = db.query(User).filter(User.role == "user", User.is_active == True).all()
    user_ids    = [u.id for u in users]
    total_users = len(user_ids)

    all_clogs = db.query(ChallengeLog).filter(ChallengeLog.user_id.in_(user_ids)).all() if user_ids else []
    all_alogs = db.query(AlarmLog).filter(AlarmLog.user_id.in_(user_ids)).all() if user_ids else []
    all_hlogs = db.query(HabitLog).filter(HabitLog.user_id.in_(user_ids)).all() if user_ids else []

    on_time   = sum(1 for l in all_alogs if l.status == "on_time")
    sleep_q   = round(on_time / len(all_alogs) * 100, 1) if all_alogs else 0.0

    wake_hours  = [l.triggered_at.hour + l.triggered_at.minute / 60.0 for l in all_alogs if l.triggered_at]
    avg_wake_h  = sum(wake_hours) / len(wake_hours) if wake_hours else 6.8
    hh = int(avg_wake_h) % 24
    mm = int((avg_wake_h % 1) * 60)
    avg_wake_str = f"{hh:02d}:{mm:02d}"

    done_h    = sum(1 for h in all_hlogs if h.completed)
    habit_adh = round(done_h / len(all_hlogs) * 100, 1) if all_hlogs else 0.0

    times     = [l.time_taken_seconds for l in all_clogs if l.time_taken_seconds]
    avg_time  = round(sum(times) / len(times), 1) if times else 0.0

    return {
        "total_active_users":   total_users,
        "avg_sleep_quality":    sleep_q,
        "avg_wake_time":        avg_wake_str,
        "habit_adherence_rate": habit_adh,
        "avg_puzzle_time_s":    avg_time,
        "total_challenges":     len(all_clogs),
        "total_alarm_events":   len(all_alogs),
    }


@app.get("/coach/habit-analytics")
def coach_habit_analytics(db: Session = Depends(get_db)):
    """Per-habit completion rates across all users."""
    from collections import defaultdict

    logs = db.query(HabitLog).all()
    if not logs:
        return {"habits": [
            {"name": "Hydration Routine",         "pct": 0},
            {"name": "Morning Physical Activity", "pct": 0},
            {"name": "Digital Screen Fast",       "pct": 0},
            {"name": "Goal-Setting Review",       "pct": 0},
        ]}

    habit_total: dict = defaultdict(int)
    habit_done:  dict = defaultdict(int)
    for h in logs:
        name = h.habit_name or "Other"
        habit_total[name] += 1
        if h.completed:
            habit_done[name] += 1

    result = sorted([
        {"name": k, "pct": round(habit_done[k] / habit_total[k] * 100)}
        for k in habit_total
    ], key=lambda x: x["pct"], reverse=True)[:6]

    defaults = ["Hydration Routine", "Morning Physical Activity",
                "Digital Screen Fast", "Goal-Setting Review"]
    existing = {r["name"] for r in result}
    for d in defaults:
        if d not in existing and len(result) < 4:
            result.append({"name": d, "pct": 0})

    return {"habits": result}


@app.get("/coach/sleep-trends")
def coach_sleep_trends(db: Session = Depends(get_db)):
    """7-day sleep quality trend for coach line chart."""
    from datetime import datetime, timedelta

    today  = datetime.now().date()
    days   = [(today - timedelta(days=i)) for i in range(6, -1, -1)]
    labels = [d.strftime("%a") for d in days]

    scores = []
    for day in days:
        day_start = datetime.combine(day, datetime.min.time())
        day_end   = datetime.combine(day + timedelta(days=1), datetime.min.time())
        day_logs  = db.query(AlarmLog).filter(
            AlarmLog.triggered_at >= day_start,
            AlarmLog.triggered_at <  day_end
        ).all()
        if day_logs:
            on_time = sum(1 for l in day_logs if l.status == "on_time")
            scores.append(round(on_time / len(day_logs) * 100))
        else:
            scores.append(0)

    return {"labels": labels, "scores": scores,
            "summary": "7-day sleep quality trend based on alarm dismissal data"}


@app.get("/coach/progress-monitoring")
def coach_progress_monitoring(db: Session = Depends(get_db)):
    """Per-user progress data for client monitoring table."""
    from datetime import datetime, timedelta

    users = db.query(User).filter(
        User.role == "user", User.is_active == True
    ).order_by(User.created_at.desc()).limit(20).all()

    rows = []
    for u in users:
        alarm  = db.query(Alarm).filter(Alarm.user_id == u.id, Alarm.is_active == True).first()
        clogs  = db.query(ChallengeLog).filter(ChallengeLog.user_id == u.id).all()
        alogs  = db.query(AlarmLog).filter(AlarmLog.user_id == u.id).order_by(AlarmLog.triggered_at.desc()).all()
        hlogs  = db.query(HabitLog).filter(HabitLog.user_id == u.id).all()

        goal_time = str(alarm.alarm_time)[:5] if alarm else "—"

        wake_hrs = [l.triggered_at.hour + l.triggered_at.minute / 60.0 for l in alogs if l.triggered_at]
        if wake_hrs:
            avg_h  = sum(wake_hrs) / len(wake_hrs)
            hh     = int(avg_h) % 24
            mm     = int((avg_h % 1) * 60)
            period = "AM" if hh < 12 else "PM"
            disp_h = hh % 12 or 12
            avg_wake = f"{disp_h:02d}:{mm:02d} {period}"
        else:
            avg_wake = "—"

        done_h    = sum(1 for h in hlogs if h.completed)
        habit_pct = round(done_h / len(hlogs) * 100) if hlogs else 0

        total_c = len(clogs)
        succ_c  = sum(1 for l in clogs if l.success)
        acc     = round(succ_c / total_c * 100) if total_c else 0

        if acc >= 75 and habit_pct >= 70:
            status = "Optimal"
        elif acc >= 50 or habit_pct >= 50:
            status = "On Track"
        elif total_c == 0:
            status = "New"
        else:
            status = "Needs Support"

        last_al = alogs[0].triggered_at if alogs else None
        if last_al:
            diff = datetime.utcnow() - last_al.replace(tzinfo=None)
            if diff.days > 0:
                last_active = f"{diff.days}d ago"
            elif diff.seconds >= 3600:
                last_active = f"{diff.seconds // 3600}h ago"
            else:
                last_active = f"{diff.seconds // 60}m ago"
        else:
            last_active = "Never"

        rows.append({
            "user_id":          u.id,
            "name":             u.full_name,
            "email":            u.email,
            "wakeup_goal":      goal_time,
            "avg_wakeup":       avg_wake,
            "habit_pct":        habit_pct,
            "cog_status":       status,
            "acc_pct":          acc,
            "last_active":      last_active,
            "total_challenges": total_c,
        })

    return {"users": rows, "total": len(rows)}


# ══════════════════════════════════════════════════════════════
#  COACH — CLIENT DIRECTORY & SESSION SCHEDULING
# ══════════════════════════════════════════════════════════════

# ── Session store is now persisted in DB (CoachSession model) ─

class SessionRequest(BaseModel):
    client_id:    int
    client_name:  str = ""    # ignored, resolved from DB
    date:         str          # ISO date  "2026-09-20"
    time:         str          # "14:30"
    duration_min: int = 30
    topic:        str = "General Check-in"
    notes:        str = ""

def _session_to_dict(s: "CoachSession") -> dict:
    """Serialise a CoachSession ORM row to a plain dict."""
    return {
        "id":           s.id,
        "client_id":    s.client_id,
        "coach_id":     s.coach_id,
        "client_name":  s.client_name,
        "coach_name":   s.coach_name,
        "date":         s.date,
        "time":         s.time,
        "duration_min": s.duration_min,
        "topic":        s.topic,
        "notes":        s.notes or "",
        "status":       s.status,
        "created_at":   s.created_at.isoformat() if s.created_at else "",
    }

def _notif_to_dict(n: "PersonalNotification") -> dict:
    """Serialise a PersonalNotification ORM row to the notification wire format."""
    from datetime import datetime
    return {
        "id":           n.id,
        "user_id":      n.user_id,
        "type":         n.notif_type,
        "icon":         n.icon,
        "title":        n.title,
        "body":         n.body,
        "priority":     n.priority,
        "read":         n.is_read,
        "timestamp":    n.created_at.strftime("%H:%M") if n.created_at else "",
        "date":         n.created_at.strftime("%d %b %Y") if n.created_at else "",
        "sent_by":      n.sent_by_name,
        "from_admin":   True,
        "action":       None,
        "action_label": None,
    }

# ── Topic icons helper ────────────────────────────────────────
_TOPIC_ICONS = {
    "Cognitive Challenge Review":    "🧠",
    "Progress & Goals Check-in":     "📊",
    "Habit Building Strategy":       "📋",
    "Sleep Pattern Analysis":        "🌙",
    "Wakefulness & Energy Coaching": "⚡",
    "Difficulty Level Planning":     "🎯",
    "General Check-in":              "💬",
}

@app.post("/coach/sessions")
def create_session(
    data: SessionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Coach schedules a DB-persisted session with a client."""
    if current_user.role not in ("wellness_coach", "admin"):
        raise HTTPException(status_code=403, detail="Coach access required")

    client = db.query(User).filter(User.id == data.client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    # Persist session
    sess = CoachSession(
        client_id    = data.client_id,
        coach_id     = current_user.id,
        coach_name   = current_user.full_name,
        client_name  = client.full_name,
        date         = data.date,
        time         = data.time,
        duration_min = data.duration_min,
        topic        = data.topic,
        notes        = data.notes,
        status       = "scheduled",
    )
    db.add(sess)
    db.commit()
    db.refresh(sess)

    # Persist personal notification for the client
    icon  = _TOPIC_ICONS.get(data.topic, "📅")
    body  = (
        f"Your wellness coach {current_user.full_name} has scheduled a "
        f"{data.duration_min}-min session with you on {data.date} at {data.time}."
        + (f" Note: {data.notes}" if data.notes else "")
    )
    notif = PersonalNotification(
        user_id      = data.client_id,
        sent_by_id   = current_user.id,
        sent_by_name = current_user.full_name,
        notif_type   = "announcement",
        icon         = icon,
        title        = f"📅 Coaching Session Scheduled — {data.topic}",
        body         = body,
        priority     = "high",
        session_id   = sess.id,
    )
    db.add(notif)
    db.commit()

    return {"success": True, "session": _session_to_dict(sess)}


@app.get("/coach/sessions")
def get_sessions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Returns all sessions for this coach from DB."""
    if current_user.role not in ("wellness_coach", "admin"):
        raise HTTPException(status_code=403, detail="Coach access required")

    rows = (
        db.query(CoachSession)
          .filter(CoachSession.coach_id == current_user.id)
          .order_by(CoachSession.date.desc(), CoachSession.time.desc())
          .all()
    )
    sessions = [_session_to_dict(s) for s in rows]
    return {"sessions": sessions, "total": len(sessions)}


@app.patch("/coach/sessions/{session_id}/status")
def update_session_status(
    session_id: int,
    status: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update a session status in DB and notify client."""
    if current_user.role not in ("wellness_coach", "admin"):
        raise HTTPException(status_code=403, detail="Coach access required")
    if status not in ("scheduled", "completed", "cancelled"):
        raise HTTPException(status_code=400, detail="Invalid status")

    sess = db.query(CoachSession).filter(CoachSession.id == session_id).first()
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")

    old_status = sess.status
    sess.status = status
    db.commit()
    db.refresh(sess)

    # Notify client on status change
    if status in ("completed", "cancelled") and old_status == "scheduled":
        msg_map = {
            "completed": ("✅", "Session Completed",
                f"Your coaching session on {sess.date} at {sess.time} ({sess.topic}) has been marked as completed."),
            "cancelled": ("❌", "Session Cancelled",
                f"Your coaching session on {sess.date} at {sess.time} ({sess.topic}) has been cancelled by your coach."),
        }
        icon, title, body = msg_map[status]
        notif = PersonalNotification(
            user_id      = sess.client_id,
            sent_by_id   = current_user.id,
            sent_by_name = current_user.full_name,
            notif_type   = "announcement",
            icon         = icon,
            title        = title,
            body         = body,
            priority     = "normal",
            session_id   = sess.id,
        )
        db.add(notif)
        db.commit()

    return {"success": True, "session": _session_to_dict(sess)}


@app.get("/user/sessions/{user_id}")
def get_user_sessions(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Returns all coaching sessions booked for a specific user, from DB."""
    if user_id != current_user.id and current_user.role not in ("wellness_coach", "admin"):
        raise HTTPException(status_code=403, detail="Access denied")

    from datetime import datetime
    today = datetime.now().date()

    rows = (
        db.query(CoachSession)
          .filter(CoachSession.client_id == user_id)
          .order_by(CoachSession.date.asc(), CoachSession.time.asc())
          .all()
    )

    enriched = []
    for s in rows:
        d = _session_to_dict(s)
        try:
            sess_date = datetime.strptime(s.date, "%Y-%m-%d").date()
            delta = (sess_date - today).days
            if delta > 0:
                d["when"] = f"In {delta} day{'s' if delta != 1 else ''}"
            elif delta == 0:
                d["when"] = "Today"
            else:
                d["when"] = f"{abs(delta)} day{'s' if abs(delta) != 1 else ''} ago"
        except Exception:
            d["when"] = s.date
        enriched.append(d)

    # Upcoming first, then past
    enriched.sort(key=lambda x: (x["status"] != "scheduled", x["date"]))
    return {"sessions": enriched, "total": len(enriched)}


@app.get("/debug/personal-notifs/{user_id}")
def debug_personal_notifs(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Debug: personal notifications for a user from DB."""
    if user_id != current_user.id and current_user.role not in ("admin", "wellness_coach"):
        raise HTTPException(status_code=403, detail="Access denied")
    rows = (
        db.query(PersonalNotification)
          .filter(PersonalNotification.user_id == user_id)
          .order_by(PersonalNotification.created_at.desc())
          .all()
    )
    return {
        "user_id": user_id,
        "count":   len(rows),
        "notifications": [_notif_to_dict(n) for n in rows]
    }

@app.get("/coach/client-directory")
def coach_client_directory(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Full client directory with live progress stats for each user."""
    if current_user.role not in ("wellness_coach", "admin"):
        raise HTTPException(status_code=403, detail="Coach access required")

    from datetime import datetime, timedelta
    from collections import defaultdict

    now      = datetime.utcnow()
    week_ago = now - timedelta(days=7)

    users = db.query(User).filter(
        User.role == "user",
        User.is_active == True
    ).order_by(User.full_name).all()

    directory = []
    for u in users:
        # Challenge stats
        clogs     = db.query(ChallengeLog).filter(ChallengeLog.user_id == u.id).all()
        total_ch  = len(clogs)
        solved    = sum(1 for c in clogs if c.success)
        acc_pct   = round(solved / total_ch * 100) if total_ch else 0
        week_ch   = sum(1 for c in clogs if c.created_at and c.created_at.replace(tzinfo=None) >= week_ago)
        avg_score = round(sum(c.score for c in clogs) / total_ch) if total_ch else 0

        # Most common challenge type
        type_count: dict = defaultdict(int)
        for c in clogs:
            type_count[c.challenge_type] += 1
        top_type  = max(type_count, key=type_count.get) if type_count else "—"

        # Difficulty distribution
        diff_count: dict = defaultdict(int)
        for c in clogs:
            diff_count[c.difficulty] += 1
        top_diff  = max(diff_count, key=diff_count.get) if diff_count else "—"

        # Habit stats
        hlogs     = db.query(HabitLog).filter(HabitLog.user_id == u.id).all()
        total_h   = len(hlogs)
        done_h    = sum(1 for h in hlogs if h.completed)
        hab_pct   = round(done_h / total_h * 100) if total_h else 0

        # Alarm / sleep stats
        alogs     = db.query(AlarmLog).filter(AlarmLog.user_id == u.id)\
                       .order_by(AlarmLog.triggered_at.desc()).all()
        on_time   = sum(1 for a in alogs if a.status == "on_time")
        sleep_pct = round(on_time / len(alogs) * 100) if alogs else 0

        # Last active
        last_active = "—"
        if alogs and alogs[0].triggered_at:
            diff = now - alogs[0].triggered_at.replace(tzinfo=None)
            if diff.days > 0:
                last_active = f"{diff.days}d ago"
            elif diff.seconds >= 3600:
                last_active = f"{diff.seconds // 3600}h ago"
            else:
                last_active = f"{diff.seconds // 60}m ago"

        # Wakefulness
        wake_scores = [c.wakefulness_score for c in clogs if c.wakefulness_score]
        avg_wake    = round(sum(wake_scores) / len(wake_scores), 1) if wake_scores else None

        # Scheduled sessions for this client — from DB
        sessions    = db.query(CoachSession).filter(CoachSession.client_id == u.id).all()
        upcoming    = [s for s in sessions if s.status == "scheduled"]

        # Cognitive status label
        if total_ch == 0:
            cog_status = "New"
        elif acc_pct >= 75:
            cog_status = "Optimal"
        elif acc_pct >= 50:
            cog_status = "On Track"
        else:
            cog_status = "Needs Support"

        directory.append({
            "id":           u.id,
            "full_name":    u.full_name,
            "email":        u.email,
            "joined":       str(u.created_at)[:10] if u.created_at else "—",
            "total_challenges": total_ch,
            "challenges_week":  week_ch,
            "accuracy_pct":     acc_pct,
            "avg_score":        avg_score,
            "top_challenge_type": top_type,
            "top_difficulty":     top_diff,
            "habit_pct":        hab_pct,
            "sleep_pct":        sleep_pct,
            "avg_wakefulness":  avg_wake,
            "last_active":      last_active,
            "cog_status":       cog_status,
            "upcoming_sessions": len(upcoming),
            "total_sessions":    len(sessions),
        })

    return {
        "clients":  directory,
        "total":    len(directory),
    }


# ══════════════════════════════════════════════════════════════
#  ADMIN — 4 endpoints
# ══════════════════════════════════════════════════════════════

@app.get("/admin/platform-analytics")
def admin_platform_analytics(db: Session = Depends(get_db)):
    """Real platform stats for Admin dashboard."""
    from datetime import datetime, timedelta

    total_users   = db.query(User).count()
    active_alarms = db.query(Alarm).filter(Alarm.is_active == True).count()
    total_logs    = db.query(ChallengeLog).count()
    total_alarms  = db.query(Alarm).count()

    week_ago  = datetime.utcnow() - timedelta(days=7)
    new_users = db.query(User).filter(User.created_at >= week_ago).count()

    succ      = db.query(ChallengeLog).filter(ChallengeLog.success == True).count()
    succ_rate = round(succ / total_logs * 100, 1) if total_logs else 0.0

    return {
        "total_users":            total_users,
        "active_alarms":          active_alarms,
        "total_challenges":       total_logs,
        "new_users_week":         new_users,
        "challenge_success_rate": succ_rate,
        "api_status":             "Online",
        "total_alarms":           total_alarms,
    }


@app.get("/admin/users")
def admin_get_users(db: Session = Depends(get_db)):
    """All users for admin user management table."""
    users = db.query(User).order_by(User.created_at.desc()).all()
    return [{
        "id":         u.id,
        "full_name":  u.full_name,
        "email":      u.email,
        "role":       u.role,
        "is_active":  u.is_active,
        "provider":   u.provider,
        "created_at": str(u.created_at)[:10] if u.created_at else "—",
    } for u in users]


@app.patch("/admin/users/{user_id}/toggle")
def admin_toggle_user(user_id: int, db: Session = Depends(get_db)):
    """Enable / disable a user account."""
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    u.is_active = not u.is_active
    db.commit()

    return {"id": u.id, "is_active": u.is_active, "full_name": u.full_name}


@app.get("/admin/recommendation-log")
def admin_recommendation_log(db: Session = Depends(get_db)):
    """Latest algorithmic recommendation events for Admin monitoring."""
    from datetime import datetime

    logs = db.query(ChallengeLog).order_by(
        ChallengeLog.created_at.desc()
    ).limit(10).all()

    events = []
    for l in logs:
        u    = db.query(User).filter(User.id == l.user_id).first()
        name = u.full_name if u else f"User #{l.user_id}"

        if l.success:
            if l.score and l.score > 120:
                msg = f"High performance detected for <strong>{name}</strong> — recommend increasing difficulty to {l.difficulty}+"
            else:
                msg = f"Challenge completed by <strong>{name}</strong> ({l.challenge_type}, {l.difficulty}) — streak maintained"
            etype = "success"
        else:
            msg   = f"Challenge failed by <strong>{name}</strong> ({l.challenge_type}, {l.difficulty}) — recommend easier level"
            etype = "warning"

        events.append({
            "time":    l.created_at.strftime("%H:%M:%S") if l.created_at else "—",
            "user_id": l.user_id,
            "message": msg,
            "type":    etype,
        })

    return {"events": events, "total": len(events)}


@app.get("/admin/system-reports")
def admin_system_reports(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Generate system report metadata with live DB stats. Admin only."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    from datetime import datetime, timedelta

    now    = datetime.now()
    today  = now.strftime("%B %d, %Y")
    ts     = now.strftime("%H:%M")

    # ── Counts ────────────────────────────────────────────────
    users       = db.query(User).count()
    active_u    = db.query(User).filter(User.is_active == True).count()
    alarms      = db.query(Alarm).count()
    active_a    = db.query(Alarm).filter(Alarm.is_active == True).count()
    clogs       = db.query(ChallengeLog).count()
    clogs_ok    = db.query(ChallengeLog).filter(ChallengeLog.success == True).count()
    hlogs       = db.query(HabitLog).count()
    hlogs_done  = db.query(HabitLog).filter(HabitLog.completed == True).count()
    alogs       = db.query(AlarmLog).count()

    # ── Weekly activity ───────────────────────────────────────
    week_ago    = now - timedelta(days=7)
    clogs_week  = db.query(ChallengeLog).filter(ChallengeLog.created_at >= week_ago).count()
    hlogs_week  = db.query(HabitLog).filter(HabitLog.log_date >= week_ago.date()).count()
    alogs_week  = db.query(AlarmLog).filter(AlarmLog.triggered_at >= week_ago).count()
    new_users   = db.query(User).filter(User.created_at >= week_ago).count()

    # ── Success rates ─────────────────────────────────────────
    ch_rate  = round((clogs_ok / clogs * 100) if clogs > 0 else 0)
    hb_rate  = round((hlogs_done / hlogs * 100) if hlogs > 0 else 0)

    # ── Total DB size estimate ─────────────────────────────────
    total_rows = users + alarms + clogs + hlogs + alogs
    db_size    = max(0.1, round(total_rows * 0.0015, 1))

    return {
        "generated_at": f"{today} at {ts}",
        "summary": {
            "total_records": total_rows,
            "db_size_mb":    db_size,
            "new_users_week": new_users,
            "active_users":   active_u,
        },
        "reports": [
            {
                "type":       "db_health",
                "title":      "Database Health Audit",
                "icon":       "database",
                "meta":       f"Generated {today} at {ts}",
                "rows":       users + alarms,
                "detail_a":   f"{users} users ({active_u} active)",
                "detail_b":   f"{alarms} alarms ({active_a} active)",
                "week_delta": f"+{new_users} new users this week",
                "status":     "healthy" if users > 0 else "empty",
                "size":       f"{max(0.1, round((users * 0.002 + alarms * 0.001 + clogs * 0.0005), 1))} MB",
            },
            {
                "type":       "challenge",
                "title":      "Challenge Performance",
                "icon":       "brain",
                "meta":       f"Generated {today} at {ts}",
                "rows":       clogs,
                "detail_a":   f"{clogs} total attempts · {clogs_ok} solved",
                "detail_b":   f"{ch_rate}% success rate",
                "week_delta": f"+{clogs_week} challenges this week",
                "status":     "good" if ch_rate >= 60 else "warning" if ch_rate >= 30 else "low",
                "size":       f"{max(0.1, round(clogs * 0.002, 1))} MB",
                "rate":       ch_rate,
            },
            {
                "type":       "habit",
                "title":      "Habit Adherence Summary",
                "icon":       "clipboard",
                "meta":       f"Generated {today} at {ts}",
                "rows":       hlogs,
                "detail_a":   f"{hlogs} habit log entries · {hlogs_done} completed",
                "detail_b":   f"{hb_rate}% completion rate",
                "week_delta": f"+{hlogs_week} logs this week",
                "status":     "good" if hb_rate >= 60 else "warning" if hb_rate >= 30 else "low",
                "size":       f"{max(0.1, round(hlogs * 0.001, 1))} MB",
                "rate":       hb_rate,
            },
            {
                "type":       "alarm_log",
                "title":      "Alarm Activity Log",
                "icon":       "alarm",
                "meta":       f"Generated {today} at {ts}",
                "rows":       alogs,
                "detail_a":   f"{alogs} alarm dismiss events",
                "detail_b":   f"{alogs_week} events this week",
                "week_delta": f"+{alogs_week} this week",
                "status":     "healthy" if alogs >= 0 else "empty",
                "size":       f"{max(0.1, round(alogs * 0.0008, 1))} MB",
            },
        ]
    }


# ══════════════════════════════════════════════════════════════
#  REPORT DOWNLOAD ENDPOINTS
#  Returns CSV data for each report type
# ══════════════════════════════════════════════════════════════

from fastapi.responses import StreamingResponse
import io

@app.get("/admin/reports/download/{report_type}")
def download_report(
    report_type: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Downloads a CSV report for the given type (admin only):
      db_health | challenge | habit | alarm_log
    """
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    from datetime import datetime

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    if report_type == "db_health":
        users  = db.query(User).all()
        alarms = db.query(Alarm).all()
        lines  = ["ID,Full Name,Email,Role,Active,Registered"]
        for u in users:
            lines.append(f'{u.id},{u.full_name},{u.email},{u.role},{u.is_active},{str(u.created_at)[:10]}')
        lines.append("")
        lines.append("AlarmID,UserID,Title,Time,Type,Active,Created")
        for a in alarms:
            lines.append(f'{a.id},{a.user_id},{a.title},{a.alarm_time},{a.alarm_type},{a.is_active},{str(a.created_at)[:10]}')
        content  = "\n".join(lines)
        filename = f"db_health_audit_{timestamp}.csv"

    elif report_type == "challenge":
        logs  = db.query(ChallengeLog).order_by(ChallengeLog.created_at.desc()).all()
        lines = ["LogID,UserID,Type,Difficulty,Success,Score,TimeTaken(s),Date"]
        for l in logs:
            lines.append(f'{l.id},{l.user_id},{l.challenge_type},{l.difficulty},{l.success},{l.score},{l.time_taken_seconds},{str(l.created_at)[:10]}')
        content  = "\n".join(lines)
        filename = f"challenge_performance_{timestamp}.csv"

    elif report_type == "habit":
        logs  = db.query(HabitLog).order_by(HabitLog.log_date.desc()).all()
        lines = ["LogID,UserID,HabitName,Completed,Date"]
        for l in logs:
            lines.append(f'{l.id},{l.user_id},{l.habit_name},{l.completed},{str(l.log_date)[:10]}')
        content  = "\n".join(lines)
        filename = f"habit_adherence_{timestamp}.csv"

    elif report_type == "alarm_log":
        logs  = db.query(AlarmLog).order_by(AlarmLog.triggered_at.desc()).all()
        lines = ["LogID,AlarmID,UserID,TriggeredAt,DismissedAt,Status,DelaySecs,PuzzleSolved"]
        for l in logs:
            lines.append(f'{l.id},{l.alarm_id},{l.user_id},{str(l.triggered_at)[:19]},{str(l.dismissed_at)[:19] if l.dismissed_at else ""},{l.status},{l.delay_seconds},{l.puzzle_solved}')
        content  = "\n".join(lines)
        filename = f"alarm_activity_log_{timestamp}.csv"

    else:
        raise HTTPException(status_code=400, detail=f"Unknown report type: {report_type}")

    return StreamingResponse(
        io.StringIO(content),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


# ══════════════════════════════════════════════════════════════
#  NOTIFICATION & REMINDER SYSTEM
#  6 types: bedtime · wakeup · habit · challenge · progress · announcement
# ══════════════════════════════════════════════════════════════

@app.get("/notifications/{user_id}")
def get_notifications(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if user_id != current_user.id and current_user.role not in ("admin", "wellness_coach"):
        raise HTTPException(status_code=403, detail="Access denied")
    """
    Generates personalised notifications for a user based on live DB state.
    Returns up to 20 notifications across 6 categories.
    """
    from datetime import datetime, timedelta, date as _date_type

    now        = datetime.now()
    today      = now.date()
    hour       = now.hour
    minute     = now.minute
    notifications = []
    notif_id   = 1

    def _to_date(val):
        """Safely coerce datetime, date, or string → date object."""
        if val is None:
            return None
        if isinstance(val, datetime):
            return val.date()
        if isinstance(val, _date_type):
            return val
        try:
            return datetime.fromisoformat(str(val)).date()
        except Exception:
            return None

    def notif(ntype, icon, title, body, priority="normal", action=None, action_label=None):
        nonlocal notif_id
        n = {
            "id":           notif_id,
            "type":         ntype,
            "icon":         icon,
            "title":        title,
            "body":         body,
            "priority":     priority,   # high | normal | low
            "read":         False,
            "timestamp":    now.strftime("%H:%M"),
            "date":         today.strftime("%d %b %Y"),
        }
        if action:       n["action"]       = action
        if action_label: n["action_label"] = action_label
        notif_id += 1
        return n

    # ── Pull data ───────────────────────────────────────────────
    user       = db.query(User).filter(User.id == user_id).first()
    alarms     = db.query(Alarm).filter(Alarm.user_id == user_id, Alarm.is_active == True).all()
    clogs      = db.query(ChallengeLog).filter(ChallengeLog.user_id == user_id).order_by(ChallengeLog.created_at.desc()).all()
    hlogs      = db.query(HabitLog).filter(HabitLog.user_id == user_id).all()
    alogs      = db.query(AlarmLog).filter(AlarmLog.user_id == user_id).order_by(AlarmLog.triggered_at.desc()).all()

    name_first = (user.full_name or "there").split()[0] if user else "there"

    # ════════════════════════════════
    # 1. BEDTIME REMINDERS (20:00–23:59)
    # ════════════════════════════════
    if 20 <= hour <= 23:
        # Find earliest alarm tomorrow
        earliest = None
        for a in alarms:
            t = a.alarm_time
            alarm_mins = t.hour * 60 + t.minute if hasattr(t, 'hour') else 0
            if earliest is None or alarm_mins < (earliest.alarm_time.hour * 60 + earliest.alarm_time.minute):
                earliest = a

        if earliest:
            alarm_t = earliest.alarm_time
            disp = alarm_t.strftime("%I:%M %p") if hasattr(alarm_t, 'strftime') else str(alarm_t)[:5]
            # Calculate sleep window (aim for 8h)
            alarm_mins_total = alarm_t.hour * 60 + alarm_t.minute if hasattr(alarm_t, 'hour') else 390
            bedtime_mins = alarm_mins_total - 480  # 8h before alarm
            if bedtime_mins < 0: bedtime_mins += 1440
            bh = bedtime_mins // 60
            bm = bedtime_mins % 60
            period = "AM" if bh < 12 else "PM"
            disp_bh = bh % 12 or 12
            bedtime_str = f"{disp_bh}:{bm:02d} {period}"

            notifications.append(notif(
                "bedtime", "🌙", "Bedtime Reminder",
                f"Your alarm '{earliest.title}' is set for {disp}. For 8 hours of sleep, aim to be in bed by {bedtime_str}.",
                priority="high",
                action="set_alarm", action_label="Adjust Alarm"
            ))

        notifications.append(notif(
            "bedtime", "📵", "Screen-Free Wind-Down",
            "Reduce screen time for the next 30 minutes to improve your sleep quality and morning alertness.",
            priority="normal"
        ))

    # ════════════════════════════════
    # 2. WAKE-UP REMINDERS (05:00–08:59)
    # ════════════════════════════════
    if 5 <= hour <= 8:
        for a in alarms:
            alarm_t = a.alarm_time
            if hasattr(alarm_t, 'hour'):
                diff_mins = (alarm_t.hour * 60 + alarm_t.minute) - (hour * 60 + minute)
                if 0 < diff_mins <= 30:
                    disp = alarm_t.strftime("%I:%M %p")
                    notifications.append(notif(
                        "wakeup", "⏰", f"Alarm in {diff_mins} Minutes",
                        f"Your alarm '{a.title}' rings at {disp}. Prepare your {a.challenge} challenge ({a.difficulty_level}).",
                        priority="high",
                        action="open_alarm", action_label="View Alarm"
                    ))

        if not clogs or (today - clogs[0].created_at.date()).days >= 1:
            notifications.append(notif(
                "wakeup", "🧠", "Good Morning! Challenge Ready",
                f"Rise and shine, {name_first}! Your cognitive challenge is ready. Solve it to dismiss your alarm and start strong.",
                priority="normal",
                action="open_challenge", action_label="Start Challenge"
            ))

    # ════════════════════════════════
    # 3. HABIT ALERTS (any time)
    # ════════════════════════════════
    today_habits = [h for h in hlogs if h.log_date and _to_date(h.log_date) == today]
    done_today   = sum(1 for h in today_habits if h.completed)
    total_today  = len(today_habits)

    if total_today == 0:
        notifications.append(notif(
            "habit", "📋", "No Habits Logged Today",
            "You haven't logged any habits yet today. Tap to log your morning routine and keep your streak going!",
            priority="high",
            action="log_habit", action_label="Log Habits"
        ))
    elif done_today < total_today:
        pending = total_today - done_today
        notifications.append(notif(
            "habit", "✅", f"{pending} Habit{'s' if pending > 1 else ''} Pending",
            f"You've completed {done_today} of {total_today} habits today. Finish your remaining habits to hit your daily goal!",
            priority="normal",
            action="log_habit", action_label="Complete Habits"
        ))
    else:
        notifications.append(notif(
            "habit", "🎉", "All Habits Completed!",
            f"Amazing, {name_first}! You've completed all {total_today} habits today. Your consistency is building powerful cognitive routines.",
            priority="low"
        ))

    # Streak alert
    successful_habit_dates = sorted(list(set(
        _to_date(h.log_date) for h in hlogs if h.completed and h.log_date and _to_date(h.log_date) is not None
    )), reverse=True)
    habit_streak = 0
    if successful_habit_dates:
        curr = successful_habit_dates[0]
        if (today - curr).days <= 1:
            habit_streak = 1
            for i in range(1, len(successful_habit_dates)):
                if (successful_habit_dates[i-1] - successful_habit_dates[i]).days == 1:
                    habit_streak += 1
                else:
                    break

    if habit_streak >= 3:
        notifications.append(notif(
            "habit", "🔥", f"{habit_streak}-Day Habit Streak!",
            f"You're on a {habit_streak}-day habit streak, {name_first}! Keep it up — consistency is the foundation of peak cognitive performance.",
            priority="low"
        ))
    elif habit_streak == 0 and successful_habit_dates:
        notifications.append(notif(
            "habit", "⚠️", "Streak at Risk!",
            "You missed logging habits yesterday. Log today's habits now to restart your streak before midnight.",
            priority="high",
            action="log_habit", action_label="Log Now"
        ))

    # ════════════════════════════════
    # 4. CHALLENGE REMINDERS
    # ════════════════════════════════
    total_c    = len(clogs)
    recent_c   = clogs[0] if clogs else None
    days_since = (today - recent_c.created_at.date()).days if recent_c else 999

    if total_c == 0:
        notifications.append(notif(
            "challenge", "🧩", "Complete Your First Challenge!",
            "You haven't solved a cognitive challenge yet. Dismiss your next alarm with a challenge to build your performance profile.",
            priority="high",
            action="open_challenge", action_label="Try a Challenge"
        ))
    elif days_since >= 2:
        notifications.append(notif(
            "challenge", "🧩", "Challenge Streak at Risk",
            f"It's been {days_since} days since your last challenge. Stay sharp — solve a quick challenge to maintain your cognitive momentum!",
            priority="high",
            action="open_challenge", action_label="Solve Now"
        ))
    elif days_since == 1:
        notifications.append(notif(
            "challenge", "💡", "Ready for Today's Challenge?",
            "You solved a challenge yesterday — great work! Complete one today to keep your cognitive streak alive.",
            priority="normal",
            action="open_challenge", action_label="Start Challenge"
        ))

    # Difficulty progression
    if total_c >= 5:
        recent5  = clogs[:5]
        succ5    = sum(1 for l in recent5 if l.success)
        acc5     = round(succ5 / 5 * 100)
        if acc5 >= 80:
            levels = ["beginner", "easy", "medium", "hard", "expert"]
            cur_diff = recent5[0].difficulty if recent5[0].difficulty in levels else "medium"
            cur_idx  = levels.index(cur_diff)
            if cur_idx < len(levels) - 1:
                next_diff = levels[cur_idx + 1]
                notifications.append(notif(
                    "challenge", "⬆️", "Ready to Level Up!",
                    f"Your last 5 challenges had {acc5}% accuracy! You're ready to advance from {cur_diff.capitalize()} to {next_diff.capitalize()} difficulty.",
                    priority="normal",
                    action="open_challenge", action_label=f"Try {next_diff.capitalize()}"
                ))

    # ════════════════════════════════
    # 5. PROGRESS NOTIFICATIONS
    # ════════════════════════════════
    successes  = sum(1 for l in clogs if l.success)
    total_score = sum(l.score for l in clogs)

    # Milestone badges
    milestones = [
        (1,   "🎯", "First Challenge Solved!",    "You solved your first cognitive challenge. The journey to peak brain performance begins now!"),
        (5,   "⭐", "5 Challenges Solved!",        "You've completed 5 cognitive challenges. You're building a consistent morning routine!"),
        (10,  "🏆", "10 Challenges Milestone!",    "Double digits! 10 challenges solved. Your brain is getting stronger every morning."),
        (25,  "🧠", "25 Challenges — Expert!",     "25 challenges! You're in the top tier of cognitive alarm users. Keep pushing!"),
        (50,  "🚀", "50 Challenges Mastered!",     "50 challenges completed! You've built an elite cognitive morning routine. Incredible dedication!"),
    ]
    for threshold, icon, title, body in milestones:
        if successes == threshold:
            notifications.append(notif("progress", icon, title, body, priority="high"))

    # Weekly summary (on Mondays 07:00–12:00)
    if now.weekday() == 0 and 7 <= hour <= 12:
        week_start = today - timedelta(days=7)
        week_logs  = [l for l in clogs if l.created_at.date() >= week_start]
        week_succ  = sum(1 for l in week_logs if l.success)
        week_score = sum(l.score for l in week_logs)
        if week_logs:
            notifications.append(notif(
                "progress", "📊", "Your Weekly Summary",
                f"Last week: {len(week_logs)} challenges, {week_succ} solved, {week_score} points earned. "
                f"{'Great week! Keep it up.' if week_succ/len(week_logs) >= 0.7 else 'Room to improve — aim for 70%+ accuracy this week.'}",
                priority="normal"
            ))

    # Score milestone
    for threshold in [100, 500, 1000, 2500, 5000]:
        if total_score >= threshold and total_score < threshold * 2:
            notifications.append(notif(
                "progress", "💎", f"{threshold}+ Points Earned!",
                f"You've accumulated {total_score} total performance points. You're in the top cognitive performers on the platform!",
                priority="low"
            ))
            break

    # ════════════════════════════════
    # 6. PLATFORM ANNOUNCEMENTS
    # ════════════════════════════════
    notifications.append(notif(
        "announcement", "📢", "New Challenge Types Available",
        "Pattern Recognition and Quick Quiz challenges are now available. Try them from your alarm settings for a fresh cognitive workout!",
        priority="low",
        action="open_alarm", action_label="Explore Challenges"
    ))

    if total_c < 3:
        notifications.append(notif(
            "announcement", "🎓", "Getting Started Tip",
            "Set your alarm difficulty to 'Beginner' for your first week. The app adapts automatically as your accuracy improves!",
            priority="normal"
        ))

    notifications.append(notif(
        "announcement", "🌟", "Tip: Wakefulness Rating",
        "After each alarm dismissal, rate your wakefulness 1–5. This trains your personalized sleep score over time.",
        priority="low"
    ))

    # ── Sort: high priority first ──────────────────────────────
    priority_order = {"high": 0, "normal": 1, "low": 2}
    notifications.sort(key=lambda x: priority_order.get(x["priority"], 2))

    # Inject personal notifications (coach sessions + admin messages) from DB
    personal_rows = (
        db.query(PersonalNotification)
          .filter(PersonalNotification.user_id == user_id)
          .order_by(PersonalNotification.created_at.desc())
          .limit(20)
          .all()
    )
    for pn in personal_rows:
        notifications.insert(0, _notif_to_dict(pn))

    # Final sort (personal notifs may have high priority)
    notifications.sort(key=lambda x: priority_order.get(x["priority"], 2))

    # Count by type and priority (after all injections)
    type_counts = {}
    for n in notifications:
        type_counts[n["type"]] = type_counts.get(n["type"], 0) + 1

    high_count  = sum(1 for n in notifications if n["priority"] == "high")
    total_count = len(notifications)

    # Ensure personal/session notifications are never cut off by the cap:
    # personal notifs are at the top (sorted high-first), cap at 30
    return {
        "user_id":       user_id,
        "generated_at":  now.isoformat(),
        "total":         total_count,
        "unread":        total_count,
        "high_priority": high_count,
        "type_counts":   type_counts,
        "notifications": notifications[:30]   # raised cap to ensure personal notifs always included
    }


# ══════════════════════════════════════════════════════════════
#  ADMIN — BROADCAST ANNOUNCEMENT
# ══════════════════════════════════════════════════════════════

class AnnouncementRequest(BaseModel):
    title: str
    body: str
    priority: str = "normal"   # high | normal | low
    icon: str = "📢"

# In-memory store for admin announcements (persists until server restart)
_admin_announcements: list = []

@app.post("/admin/announcements")
def post_announcement(data: AnnouncementRequest):
    """Admin sends a platform-wide announcement visible to all users."""
    from datetime import datetime
    ann = {
        "id":         len(_admin_announcements) + 9000,
        "type":       "announcement",
        "icon":       data.icon,
        "title":      data.title,
        "body":       data.body,
        "priority":   data.priority,
        "read":       False,
        "timestamp":  datetime.now().strftime("%H:%M"),
        "date":       datetime.now().strftime("%d %b %Y"),
        "action":     None,
        "action_label": None,
        "from_admin": True,
    }
    _admin_announcements.insert(0, ann)
    if len(_admin_announcements) > 20:
        _admin_announcements.pop()
    return {"success": True, "announcement": ann, "total": len(_admin_announcements)}

@app.get("/admin/announcements")
def get_announcements():
    """Returns all active admin announcements."""
    return {"announcements": _admin_announcements, "total": len(_admin_announcements)}


# ══════════════════════════════════════════════════════════════
#  ADMIN — PERSONAL (PER-USER) NOTIFICATIONS
#  Admin can send a targeted notification to a single user.
#  Now persisted in the personal_notifications DB table.
# ══════════════════════════════════════════════════════════════

class PersonalNotifRequest(BaseModel):
    user_id:  int
    title:    str
    body:     str
    priority: str = "normal"
    icon:     str = "📬"
    type:     str = "announcement"

@app.post("/admin/notifications/personal")
def send_personal_notification(
    data: PersonalNotifRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Admin sends a DB-persisted personal notification to one user."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    target = db.query(User).filter(User.id == data.user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    row = PersonalNotification(
        user_id      = data.user_id,
        sent_by_id   = current_user.id,
        sent_by_name = current_user.full_name,
        notif_type   = data.type,
        icon         = data.icon,
        title        = data.title,
        body         = data.body,
        priority     = data.priority,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    result = _notif_to_dict(row)
    result["target_name"] = target.full_name
    return {"success": True, "notification": result}


@app.get("/admin/notifications/personal")
def get_personal_notifications(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Returns all personal notifications (admin history view) from DB."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    rows = (
        db.query(PersonalNotification)
          .order_by(PersonalNotification.created_at.desc())
          .limit(200)
          .all()
    )
    # Enrich with target name
    notifs = []
    for n in rows:
        d = _notif_to_dict(n)
        u = db.query(User).filter(User.id == n.user_id).first()
        d["target_name"] = u.full_name if u else f"User #{n.user_id}"
        notifs.append(d)

    return {"notifications": notifs, "total": len(notifs)}

# Inject admin announcements into the notifications endpoint
# (The /notifications endpoint already covers per-user; admin announcements are global)


# ══════════════════════════════════════════════════════════════
#  REPORTS & EXPORT SYSTEM
#  5 report types: habit · wakeup · challenge · productivity · sleep
#  2 export formats: CSV (Excel-compatible) · plain-text (PDF-ready)
# ══════════════════════════════════════════════════════════════

@app.get("/reports/summary/{user_id}")
def get_reports_summary(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if user_id != current_user.id and current_user.role not in ("admin", "wellness_coach"):
        raise HTTPException(status_code=403, detail="Access denied")
    """Master summary for the Reports dashboard card — all 5 report types."""
    from datetime import datetime, timedelta, date as _date_type

    def _to_date(val):
        if val is None: return None
        if isinstance(val, datetime): return val.date()
        if isinstance(val, _date_type): return val
        try: return datetime.fromisoformat(str(val)).date()
        except: return None

    today      = datetime.now().date()
    week_ago   = today - timedelta(days=7)
    month_ago  = today - timedelta(days=30)

    u          = db.query(User).filter(User.id == user_id).first()
    clogs      = db.query(ChallengeLog).filter(ChallengeLog.user_id == user_id).order_by(ChallengeLog.created_at.desc()).all()
    hlogs      = db.query(HabitLog).filter(HabitLog.user_id == user_id).all()
    alogs      = db.query(AlarmLog).filter(AlarmLog.user_id == user_id).order_by(AlarmLog.triggered_at.desc()).all()
    alarms     = db.query(Alarm).filter(Alarm.user_id == user_id).all()

    # ── Habit Report ───────────────────────────────────────────
    week_hlogs    = [h for h in hlogs if h.log_date and _to_date(h.log_date) and _to_date(h.log_date) >= week_ago]
    habit_done    = sum(1 for h in week_hlogs if h.completed)
    habit_total   = len(week_hlogs)
    habit_pct     = round(habit_done / habit_total * 100) if habit_total else 0
    habit_names   = list({h.habit_name for h in hlogs})[:5]

    # ── Wake-up Report ─────────────────────────────────────────
    week_alogs    = [l for l in alogs if l.triggered_at and l.triggered_at.date() >= week_ago]
    on_time_c     = sum(1 for l in week_alogs if l.status == "on_time")
    snoozed_c     = sum(1 for l in week_alogs if l.status == "snoozed")
    wake_hours    = [l.triggered_at.hour + l.triggered_at.minute / 60.0 for l in alogs if l.triggered_at]
    avg_wake_h    = round(sum(wake_hours) / len(wake_hours), 2) if wake_hours else 7.0
    hh = int(avg_wake_h) % 24
    mm = int((avg_wake_h % 1) * 60)
    avg_wake_str  = f"{hh % 12 or 12}:{mm:02d} {'AM' if hh < 12 else 'PM'}"

    # ── Challenge Report ────────────────────────────────────────
    week_clogs    = [l for l in clogs if l.created_at and l.created_at.date() >= week_ago]
    ch_total      = len(clogs)
    ch_week       = len(week_clogs)
    ch_succ       = sum(1 for l in clogs if l.success)
    ch_acc        = round(ch_succ / ch_total * 100, 1) if ch_total else 0
    ch_score      = sum(l.score for l in clogs)
    avg_time      = round(sum(l.time_taken_seconds for l in clogs) / ch_total, 1) if ch_total else 0
    by_type       = {}
    for l in clogs:
        t = l.challenge_type or "math"
        if t not in by_type:
            by_type[t] = {"total": 0, "success": 0}
        by_type[t]["total"] += 1
        if l.success:
            by_type[t]["success"] += 1
    type_breakdown = [
        {"type": k, "total": v["total"],
         "accuracy": round(v["success"] / v["total"] * 100) if v["total"] else 0}
        for k, v in sorted(by_type.items(), key=lambda x: x[1]["total"], reverse=True)
    ]

    # ── Productivity Report ────────────────────────────────────
    prod_score = round(
        (ch_acc * 0.40) +
        (habit_pct * 0.35) +
        ((on_time_c / len(week_alogs) * 100 if week_alogs else 50) * 0.25)
    )
    prod_grade = ("S" if prod_score >= 90 else "A" if prod_score >= 75 else
                  "B" if prod_score >= 60 else "C" if prod_score >= 45 else "D")

    # ── Sleep Analytics ────────────────────────────────────────
    wakefulness_scores = [l.wakefulness_score for l in clogs if l.wakefulness_score]
    avg_wake_score     = round(sum(wakefulness_scores) / len(wakefulness_scores), 1) if wakefulness_scores else 0
    sleep_score        = min(98, max(50, int(75 + (ch_acc * 0.15) + (habit_pct * 0.1))))

    # Day-by-day sleep scores for the last 7 days
    days_labels  = [(today - timedelta(days=i)).strftime("%a") for i in range(6, -1, -1)]
    days_scores  = []
    for i in range(6, -1, -1):
        day = today - timedelta(days=i)
        day_alogs = [l for l in alogs if l.triggered_at and l.triggered_at.date() == day]
        if day_alogs:
            ot = sum(1 for l in day_alogs if l.status == "on_time")
            days_scores.append(round(ot / len(day_alogs) * 100))
        else:
            days_scores.append(0)

    return {
        "user_id":      user_id,
        "user_name":    u.full_name if u else "User",
        "generated_at": datetime.now().isoformat(),
        "period":       "Last 30 Days",

        "habit_report": {
            "title":         "Habit Adherence Report",
            "completion_pct": habit_pct,
            "done_this_week": habit_done,
            "total_logged":   habit_total,
            "total_all_time": len(hlogs),
            "habits_tracked": habit_names,
            "trend":          "Improving" if habit_pct >= 70 else "Needs Attention",
        },

        "wakeup_report": {
            "title":          "Wake-up Pattern Report",
            "avg_wake_time":  avg_wake_str,
            "on_time_count":  on_time_c,
            "snoozed_count":  snoozed_c,
            "total_alarms":   len(week_alogs),
            "on_time_pct":    round(on_time_c / len(week_alogs) * 100) if week_alogs else 0,
            "active_alarms":  len([a for a in alarms if a.is_active]),
            "consistency":    "Excellent" if (on_time_c / len(week_alogs) >= 0.8 if week_alogs else False) else "Moderate",
        },

        "challenge_report": {
            "title":           "Challenge Performance Report",
            "total_attempts":  ch_total,
            "this_week":       ch_week,
            "accuracy_pct":    ch_acc,
            "total_score":     ch_score,
            "avg_solve_time":  avg_time,
            "type_breakdown":  type_breakdown,
            "recommended_level": (
                "Expert" if ch_acc >= 90 else "Hard" if ch_acc >= 75 else
                "Medium" if ch_acc >= 55 else "Easy" if ch_acc >= 40 else "Beginner"
            ),
        },

        "productivity_report": {
            "title":            "Productivity Score Report",
            "score":            prod_score,
            "grade":            prod_grade,
            "challenge_component": round(ch_acc, 1),
            "habit_component":     habit_pct,
            "sleep_component":     round(on_time_c / len(week_alogs) * 100) if week_alogs else 0,
            "insights": (
                "Outstanding productivity — you're in the top cognitive performance bracket!" if prod_score >= 90 else
                "Strong performance. Focus on consistency to reach the next level." if prod_score >= 70 else
                "Good foundation. Improve habit adherence and challenge accuracy for a big boost." if prod_score >= 50 else
                "Keep building — complete daily habits and morning challenges to accelerate growth."
            ),
        },

        "sleep_report": {
            "title":              "Sleep Analytics Report",
            "sleep_score":        sleep_score,
            "avg_wakefulness":    avg_wake_score,
            "days_labels":        days_labels,
            "days_scores":        days_scores,
            "week_avg_score":     round(sum(days_scores) / 7, 1),
            "total_alarm_events": len(alogs),
            "wakefulness_label": (
                "Fully Energized ⚡" if avg_wake_score >= 4.5 else
                "Mostly Alert 🙂" if avg_wake_score >= 3.5 else
                "Moderately Awake 😐" if avg_wake_score >= 2.5 else
                "Somewhat Sleepy 🥱" if avg_wake_score >= 1.5 else
                "Very Drowsy 😴" if avg_wake_score > 0 else "No data yet"
            ),
        },
    }


@app.get("/reports/export/{user_id}")
def export_report_csv(user_id: int, report_type: str = "all", db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if user_id != current_user.id and current_user.role not in ("admin", "wellness_coach"):
        raise HTTPException(status_code=403, detail="Access denied")
    """
    Exports user reports as CSV (Excel-compatible).
    report_type: all | habit | wakeup | challenge | productivity | sleep
    """
    from datetime import datetime, timedelta

    u        = db.query(User).filter(User.id == user_id).first()
    clogs    = db.query(ChallengeLog).filter(ChallengeLog.user_id == user_id).order_by(ChallengeLog.created_at.desc()).all()
    hlogs    = db.query(HabitLog).filter(HabitLog.user_id == user_id).order_by(HabitLog.log_date.desc()).all()
    alogs    = db.query(AlarmLog).filter(AlarmLog.user_id == user_id).order_by(AlarmLog.triggered_at.desc()).all()
    name     = u.full_name if u else f"User {user_id}"
    ts       = datetime.now().strftime("%Y%m%d_%H%M%S")
    now_str  = datetime.now().strftime("%B %d, %Y %H:%M")
    lines    = []

    def section(title):
        lines.append("")
        lines.append(f"=== {title} ===")
        lines.append(f"User: {name}   Generated: {now_str}")
        lines.append("")

    if report_type in ("all", "habit"):
        section("HABIT ADHERENCE REPORT")
        lines.append("Date,Habit Name,Completed")
        for h in hlogs:
            lines.append(f'{str(h.log_date)[:10]},{h.habit_name},{h.completed}')

    if report_type in ("all", "wakeup"):
        section("WAKE-UP PATTERN REPORT")
        lines.append("Date,Triggered At,Dismissed At,Status,Delay(s),Puzzle Solved")
        for l in alogs:
            lines.append(
                f'{str(l.triggered_at)[:10]},'
                f'{str(l.triggered_at)[:19]},'
                f'{str(l.dismissed_at)[:19] if l.dismissed_at else "—"},'
                f'{l.status},{l.delay_seconds},{l.puzzle_solved}'
            )

    if report_type in ("all", "challenge"):
        section("CHALLENGE PERFORMANCE REPORT")
        lines.append("Date,Type,Difficulty,Success,Score,Time(s),Wakefulness")
        for l in clogs:
            lines.append(
                f'{str(l.created_at)[:10]},'
                f'{l.challenge_type},{l.difficulty},'
                f'{l.success},{l.score},'
                f'{l.time_taken_seconds},'
                f'{l.wakefulness_score or "—"}'
            )

    if report_type in ("all", "productivity"):
        section("PRODUCTIVITY SCORE REPORT")
        total   = len(clogs)
        succ    = sum(1 for l in clogs if l.success)
        acc     = round(succ / total * 100, 1) if total else 0
        h_done  = sum(1 for h in hlogs if h.completed)
        h_total = len(hlogs)
        h_pct   = round(h_done / h_total * 100, 1) if h_total else 0
        on_time = sum(1 for l in alogs if l.status == "on_time")
        sleep_c = round(on_time / len(alogs) * 100, 1) if alogs else 0
        prod    = round(acc * 0.40 + h_pct * 0.35 + sleep_c * 0.25)
        grade   = ("S" if prod >= 90 else "A" if prod >= 75 else "B" if prod >= 60 else "C" if prod >= 45 else "D")
        lines.append("Metric,Value")
        lines.append(f"Overall Productivity Score,{prod}/100")
        lines.append(f"Grade,{grade}")
        lines.append(f"Challenge Accuracy (40%),{acc}%")
        lines.append(f"Habit Adherence (35%),{h_pct}%")
        lines.append(f"Sleep Routine (25%),{sleep_c}%")
        lines.append(f"Total Challenges,{total}")
        lines.append(f"Total Score Points,{sum(l.score for l in clogs)}")

    if report_type in ("all", "sleep"):
        section("SLEEP ANALYTICS REPORT")
        wakefulness = [l.wakefulness_score for l in clogs if l.wakefulness_score]
        avg_w       = round(sum(wakefulness) / len(wakefulness), 1) if wakefulness else 0
        lines.append("Metric,Value")
        lines.append(f"Total Alarm Events,{len(alogs)}")
        lines.append(f"On-Time Dismissals,{sum(1 for l in alogs if l.status == 'on_time')}")
        lines.append(f"Snoozed Alarms,{sum(1 for l in alogs if l.status == 'snoozed')}")
        lines.append(f"Avg Wakefulness Rating,{avg_w}/5")
        lines.append("")
        lines.append("Date,Wakefulness Score,Challenge Solved")
        for l in clogs:
            lines.append(f'{str(l.created_at)[:10]},{l.wakefulness_score or "—"},{l.success}')

    filename = f"cognitive_alarm_{report_type}_report_{ts}.csv"
    return StreamingResponse(
        io.StringIO("\n".join(lines)),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


@app.get("/reports/export-text/{user_id}")
def export_report_text(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if user_id != current_user.id and current_user.role not in ("admin", "wellness_coach"):
        raise HTTPException(status_code=403, detail="Access denied")
    """Exports a formatted plain-text report (used by frontend for PDF generation)."""
    from datetime import datetime, timedelta

    u        = db.query(User).filter(User.id == user_id).first()
    clogs    = db.query(ChallengeLog).filter(ChallengeLog.user_id == user_id).order_by(ChallengeLog.created_at.desc()).all()
    hlogs    = db.query(HabitLog).filter(HabitLog.user_id == user_id).all()
    alogs    = db.query(AlarmLog).filter(AlarmLog.user_id == user_id).order_by(AlarmLog.triggered_at.desc()).all()
    name     = u.full_name if u else f"User {user_id}"
    now_str  = datetime.now().strftime("%B %d, %Y at %H:%M")
    today    = datetime.now().date()
    week_ago = today - timedelta(days=7)

    total_c  = len(clogs)
    succ_c   = sum(1 for l in clogs if l.success)
    acc_c    = round(succ_c / total_c * 100, 1) if total_c else 0
    score_c  = sum(l.score for l in clogs)
    avg_t    = round(sum(l.time_taken_seconds for l in clogs) / total_c, 1) if total_c else 0

    h_done   = sum(1 for h in hlogs if h.completed)
    h_total  = len(hlogs)
    h_pct    = round(h_done / h_total * 100, 1) if h_total else 0

    on_time  = sum(1 for l in alogs if l.status == "on_time")
    sleep_c  = round(on_time / len(alogs) * 100, 1) if alogs else 0
    prod     = round(acc_c * 0.40 + h_pct * 0.35 + sleep_c * 0.25)
    grade    = ("S" if prod >= 90 else "A" if prod >= 75 else "B" if prod >= 60 else "C" if prod >= 45 else "D")

    wakefulness = [l.wakefulness_score for l in clogs if l.wakefulness_score]
    avg_w    = round(sum(wakefulness) / len(wakefulness), 1) if wakefulness else 0

    text = f"""COGNITIVE ALARM — PERSONAL PERFORMANCE REPORT
{'=' * 56}
Name    : {name}
Report  : Comprehensive Performance Summary
Period  : All time
Generated: {now_str}
{'=' * 56}

1. HABIT ADHERENCE
   Total habits logged    : {h_total}
   Habits completed       : {h_done}
   Completion rate        : {h_pct}%
   Status                 : {'Excellent' if h_pct >= 75 else 'Good' if h_pct >= 50 else 'Needs Improvement'}

2. WAKE-UP PATTERN
   Total alarm events     : {len(alogs)}
   On-time dismissals     : {on_time}
   Snoozed alarms         : {sum(1 for l in alogs if l.status == 'snoozed')}
   On-time rate           : {sleep_c}%

3. CHALLENGE PERFORMANCE
   Total attempts         : {total_c}
   Successful solves      : {succ_c}
   Accuracy rate          : {acc_c}%
   Total score points     : {score_c}
   Avg solve time         : {avg_t}s
   Recommended level      : {'Expert' if acc_c >= 90 else 'Hard' if acc_c >= 75 else 'Medium' if acc_c >= 55 else 'Easy' if acc_c >= 40 else 'Beginner'}

4. PRODUCTIVITY SCORE
   Overall score          : {prod}/100
   Grade                  : {grade}
   Challenge (40%)        : {acc_c}%
   Habit adherence (35%)  : {h_pct}%
   Sleep routine (25%)    : {sleep_c}%

5. SLEEP ANALYTICS
   Total alarm events     : {len(alogs)}
   Avg wakefulness rating : {avg_w}/5
   Wakefulness status     : {'Fully Energized' if avg_w >= 4.5 else 'Mostly Alert' if avg_w >= 3.5 else 'Moderate' if avg_w >= 2.5 else 'Sleepy' if avg_w > 0 else 'No data'}

{'=' * 56}
Generated by Cognitive Alarm Platform
"""
    return {"text": text, "name": name, "generated_at": now_str}
