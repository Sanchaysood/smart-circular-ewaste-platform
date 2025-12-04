# backend/main.py
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List

import hashlib
import json
import os
import pickle
import uuid

# --- added for model inference (safe/optional) ---
import time
from PIL import Image

try:
    from ultralytics import YOLO
    ULTRALYTICS_AVAILABLE = True
except Exception:
    ULTRALYTICS_AVAILABLE = False
# --------------------------------------------------

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from jose import jwt
from pydantic import BaseModel
from sqlalchemy import create_engine, Column, Integer, String, DateTime, Text
from sqlalchemy.orm import sessionmaker, declarative_base, Session

# -----------------------------------------------------------------------------
# CONFIG (paths stay INSIDE backend/)
# -----------------------------------------------------------------------------
BASE_DIR = os.path.dirname(__file__)
SECRET_KEY = "change-this-in-production"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 12

# Optional: expected Google OAuth client ID (set as env var in production)
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")

DB_URL = "sqlite:///" + os.path.join(BASE_DIR, "ewaste.db")
MODELS_DIR = os.path.join(BASE_DIR, "models")
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# -----------------------------------------------------------------------------
# APP + CORS
# -----------------------------------------------------------------------------
app = FastAPI(title="Smart Circular E-Waste Platform API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# serve uploads
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# -----------------------------------------------------------------------------
# DATABASE
# -----------------------------------------------------------------------------
engine = create_engine(DB_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
Base = declarative_base()


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    email = Column(String(200), unique=True, index=True, nullable=False)
    password_hash = Column(String(128), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class Listing(Base):
    __tablename__ = "listings"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True, nullable=False)
    payload = Column(Text, nullable=False)          # JSON of submitted fields
    image_path = Column(String(300), nullable=False)
    # NEW: prediction blob, image md5, and dedupe key
    result_json = Column(Text, nullable=True)
    image_md5 = Column(String(32), index=True, nullable=True)
    dedupe_key = Column(String(64), index=True, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


def init_db():
    Base.metadata.create_all(bind=engine)
    # best-effort migration for older DBs (SQLite)
    with engine.connect() as con:
        for alter_sql in [
            "ALTER TABLE listings ADD COLUMN result_json TEXT",
            "ALTER TABLE listings ADD COLUMN image_md5 VARCHAR(32)",
            "ALTER TABLE listings ADD COLUMN dedupe_key VARCHAR(64)",
        ]:
            try:
                con.exec_driver_sql(alter_sql)
            except Exception:
                # column may already exist — ignore
                pass


# -----------------------------------------------------------------------------
# HELPERS: DB session, hashing, JWT
# -----------------------------------------------------------------------------
def get_db() -> Session:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def sha256(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def create_access_token(data: dict, expires_minutes: int = ACCESS_TOKEN_EXPIRE_MINUTES) -> str:
    to_encode = data.copy()
    to_encode["exp"] = datetime.utcnow() + timedelta(minutes=expires_minutes)
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> Dict[str, Any]:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def require_user(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    """
    Accepts Authorization: Bearer <token> (or just the token).
    """
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    token = authorization[7:] if authorization.lower().startswith("bearer ") else authorization
    payload = decode_token(token)
    email = payload.get("sub")
    if not email:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=401, detail="User no longer exists")
    return user


# -----------------------------------------------------------------------------
# OPTIONAL: load pickled models if available
# -----------------------------------------------------------------------------
def load_pickle(path: str):
    try:
        with open(path, "rb") as f:
            return pickle.load(f)
    except Exception:
        return None


PRICE_MODEL = load_pickle(os.path.join(MODELS_DIR, "price_model.pkl"))
RUL_MODEL = load_pickle(os.path.join(MODELS_DIR, "rul_model.pkl"))
DECISION_MODEL = load_pickle(os.path.join(MODELS_DIR, "decision_model.pkl"))

# ---------------------------------------------------------------------
# Load YOLO detection model (optional, safe)
# ---------------------------------------------------------------------
YOLO_MODEL = None
YOLO_MODEL_NAME = None


def try_load_yolo_model():
    global YOLO_MODEL, YOLO_MODEL_NAME
    if not ULTRALYTICS_AVAILABLE:
        print("[startup] ultralytics not available; skipping YOLO load")
        return
    if not os.path.isdir(MODELS_DIR):
        print(f"[startup] models dir not found: {MODELS_DIR}")
        return
    candidates = [f for f in os.listdir(MODELS_DIR) if f.endswith(".pt") or f.endswith(".onnx")]
    if not candidates:
        print("[startup] no .pt/.onnx files found in models dir")
        return
    chosen = None
    for c in candidates:
        if "yolo" in c.lower() or "yolov8" in c.lower() or "best" in c.lower():
            chosen = c
            break
    if chosen is None:
        chosen = candidates[0]
    path = os.path.join(MODELS_DIR, chosen)
    try:
        YOLO_MODEL = YOLO(path)
        YOLO_MODEL_NAME = chosen
        print(f"[startup] Loaded YOLO model: {chosen}")
    except Exception as e:
        YOLO_MODEL = None
        YOLO_MODEL_NAME = None
        print(f"[startup] Failed to load YOLO model {path}: {e}")


# -----------------------------------------------------------------------------
# SCHEMAS
# -----------------------------------------------------------------------------
class RegisterIn(BaseModel):
    name: str
    email: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    name: str


class GoogleAuthIn(BaseModel):
    id_token: str


# -----------------------------------------------------------------------------
# STARTUP + HEALTH
# -----------------------------------------------------------------------------
@app.on_event("startup")
def _startup():
    init_db()
    try_load_yolo_model()


@app.get("/health")
def health():
    return {"ok": True, "time": datetime.utcnow().isoformat()}


# -----------------------------------------------------------------------------
# AUTH: register, login
# -----------------------------------------------------------------------------
@app.post("/auth/register")
def register(payload: RegisterIn, db: Session = Depends(get_db)):
    name = payload.name.strip()
    email = payload.email.lower().strip()
    if not name or not email or not payload.password:
        raise HTTPException(status_code=400, detail="Name, email, password required")
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    db.add(User(name=name, email=email, password_hash=sha256(payload.password)))
    db.commit()
    return {"message": "Account created"}


@app.post("/auth/login", response_model=TokenOut)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    # Frontend sends username=email, password=...
    email = (form.username or "").lower().strip()
    user = db.query(User).filter(User.email == email).first()
    if not user or user.password_hash != sha256(form.password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token({"sub": user.email})
    return TokenOut(access_token=token, name=user.name)


# -----------------------------------------------------------------------------
# Google Sign-In (frontend obtains Google id_token and POSTs it here)
# -----------------------------------------------------------------------------
# NOTE: original code referenced id_token and google_requests which may need
# `google-auth` library; keep unchanged here (the original function will error
# if those libs aren't installed). If you use Google Sign-In, ensure imports:
#   from google.oauth2 import id_token
#   from google.auth.transport import requests as google_requests
#
try:
    from google.oauth2 import id_token as _id_token  # type: ignore
    from google.auth.transport import requests as _google_requests  # type: ignore
    _google_libs_available = True
except Exception:
    _google_libs_available = False

@app.post("/auth/google", response_model=TokenOut)
def auth_google(payload: GoogleAuthIn, db: Session = Depends(get_db)):
    if not _google_libs_available:
        raise HTTPException(status_code=500, detail="Google auth libs not installed on server")
    try:
        aud = GOOGLE_CLIENT_ID if GOOGLE_CLIENT_ID else None
        idinfo = _id_token.verify_oauth2_token(payload.id_token, _google_requests.Request(), audience=aud)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid Google ID token")

    email = idinfo.get("email")
    if not email:
        raise HTTPException(status_code=400, detail="Google token did not contain an email")

    name = idinfo.get("name") or email.split("@")[0]

    # Create user if doesn't exist
    user = db.query(User).filter(User.email == email).first()
    if not user:
        # create a local user with a random password hash (Google users authenticate via Google)
        db.add(User(name=name, email=email, password_hash=sha256(uuid.uuid4().hex)))
        db.commit()
        user = db.query(User).filter(User.email == email).first()

    token = create_access_token({"sub": user.email})
    return TokenOut(access_token=token, name=user.name)


# -----------------------------------------------------------------------------
# PREDICTION HELPERS (simple, deterministic demo if models are missing)
# -----------------------------------------------------------------------------
def demo_predictions(payload: Dict[str, Any]) -> Dict[str, Any]:
    age = float(payload.get("age_months") or 24)
    orig_price = float(payload.get("original_price") or 20000)
    battery = float(payload.get("battery_health") or 80)
    defects = float(payload.get("defect_count") or 0)
    s_issues = float(payload.get("screen_issues") or 0)
    b_issues = float(payload.get("body_issues") or 0)

    wear = 0.03 * age + 0.5 * s_issues + 0.3 * b_issues + 0.7 * defects + max(0, (90 - battery) * 0.02)
    price = int(max(500, round(orig_price * (1 - min(0.85, wear / 10.0)), -1)))
    rul = max(1, int(48 - age - defects * 4 - s_issues * 6 - b_issues * 4))
    decision = "repair" if (rul >= 10 and price >= orig_price * 0.25) else ("resell" if price >= orig_price * 0.15 else "recycle")
    co2_saved = round((price / max(1, orig_price)) * 40.0, 2)

    cond = "Good" if defects == 0 and s_issues == 0 and b_issues == 0 else ("Fair" if defects <= 1 and (s_issues + b_issues) <= 1 else "Poor")
    conf = 0.85 if cond == "Good" else (0.7 if cond == "Fair" else 0.6)

    return {
        "image_condition": {"label": cond, "confidence": conf},
        "predictions": {
            "price_suggest": price,
            "rul_months": rul,
            "decision": decision,
            "co2_saved_kg": co2_saved,
        },
    }


def nearby_partners(lat: Optional[float], lon: Optional[float]) -> List[Dict[str, Any]]:
    if lat is None or lon is None:
        lat, lon = 12.9716, 77.5946  # Bengaluru default
    return [
        {"name": "GreenTech Recyclers", "lat": lat + 0.01, "lon": lon + 0.01},
        {"name": "FixIt Repair Hub", "lat": lat - 0.008, "lon": lon + 0.006},
        {"name": "EcoCycle Center", "lat": lat + 0.004, "lon": lat - 0.012},
    ]


# -------------------------
# Helper coercion functions
# -------------------------
def safe_float(s: Optional[str], default: Optional[float] = None) -> Optional[float]:
    if s is None:
        return default
    if isinstance(s, (int, float)):
        return float(s)
    try:
        s2 = str(s).strip()
        if s2 == "":
            return default
        return float(s2)
    except Exception:
        return default


def safe_int(s: Optional[str], default: Optional[int] = None) -> Optional[int]:
    if s is None:
        return default
    if isinstance(s, int):
        return s
    try:
        s2 = str(s).strip()
        if s2 == "":
            return default
        return int(float(s2))
    except Exception:
        return default


# -----------------------------------------------------------------------------
# LISTINGS: create (multipart, authenticated) + list mine + delete + dedupe
# NOTE: Many form inputs are accepted as strings to avoid FastAPI 422 when the
# frontend sends empty strings. We coerce them safely below.
# -----------------------------------------------------------------------------
@app.post("/listings/create")
def create_listing(
    # changed to optional strings/defaults to avoid 422 on empty strings from frontend
    category: Optional[str] = Form("mobile"),
    brand: Optional[str] = Form(""),
    model: Optional[str] = Form(""),
    age_months: Optional[str] = Form(None),
    original_price: Optional[str] = Form(None),
    defect_count: Optional[str] = Form("0"),
    battery_health: Optional[str] = Form(None),
    storage_gb: Optional[str] = Form(None),
    ram_gb: Optional[str] = Form(None),
    screen_issues: Optional[str] = Form("0"),
    body_issues: Optional[str] = Form("0"),
    accessories: Optional[str] = Form(""),
    city: Optional[str] = Form(""),
    lat: Optional[str] = Form(None),
    lon: Optional[str] = Form(None),
    image: UploadFile = File(...),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    # Read bytes first for hashing; then save the file
    raw_bytes = image.file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Empty image")
    image_md5 = hashlib.md5(raw_bytes).hexdigest()
    image.file.seek(0)

    # save image to disk
    ext = os.path.splitext(image.filename or "")[1].lower()
    if ext not in [".jpg", ".jpeg", ".png", ".webp", ".bmp"]:
        ext = ".jpg"
    fname = f"{uuid.uuid4().hex}{ext}"
    save_path = os.path.join(UPLOAD_DIR, fname)
    with open(save_path, "wb") as f:
        f.write(raw_bytes)

    # coerce form values safely
    c_age = safe_float(age_months, None)
    c_orig_price = safe_float(original_price, None)
    c_defect_count = safe_int(defect_count, 0)
    c_battery = safe_float(battery_health, None)
    c_storage = safe_int(storage_gb, None)
    c_ram = safe_int(ram_gb, None)
    c_screen = safe_int(screen_issues, 0)
    c_body = safe_int(body_issues, 0)
    c_lat = safe_float(lat, None)
    c_lon = safe_float(lon, None)

    payload = {
        "category": (category or "mobile"),
        "brand": (brand or ""),
        "model": (model or ""),
        "age_months": c_age,
        "original_price": c_orig_price,
        "defect_count": c_defect_count,
        "battery_health": c_battery,
        "storage_gb": c_storage,
        "ram_gb": c_ram,
        "screen_issues": c_screen,
        "body_issues": c_body,
        "accessories": (accessories or ""),
        "city": (city or ""),
        "lat": c_lat,
        "lon": c_lon,
    }

    # De-duplication key (user + brand/model + image content)
    dedupe_key = hashlib.sha256(
        f"{user.id}|{(brand or '').strip().lower()}|{(model or '').strip().lower()}|{image_md5}".encode()
    ).hexdigest()

    # Check duplicate for the same user
    existing = db.query(Listing).filter(
        Listing.user_id == user.id,
        Listing.dedupe_key == dedupe_key
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Duplicate listing detected")

    # -------------------------
    # Run detection model (if available) else demo predictions
    # -------------------------
    result = None
    detections: List[Dict[str, Any]] = []
    model_used = None
    inference_ms = None

    if ULTRALYTICS_AVAILABLE and YOLO_MODEL is not None:
        try:
            t0 = time.time()
            # run inference - conf threshold tunable
            yres = YOLO_MODEL.predict(source=save_path, imgsz=640, conf=0.25, iou=0.45, verbose=False)
            inference_ms = int((time.time() - t0) * 1000)

            if len(yres) > 0:
                r0 = yres[0]
                boxes = getattr(r0, "boxes", None)
                # get natural image size if available in result, else open with PIL
                try:
                    nat_h, nat_w = r0.orig_shape  # sometimes (h,w,c)
                except Exception:
                    try:
                        with Image.open(save_path) as im:
                            nat_w, nat_h = im.width, im.height
                    except Exception:
                        nat_w, nat_h = None, None

                names = getattr(r0, "names", None)
                if names is None:
                    # try model-level names
                    try:
                        names = YOLO_MODEL.model.names
                    except Exception:
                        names = {}

                if boxes is not None:
                    for b in boxes:
                        # xyxy might be tensor; try to convert robustly
                        try:
                            xyxy = b.xyxy.tolist()[0] if hasattr(b.xyxy, "tolist") else list(map(float, b.xyxy))
                        except Exception:
                            # fallback: convert each element
                            try:
                                xy = [float(x) for x in b.xyxy]
                                xyxy = xy
                            except Exception:
                                continue
                        try:
                            conf = float(b.conf.tolist()[0]) if hasattr(b.conf, "tolist") else float(b.conf)
                        except Exception:
                            conf = float(getattr(b, "conf", 0.0))
                        try:
                            cls_id = int(b.cls.tolist()[0]) if hasattr(b.cls, "tolist") else int(b.cls)
                        except Exception:
                            cls_id = int(getattr(b, "cls", 0))
                        raw_label = names.get(cls_id, str(cls_id))
                        x1, y1, x2, y2 = xyxy
                        # if nat size available, normalize; else attempt fallback to image size
                        if nat_w and nat_h:
                            nx1, ny1, nx2, ny2 = x1 / nat_w, y1 / nat_h, x2 / nat_w, y2 / nat_h
                        else:
                            # try get image size via PIL
                            try:
                                with Image.open(save_path) as im:
                                    nw, nh = im.width, im.height
                                nx1, ny1, nx2, ny2 = x1 / nw, y1 / nh, x2 / nw, y2 / nh
                            except Exception:
                                # leave absolute coords (frontend checks for normalized)
                                nx1, ny1, nx2, ny2 = x1, y1, x2, y2
                        detections.append({
                            "label": raw_label,
                            "confidence": conf,
                            "bbox": [nx1, ny1, nx2, ny2]
                        })
            model_used = YOLO_MODEL_NAME
        except Exception as e:
            print(f"[inference] model failed: {e}")
            detections = []
            model_used = None

    # Build result: if model produced detections use that, else demo
    if detections:
        top = sorted(detections, key=lambda x: x.get("confidence", 0), reverse=True)[0]

        def friendly_map(raw):
            m = {
                "glass_crack": "Screen crack",
                "scratch": "Scratch",
                "bent": "Bent frame",
                "body_damage": "Body damage",
                "pixel_defect": "Display defect",
            }
            return m.get(raw, raw)

        result = {
            "method": "yolov8" if model_used else "demo",
            "model_name": model_used,
            "inference_ms": inference_ms,
            "detections": detections,
            "image_condition": {"label": friendly_map(top.get("label")), "confidence": top.get("confidence", 0)},
            "predictions": {}
        }
        pseudo_payload = payload.copy()
        pseudo_payload["detected_defects_count"] = len(detections)
        demo_res = demo_predictions(pseudo_payload)
        result["predictions"] = demo_res.get("predictions", {})
    else:
        result = demo_predictions(payload)
        result["method"] = "demo"
        result["model_name"] = None
        result["inference_ms"] = None
        result["detections"] = []

    # nearby partners
    result["nearby_partners"] = nearby_partners(payload.get("lat"), payload.get("lon"))

    # Store in DB
    row = Listing(
        user_id=user.id,
        payload=json.dumps(payload),
        image_path=save_path,
        result_json=json.dumps(result),
        image_md5=image_md5,
        dedupe_key=dedupe_key,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    result["listing_id"] = row.id
    result["image"] = {"path": fname}
    return result


@app.get("/listings/mine")
def my_listings(user: User = Depends(require_user), db: Session = Depends(get_db)):
    rows = (
        db.query(Listing)
        .filter(Listing.user_id == user.id)
        .order_by(Listing.created_at.desc())
        .limit(200)
        .all()
    )
    items: List[Dict[str, Any]] = []
    for r in rows:
        try:
            p = json.loads(r.payload)
        except Exception:
            p = {}
        try:
            res = json.loads(r.result_json) if r.result_json else {}
        except Exception:
            res = {}

        items.append(
            {
                "id": r.id,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "brand": p.get("brand"),
                "model": p.get("model"),
                "category": p.get("category"),
                "city": p.get("city"),
                "image": os.path.basename(r.image_path),
                "predictions": res.get("predictions"),
                "image_condition": res.get("image_condition"),
            }
        )
    return {"items": items}


@app.delete("/listings/{listing_id}")
def delete_listing(
    listing_id: int,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    row = db.query(Listing).filter(Listing.id == listing_id, Listing.user_id == user.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Listing not found")
    # try to remove file
    try:
        if row.image_path and os.path.exists(row.image_path):
            os.remove(row.image_path)
    except Exception:
        pass
    db.delete(row)
    db.commit()
    return {"ok": True}
