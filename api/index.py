"""
Vercel Python Serverless Entry Point
=====================================
Vercel looks for `api/index.py` and expects an `app` (ASGI) or `handler` object.
We import the FastAPI app from backend/main.py and re-export it as `app`.
All environment variables (DB_HOST, DB_PASSWORD, SECRET_KEY, etc.) must be set
in the Vercel project dashboard under Settings → Environment Variables.
"""
import sys
import os

# Make the backend package importable from this file's location
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

# Import the FastAPI application
from main import app  # noqa: F401  — Vercel picks this up as the ASGI handler
