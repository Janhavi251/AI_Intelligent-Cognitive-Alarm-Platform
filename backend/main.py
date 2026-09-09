from typing import List, Optional, Any
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from starlette.middleware.sessions import SessionMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
try:
    from database import get_db, engine
    from models import User, Alarm, ChallengeLog, HabitLog, Achievement, Base
    from schemas import ChallengeResponse, ChallengeVerifyRequest, ChallengeVerifyResponse, AchievementItem, LearningTrendResponse, WakefulnessLogRequest, BehavioralAnalyticsResponse
    from challenge_generator import generate_cognitive_challenge
    from auth import hash_password, verify_password, create_token
except ImportError:
    from backend.database import get_db, engine
    from backend.models import User, Alarm, ChallengeLog, HabitLog, Achievement, Base
    from backend.schemas import ChallengeResponse, ChallengeVerifyRequest, ChallengeVerifyResponse, AchievementItem, LearningTrendResponse, WakefulnessLogRequest, BehavioralAnalyticsResponse
    from backend.challenge_generator import generate_cognitive_challenge
    from backend.auth import hash_password, verify_password, create_token
from authlib.integrations.starlette_client import OAuth
from urllib.parse import quote
import traceback
import os

app = FastAPI(title="Wellspring API")
Base.metadata.create_all(bind=engine)

# Ensure database tables & schema migrations
try:
    Base.metadata.create_all(bind=engine)
    with engine.connect() as conn:
        from sqlalchemy import text
        conn.execute(text("ALTER TABLE challenge_logs ADD COLUMN IF NOT EXISTS alarm_id INTEGER REFERENCES alarms(id) ON DELETE SET NULL;"))
        conn.execute(text("ALTER TABLE challenge_logs ADD COLUMN IF NOT EXISTS wakefulness_score INTEGER;"))
        conn.execute(text("ALTER TABLE alarms ADD COLUMN IF NOT EXISTS question_count INTEGER DEFAULT 2;"))
        conn.commit()
except Exception as e:
    print(f"Startup DB migration info: {e}")

# ── Middleware ───────────────────────────────────────────────
app.add_middleware(SessionMiddleware, secret_key=os.getenv("SECRET_KEY", "changeme"))
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

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
    return JSONResponse(status_code=500, content={"detail": str(exc)})


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


@app.post("/auth/signup")
def signup(data: SignupRequest, db: Session = Depends(get_db)):
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
def signin(data: SigninRequest, db: Session = Depends(get_db)):
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
def create_alarm(data: AlarmCreate, db: Session = Depends(get_db)):
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
def get_alarms(user_id: int, db: Session = Depends(get_db)):
    alarms = db.query(Alarm).filter(Alarm.user_id == user_id).order_by(Alarm.created_at.desc()).all()
    return [alarm_to_dict(a) for a in alarms]


@app.put("/alarms/{alarm_id}")
def update_alarm(alarm_id: int, data: AlarmUpdate, db: Session = Depends(get_db)):
    alarm = db.query(Alarm).filter(Alarm.id == alarm_id).first()
    if not alarm:
        raise HTTPException(status_code=404, detail="Alarm not found")

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
def toggle_alarm(alarm_id: int, db: Session = Depends(get_db)):
    alarm = db.query(Alarm).filter(Alarm.id == alarm_id).first()
    if not alarm:
        raise HTTPException(status_code=404, detail="Alarm not found")
    alarm.is_active = not alarm.is_active
    db.commit()
    return {"alarm_id": alarm.id, "is_active": alarm.is_active}


class AlarmSnoozeUpdate(BaseModel):
    increment: bool = True
    reset: bool = False

@app.patch("/alarms/{alarm_id}/snooze")
def update_alarm_snooze(alarm_id: int, data: AlarmSnoozeUpdate, db: Session = Depends(get_db)):
    alarm = db.query(Alarm).filter(Alarm.id == alarm_id).first()
    if not alarm:
        raise HTTPException(status_code=404, detail="Alarm not found")
    if data.reset:
        alarm.current_snooze_count = 0
    elif data.increment:
        alarm.current_snooze_count = getattr(alarm, "current_snooze_count", 0) + 1
    db.commit()
    db.refresh(alarm)
    return alarm_to_dict(alarm)


@app.delete("/alarms/{alarm_id}")
def delete_alarm(alarm_id: int, db: Session = Depends(get_db)):
    alarm = db.query(Alarm).filter(Alarm.id == alarm_id).first()
    if not alarm:
        raise HTTPException(status_code=404, detail="Alarm not found")
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
def get_personalized_challenge(user_id: int, type: str = "math", db: Session = Depends(get_db)):
    """Personalized Challenge Selection algorithm based on user history in DB:
    - Previous performance (accuracy %, total score)
    - Average time taken
    - Difficulty level completed
    - Frustration prevention auto-softening (2 consecutive fails -> step down difficulty)
    Adaptive Rule: High performance (>80% accuracy) -> Level Up. Low performance (<40% accuracy) -> Level Down."""
    
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
def get_user_achievements(user_id: int, db: Session = Depends(get_db)):
    """Gamified Achievements & Badges Evaluation Engine."""
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
def get_learning_trends(user_id: int, db: Session = Depends(get_db)):
    """Advanced Learning Pattern & Trend Analysis Endpoint."""
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
def get_user_performance(user_id: int, db: Session = Depends(get_db)):
    """Returns analytics for Dashboard Challenge Performance Card, Streak & Pie Chart."""
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
def get_challenge_history(user_id: int = None, db: Session = Depends(get_db)):
    query = db.query(ChallengeLog)
    if user_id and user_id > 0:
        query = query.filter((ChallengeLog.user_id == user_id) | (ChallengeLog.user_id.is_(None) if user_id == 1 else False))
    
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
def get_behavioral_analytics(user_id: int, db: Session = Depends(get_db)):
    """
    Behavioral Analytics Engine Endpoint.
    Analyzes circadian rhythm variance, snooze habits, sleep inertia latency,
    predictive wakefulness forecasting, and provides targeted AI behavioral nudges.
    """
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
def log_habit(data: HabitLogRequest, db: Session = Depends(get_db)):
    """Save or update today's habit completion state for a user."""
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
def get_habit_adherence(user_id: int, db: Session = Depends(get_db)):
    """Returns today's habit state + 7-day adherence score for the user."""
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


# ── Health check ─────────────────────────────────────────────
@app.get("/")
def root():
    return {"status": "Wellspring API is running"}

