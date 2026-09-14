import sys
import os

# Ensure backend directory and repo root are in Python path for Vercel serverless environment
_here = os.path.dirname(os.path.abspath(__file__))
_root = os.path.abspath(os.path.join(_here, '..'))
_backend = os.path.abspath(os.path.join(_here, '..', 'backend'))

for path in [_backend, _root, _here]:
    if path not in sys.path:
        sys.path.insert(0, path)

# Import backend.main explicitly so Vercel dependency builder traces and packages backend files
try:
    import backend.main as backend_main
    app = backend_main.app
except Exception:
    from main import app  # noqa: F401


