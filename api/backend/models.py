from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, Time, Float,
    ForeignKey, func
)
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id            = Column(Integer, primary_key=True, index=True)
    full_name     = Column(String(100), nullable=False)
    email         = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=True)
    role          = Column(String(20), nullable=False, default="user")
    provider      = Column(String(20), nullable=False, default="local")
    is_active     = Column(Boolean, nullable=False, default=True)
    created_at    = Column(DateTime(timezone=True), server_default=func.now())
    updated_at    = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    alarms         = relationship("Alarm", back_populates="user", cascade="all, delete-orphan")
    challenge_logs = relationship("ChallengeLog", back_populates="user", cascade="all, delete-orphan")
    achievements   = relationship("Achievement", back_populates="user", cascade="all, delete-orphan")
    habit_logs     = relationship("HabitLog", back_populates="user", cascade="all, delete-orphan")
    alarm_logs     = relationship("AlarmLog", back_populates="user", cascade="all, delete-orphan")


class Alarm(Base):
    __tablename__ = "alarms"

    id               = Column(Integer, primary_key=True, index=True)
    user_id          = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title            = Column(String(150), nullable=False, default="My Alarm")
    alarm_time       = Column(Time, nullable=False)
    alarm_type       = Column(String(20), nullable=False, default="daily")
    repeat_days      = Column(String(20), nullable=False, default="Mon-Fri")
    is_active        = Column(Boolean, nullable=False, default=True)
    difficulty_level = Column(String(20), nullable=False, default="medium")
    challenge        = Column(String(50), nullable=False, default="math")
    sound            = Column(String(100), nullable=False, default="default")
    vibration        = Column(Boolean, nullable=False, default=True)
    snooze_enabled   = Column(Boolean, nullable=False, default=True)
    snooze_duration  = Column(Integer, nullable=False, default=5)
    max_snooze_count = Column(Integer, nullable=False, default=3)
    current_snooze_count = Column(Integer, nullable=False, default=0)
    question_count   = Column(Integer, nullable=False, default=2)
    created_at       = Column(DateTime(timezone=True), server_default=func.now())
    updated_at       = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user = relationship("User", back_populates="alarms")


class ChallengeLog(Base):
    __tablename__ = "challenge_logs"

    id                 = Column(Integer, primary_key=True, index=True)
    user_id            = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    alarm_id           = Column(Integer, ForeignKey("alarms.id", ondelete="SET NULL"), nullable=True)
    challenge_type     = Column(String(50), nullable=False)
    difficulty         = Column(String(20), nullable=False)
    success            = Column(Boolean, nullable=False)
    score              = Column(Integer, nullable=False, default=0)
    time_taken_seconds = Column(Float, nullable=False, default=0.0)
    wakefulness_score  = Column(Integer, nullable=True)  # 1 to 5 assessment scale
    created_at         = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="challenge_logs")


class AlarmLog(Base):
    __tablename__ = "alarm_logs"

    id            = Column(Integer, primary_key=True, index=True)
    alarm_id      = Column(Integer, ForeignKey("alarms.id", ondelete="CASCADE"), nullable=True)
    user_id       = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    triggered_at  = Column(DateTime(timezone=True), server_default=func.now())
    dismissed_at  = Column(DateTime(timezone=True), nullable=True)
    status        = Column(String(20), nullable=False, default="on_time")
    delay_seconds = Column(Integer, default=0)
    puzzle_solved = Column(Boolean, nullable=False, default=False)

    user  = relationship("User", back_populates="alarm_logs")


class HabitLog(Base):
    __tablename__ = "habit_logs"

    id         = Column(Integer, primary_key=True, index=True)
    user_id    = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    habit_name = Column(String(150), nullable=False)
    completed  = Column(Boolean, nullable=False, default=False)
    log_date   = Column(DateTime(timezone=True), server_default=func.current_date())

    user = relationship("User", back_populates="habit_logs")


class Achievement(Base):
    __tablename__ = "achievements"

    id          = Column(Integer, primary_key=True, index=True)
    user_id     = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    badge_key   = Column(String(50), nullable=False)
    title       = Column(String(100), nullable=False)
    description = Column(String(255), nullable=False)
    icon        = Column(String(20), nullable=False, default="🏆")
    unlocked    = Column(Boolean, nullable=False, default=False)
    unlocked_at = Column(DateTime(timezone=True), nullable=True)

    user = relationship("User", back_populates="achievements")


class CoachSession(Base):
    __tablename__ = "coach_sessions"

    id           = Column(Integer, primary_key=True, index=True)
    client_id    = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    coach_id     = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    coach_name   = Column(String(100), nullable=False)
    client_name  = Column(String(100), nullable=False)
    date         = Column(String(10),  nullable=False)   # "2026-09-20"
    time         = Column(String(5),   nullable=False)   # "14:30"
    duration_min = Column(Integer,     nullable=False, default=30)
    topic        = Column(String(150), nullable=False, default="General Check-in")
    notes        = Column(String(300), nullable=True,  default="")
    status       = Column(String(20),  nullable=False, default="scheduled")
    created_at   = Column(DateTime(timezone=True), server_default=func.now())


class PersonalNotification(Base):
    __tablename__ = "personal_notifications"

    id           = Column(Integer, primary_key=True, index=True)
    user_id      = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    sent_by_id   = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"),  nullable=True)
    sent_by_name = Column(String(100), nullable=False, default="System")
    notif_type   = Column(String(30),  nullable=False, default="announcement")
    icon         = Column(String(10),  nullable=False, default="📬")
    title        = Column(String(150), nullable=False)
    body         = Column(String(500), nullable=False)
    priority     = Column(String(10),  nullable=False, default="normal")
    is_read      = Column(Boolean,     nullable=False, default=False)
    session_id   = Column(Integer,     nullable=True)   # optional FK to coach_sessions
    created_at   = Column(DateTime(timezone=True), server_default=func.now())

