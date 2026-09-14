from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from dotenv import load_dotenv
from urllib.parse import quote_plus
import os
import tempfile


load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

IS_VERCEL = os.getenv("VERCEL") == "1" or "VERCEL_ENV" in os.environ

def get_database_url() -> str:
    # 1. Direct connection URL from environment (e.g. Vercel Postgres, Supabase, Neon, Railway)
    raw_url = os.getenv("DATABASE_URL") or os.getenv("POSTGRES_URL") or os.getenv("POSTGRES_PRISMA_URL")
    if raw_url:
        if raw_url.startswith("postgres://"):
            raw_url = raw_url.replace("postgres://", "postgresql://", 1)
        return raw_url

    # 2. Individual environment parameters
    db_host = os.getenv("DB_HOST")
    if db_host and db_host != "localhost":
        db_port = os.getenv("DB_PORT", "5432")
        db_name = os.getenv("DB_NAME", "wellspring")
        db_user = os.getenv("DB_USER", "postgres")
        db_pass = quote_plus(os.getenv("DB_PASSWORD", ""))
        return f"postgresql+psycopg2://{db_user}:{db_pass}@{db_host}:{db_port}/{db_name}"

    # 3. If on Vercel without remote DB variables, default to SQLite in /tmp
    if IS_VERCEL:
        tmp_dir = "/tmp" if os.name == "posix" else tempfile.gettempdir().replace("\\", "/")
        return f"sqlite:///{tmp_dir}/wellspring.db"

    # 4. Local development default
    db_host = os.getenv("DB_HOST", "localhost")
    db_port = os.getenv("DB_PORT", "5432")
    db_name = os.getenv("DB_NAME", "wellspring")
    db_user = os.getenv("DB_USER", "postgres")
    db_pass = quote_plus(os.getenv("DB_PASSWORD", ""))
    return f"postgresql+psycopg2://{db_user}:{db_pass}@{db_host}:{db_port}/{db_name}"

DATABASE_URL = get_database_url()

def build_engine(url: str):
    if url.startswith("sqlite"):
        return create_engine(url, connect_args={"check_same_thread": False})
    return create_engine(url, pool_pre_ping=True)

try:
    engine = build_engine(DATABASE_URL)
    # Test PostgreSQL connection on load if not SQLite
    if not DATABASE_URL.startswith("sqlite"):
        with engine.connect() as conn:
            pass
except Exception as err:
    print(f"Warning: Could not connect to database ({DATABASE_URL}): {err}. Falling back to SQLite.")
    tmp_dir = "/tmp" if (IS_VERCEL or os.name == "posix") else tempfile.gettempdir().replace("\\", "/")
    DATABASE_URL = f"sqlite:///{tmp_dir}/wellspring.db"
    engine = build_engine(DATABASE_URL)


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db():
    """Create all tables that don't yet exist (safe to call on startup)."""
    try:
        try:
            from models import Base
        except ImportError:
            from backend.models import Base
        Base.metadata.create_all(bind=engine)
    except Exception as e:
        print(f"Error initializing database tables: {e}")


def get_db():
    """FastAPI dependency — yields a DB session and closes it after the request."""
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()

