from fastapi import FastAPI, Request
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles

from fastapi import Depends, Form
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.database import Base, engine, get_db
from app.models import User, UserProfile
from app.security import (
    hash_password,
    verify_password,
    create_access_token,
    decode_access_token
)
from datetime import datetime
from fastapi import Query


app = FastAPI(
    title="Intelligent Cognitive Alarm Platform"
)

Base.metadata.create_all(bind=engine)

# Connect the static folder
app.mount(
    "/static",
    StaticFiles(directory="app/static"),
    name="static"
)


# Connect the templates folder
templates = Jinja2Templates(
    directory="app/templates"
)


@app.get("/")
def home(request: Request):

    return templates.TemplateResponse(
        request=request,
        name="index.html"
    )

@app.get("/login")
def login_selection(request: Request):

    return templates.TemplateResponse(
        request=request,
        name="login.html"
    )
@app.get("/login/user")
def user_login(request: Request):

    return templates.TemplateResponse(
        request=request,
        name="role_login.html",
        context={
            "role": "user",
            "role_name": "User",
            "error": None
        }
    )


@app.get("/login/coach")
def coach_login(request: Request):

    return templates.TemplateResponse(
        request=request,
        name="role_login.html",
        context={
            "role": "coach",
            "role_name": "Wellness Coach",
            "error": None
        }
    )


@app.get("/login/admin")
def admin_login(request: Request):

    return templates.TemplateResponse(
        request=request,
        name="role_login.html",
        context={
            "role": "admin",
            "role_name": "Administrator",
            "error": None
        }
    )

@app.get("/register")
def register_page(request: Request):

    return templates.TemplateResponse(
        request=request,
        name="register.html",
        context={
            "error": None
        }
    )
@app.post("/register")
def register_user(
    request: Request,
    full_name: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    confirm_password: str = Form(...),
    db: Session = Depends(get_db)
):

    # Remove accidental spaces
    full_name = full_name.strip()
    email = email.strip().lower()


    # Validate passwords
    if password != confirm_password:

        return templates.TemplateResponse(
            request=request,
            name="register.html",
            context={
                "error": "Passwords do not match."
            },
            status_code=400
        )


    # Check whether email already exists
    existing_user = (
        db.query(User)
        .filter(User.email == email)
        .first()
    )


    if existing_user:

        return templates.TemplateResponse(
            request=request,
            name="register.html",
            context={
                "error": "An account with this email already exists."
            },
            status_code=400
        )


    # Hash password
    hashed_password = hash_password(password)


    # Create Python User object
    new_user = User(
        full_name=full_name,
        email=email,
        password_hash=hashed_password,
        role="user"
    )


    # Add to database
    db.add(new_user)

    db.commit()

    db.refresh(new_user)


    # Registration successful
    return RedirectResponse(
        url="/login/user?registered=true",
        status_code=303
    )

@app.get("/test")
def test():
    return {"status": "FastAPI is working"}  

def authenticate_user(
    email: str,
    password: str,
    expected_role: str,
    db: Session
):

    email = email.strip().lower()

    user = (
        db.query(User)
        .filter(User.email == email)
        .first()
    )

    if not user:
        return None, "Invalid email or password."


    if not verify_password(
        password,
        user.password_hash
    ):
        return None, "Invalid email or password."


    if not user.is_active:
        return None, "This account is inactive."


    if user.role != expected_role:
        return None, "You are not authorized to use this login."


    return user, None  

@app.post("/login/user")
def process_user_login(
    request: Request,
    email: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(get_db)
):

    user, error = authenticate_user(
        email=email,
        password=password,
        expected_role="user",
        db=db
    )


    if error:

        return templates.TemplateResponse(
            request=request,
            name="role_login.html",
            context={
                "role": "user",
                "role_name": "User",
                "error": error
            },
            status_code=401
        )


    access_token = create_access_token(
    user_id=user.id,
    role=user.role
)


    response = RedirectResponse(
    url="/dashboard/user",
    status_code=303
    )


    response.set_cookie(
    key="access_token",
    value=access_token,
    httponly=True,
    max_age=3600,
    samesite="lax"
)


    return response

@app.post("/login/coach")
def process_coach_login(
    request: Request,
    email: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(get_db)
):

    user, error = authenticate_user(
        email=email,
        password=password,
        expected_role="coach",
        db=db
    )


    if error:

        return templates.TemplateResponse(
            request=request,
            name="role_login.html",
            context={
                "role": "coach",
                "role_name": "Wellness Coach",
                "error": error
            },
            status_code=401
        )

    access_token = create_access_token(
    user_id=user.id,
    role=user.role
)


    response = RedirectResponse(
    url="/dashboard/coach",
    status_code=303
)


    response.set_cookie(
    key="access_token",
    value=access_token,
    httponly=True,
    max_age=3600,
    samesite="lax"
)


    return response

@app.post("/login/admin")
def process_admin_login(
    request: Request,
    email: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(get_db)
):

    user, error = authenticate_user(
        email=email,
        password=password,
        expected_role="admin",
        db=db
    )


    if error:

        return templates.TemplateResponse(
            request=request,
            name="role_login.html",
            context={
                "role": "admin",
                "role_name": "Administrator",
                "error": error
            },
            status_code=401
        )


    access_token = create_access_token(
    user_id=user.id,
    role=user.role
)


    response = RedirectResponse(
    url="/dashboard/admin",
    status_code=303
)


    response.set_cookie(
    key="access_token",
    value=access_token,
    httponly=True,
    max_age=3600,
    samesite="lax"
)

    return response

