import sys
import os

# FastAPI Serverless Handler for Vercel deployment
_here = os.path.dirname(os.path.abspath(__file__))

_api_backend = os.path.join(_here, 'backend')
_root_backend = os.path.abspath(os.path.join(_here, '..', 'backend'))
_root = os.path.abspath(os.path.join(_here, '..'))

for path in [_api_backend, _root_backend, _root, _here]:
    if path not in sys.path:
        sys.path.insert(0, path)

try:
    from backend.main import app  # noqa: F401
except ImportError:
    from main import app  # noqa: F401



