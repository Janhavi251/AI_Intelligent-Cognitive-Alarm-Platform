import sys
import os

# Add backend directory to Python path — Vercel runs from /var/task (repo root)
_backend = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'backend'))
if _backend not in sys.path:
    sys.path.insert(0, _backend)

_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if _root not in sys.path:
    sys.path.insert(0, _root)

# Import the FastAPI app — Vercel uses `app` as the ASGI handler
try:
    from main import app  # noqa: F401
except ImportError:
    from backend.main import app  # noqa: F401

