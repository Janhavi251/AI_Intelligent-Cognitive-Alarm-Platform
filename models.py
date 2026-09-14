from datetime import datetime

from sqlalchemy import (
    Column,
    Integer,
    String,
    Boolean,
    Float,
    Time,
    DateTime,
    ForeignKey
)

from sqlalchemy.orm import relationship

from app.database import Base


class User(Base):

    __tablename__ = "users"

    id = Column(
        Integer,
        primary_key=True,
        index=True
    )

    full_name = Column(
        String(100),
        nullable=False
    )

    email = Column(
        String(255),
        unique=True,
        index=True,
        nullable=False
    )

    password_hash = Column(
        String(255),
        nullable=False
    )

    role = Column(
        String(30),
        nullable=False,
        default="user"
    )

    is_active = Column(
        Boolean,
        default=True
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow
    )

    profile = relationship(
    "UserProfile",
    back_populates="user",
    uselist=False,
    cascade="all, delete-orphan"
)

class UserProfile(Base):
    __tablename__ = "user_profiles"

    id = Column(
        Integer,
        primary_key=True,
        index=True
    )

    user_id = Column(
        Integer,
        ForeignKey("users.id"),
        unique=True,
        nullable=False
    )

    wake_up_time = Column(
        Time,
        nullable=True
    )

    sleep_time = Column(
        Time,
        nullable=True
    )

    sleep_duration = Column(
        Float,
        nullable=True
    )

    timezone = Column(
        String(100),
        default="Asia/Kolkata"
    )

    productivity_goal = Column(
        String(255),
        nullable=True
    )

    challenge_difficulty = Column(
        String(20),
        default="medium"
    )

    habit_preference = Column(
        String(255),
        nullable=True
    )

    user = relationship(
        "User",
        back_populates="profile"
    )