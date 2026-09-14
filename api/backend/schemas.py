from pydantic import BaseModel, Field
from typing import Optional, List, Any, Union

class ChallengeRequest(BaseModel):
    challenge_type: str = Field(default="math", description="math, logic, memory, word, pattern, riddle, quiz, random")
    difficulty: str = Field(default="medium", description="beginner, easy, medium, hard, expert")

class ChallengeResponse(BaseModel):
    challenge_id: str
    type: str
    difficulty: str
    title: str
    instructions: str
    question: Any  # String, List, or Dict depending on challenge type
    options: Optional[List[str]] = None
    input_type: str  # "number", "text", "choice", "sequence"
    hint: Optional[str] = None
    time_limit: int  # in seconds
    answer_key: str  # Encrypted or plain text string representation for verification

class ChallengeVerifyRequest(BaseModel):
    user_id: Optional[int] = None
    alarm_id: Optional[int] = None
    challenge_id: str
    challenge_type: Optional[str] = "math"
    difficulty: Optional[str] = "medium"
    answer_key: str
    user_answer: str
    time_taken_seconds: float = 0.0
    wakefulness_score: Optional[int] = None  # 1 to 5 assessment scale

class ChallengeVerifyResponse(BaseModel):
    success: bool
    message: str
    correct_answer: str
    score: int
    log_id: Optional[int] = None

class WakefulnessLogRequest(BaseModel):
    log_id: Optional[int] = None
    user_id: Optional[int] = None
    alarm_id: Optional[int] = None
    score: int  # 1 to 5 rating

class AchievementItem(BaseModel):
    id: Optional[int] = None
    badge_key: str
    title: str
    description: str
    icon: str
    unlocked: bool
    progress_percent: int = 0
    unlocked_at: Optional[str] = None

class LearningTrendResponse(BaseModel):
    user_id: int
    growth_rate_percent: float
    speed_improvement_percent: float
    category_balance: dict
    strongest_domain: str
    focus_domain: str
    recommendation: str
    weekly_velocity: List[dict]


class CircadianConsistency(BaseModel):
    consistency_score: int
    wake_variance_minutes: float
    rhythm_stability: str


class SnoozeProfile(BaseModel):
    snooze_frequency_percent: float
    avg_snoozes_per_alarm: float
    snooze_risk_level: str
    risk_badge_color: str
    peak_snooze_day: Optional[str] = "Monday"
    avg_snooze_delay_minutes: Optional[float] = 9.5
    habitual_pattern: Optional[str] = "Low Dependency"


class SnoozePatternAnalysis(BaseModel):
    snooze_rate_pct: float
    primary_snooze_trigger: str
    peak_snooze_day: str
    avg_delay_mins: float
    relapse_probability_pct: int
    pattern_summary: str
    daily_snooze_trend: Optional[List[dict]] = None


class SleepInertia(BaseModel):
    inertia_index_seconds: float
    warmup_rate_percent: float
    peak_alertness_window: str


class PredictiveForecast(BaseModel):
    predicted_wakefulness_score: float
    forecast_label: str
    confidence_percent: int


class BehavioralAnalyticsResponse(BaseModel):
    user_id: int
    circadian_consistency: CircadianConsistency
    snooze_profile: SnoozeProfile
    snooze_pattern_analysis: Optional[SnoozePatternAnalysis] = None
    sleep_inertia: SleepInertia
    predictive_forecast: PredictiveForecast
    behavioral_nudges: List[str]