@app.get("/dashboard/user")
def user_dashboard(
    request: Request,
    db: Session = Depends(get_db)
):

    # Get the currently logged-in user from JWT
    user = get_current_user(
        request=request,
        db=db
    )

    # User is not logged in
    if not user:
        return RedirectResponse(
            url="/login/user",
            status_code=303
        )

    # Only normal users can access this dashboard
    if user.role != "user":
        return RedirectResponse(
            url="/login",
            status_code=303
        )

    # Get this user's profile from PostgreSQL
    profile = (
        db.query(UserProfile)
        .filter(
            UserProfile.user_id == user.id
        )
        .first()
    )

    # Send both user and profile to the HTML template
    return templates.TemplateResponse(
        request=request,
        name="user_dashboard.html",
        context={
            "user": user,
            "profile": profile
        }
    )

def get_current_user(
    request: Request,
    db: Session
):

    token = request.cookies.get(
        "access_token"
    )


    if not token:
        return None


    payload = decode_access_token(token)


    if not payload:
        return None


    user_id = payload.get("sub")


    if not user_id:
        return None


    try:

        user_id = int(user_id)

    except ValueError:

        return None


    user = (
        db.query(User)
        .filter(User.id == user_id)
        .first()
    )


    if not user:
        return None


    if not user.is_active:
        return None


    return user

@app.get("/logout")
def logout():

    response = RedirectResponse(
        url="/",
        status_code=303
    )


    response.delete_cookie(
        key="access_token"
    )


    return response

@app.get("/dashboard/coach")
def coach_dashboard(
    request: Request,
    db: Session = Depends(get_db)
):

    user = get_current_user(
        request=request,
        db=db
    )


    if not user:

        return RedirectResponse(
            url="/login/coach",
            status_code=303
        )


    if user.role != "coach":

        return RedirectResponse(
            url="/login",
            status_code=303
        )


    return templates.TemplateResponse(
        request=request,
        name="coach_dashboard.html",
        context={
            "user": user
        }
    )

@app.get("/dashboard/admin")
def admin_dashboard(
    request: Request,
    db: Session = Depends(get_db)
):

    user = get_current_user(
        request=request,
        db=db
    )


    if not user:

        return RedirectResponse(
            url="/login/admin",
            status_code=303
        )


    if user.role != "admin":

        return RedirectResponse(
            url="/login",
            status_code=303
        )


    total_users = (
        db.query(User)
        .count()
    )


    active_users = (
        db.query(User)
        .filter(User.is_active == True)
        .count()
    )


    return templates.TemplateResponse(
        request=request,
        name="admin_dashboard.html",
        context={
            "user": user,
            "total_users": total_users,
            "active_users": active_users
        }
    )

@app.get("/profile")
def profile_page(
    request: Request,
    db: Session = Depends(get_db)
):

    user = get_current_user(
        request=request,
        db=db
    )

    if not user:

        return RedirectResponse(
            url="/login/user",
            status_code=303
        )

    if user.role != "user":

        return RedirectResponse(
            url="/login",
            status_code=303
        )


    profile = (
        db.query(UserProfile)
        .filter(
            UserProfile.user_id == user.id
        )
        .first()
    )


    return templates.TemplateResponse(
        request=request,
        name="profile.html",
        context={
            "user": user,
            "profile": profile,
            "success": None,
            "error": None
        }
    )

@app.post("/profile")
def save_profile(
    request: Request,

    wake_up_time: str = Form(""),
    sleep_time: str = Form(""),
    sleep_duration: str = Form(""),
    timezone: str = Form("Asia/Kolkata"),
    productivity_goal: str = Form(""),
    challenge_difficulty: str = Form("medium"),
    habit_preference: str = Form(""),

    db: Session = Depends(get_db)
):

    user = get_current_user(
        request=request,
        db=db
    )


    if not user:

        return RedirectResponse(
            url="/login/user",
            status_code=303
        )


    if user.role != "user":

        return RedirectResponse(
            url="/login",
            status_code=303
        )


    profile = (
        db.query(UserProfile)
        .filter(
            UserProfile.user_id == user.id
        )
        .first()
    )


    try:

        parsed_wake_time = (
            datetime.strptime(
                wake_up_time,
                "%H:%M"
            ).time()
            if wake_up_time
            else None
        )


        parsed_sleep_time = (
            datetime.strptime(
                sleep_time,
                "%H:%M"
            ).time()
            if sleep_time
            else None
        )


        parsed_duration = (
            float(sleep_duration)
            if sleep_duration
            else None
        )


        if parsed_duration is not None:

            if parsed_duration < 1 or parsed_duration > 16:

                raise ValueError(
                    "Sleep duration must be between 1 and 16 hours."
                )


        allowed_difficulties = {
            "easy",
            "medium",
            "hard"
        }


        if challenge_difficulty not in allowed_difficulties:

            raise ValueError(
                "Invalid challenge difficulty."
            )


        if not profile:

            profile = UserProfile(
                user_id=user.id
            )

            db.add(profile)


        profile.wake_up_time = parsed_wake_time

        profile.sleep_time = parsed_sleep_time

        profile.sleep_duration = parsed_duration

        profile.timezone = timezone

        profile.productivity_goal = (
            productivity_goal.strip()
            or None
        )

        profile.challenge_difficulty = (
            challenge_difficulty
        )

        profile.habit_preference = (
            habit_preference
            or None
        )


        db.commit()

        db.refresh(profile)


        return templates.TemplateResponse(
            request=request,
            name="profile.html",
            context={
                "user": user,
                "profile": profile,
                "success": "Profile preferences saved successfully.",
                "error": None
            }
        )


    except ValueError as error:

        db.rollback()

        return templates.TemplateResponse(
            request=request,
            name="profile.html",
            context={
                "user": user,
                "profile": profile,
                "success": None,
                "error": str(error)
            },
            status_code=400
        )