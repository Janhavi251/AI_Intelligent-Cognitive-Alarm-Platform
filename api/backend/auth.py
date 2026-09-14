import bcrypt
from jose import jwt, JWTError
from datetime import datetime, timedelta
from dotenv import load_dotenv
import os

# Load .env from the same folder as this file
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

SECRET_KEY = os.getenv("SECRET_KEY", "changeme")
ALGORITHM = "HS256"


def hash_password(plain: str) -> str:
    """Hash a plain-text password using bcrypt."""
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    """Check a plain password against a stored bcrypt hash."""
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_token(user_id: int, role: str) -> str:
    """Create a JWT token containing user id and role, valid for 24 hours."""
    payload = {
        "sub": str(user_id),
        "role": role,
        "exp": datetime.utcnow() + timedelta(hours=24)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str):
    """Decode and verify a JWT token. Returns payload dict or None."""
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None
