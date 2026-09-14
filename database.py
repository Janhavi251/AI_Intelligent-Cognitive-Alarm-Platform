import sys
import os

_backend = os.path.abspath(os.path.join(os.path.dirname(__file__), 'backend'))
if _backend not in sys.path:
    sys.path.insert(0, _backend)

from backend.database import engine, SessionLocal, get_db, init_db, DATABASE_URL
from backend.models import Base