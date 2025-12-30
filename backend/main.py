# backend/main.py
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
import hashlib
import json
import os
import pickle
import uuid
import math
import time
import joblib
import pandas as pd
from PIL import Image
import smtplib
import ssl
from email.message import EmailMessage

try:
    from ultralytics import YOLO
    ULTRALYTICS_AVAILABLE = True
except Exception:
    ULTRALYTICS_AVAILABLE = False

from fastapi import (
    FastAPI,
    Depends,
    HTTPException,
    UploadFile,
    File,
    Form,
    Header,
    Query,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from jose import jwt
from pydantic import BaseModel
from sqlalchemy import (
    create_engine,
    Column,
    Integer,
    String,
    DateTime,
    Text,
    Float,
)
from sqlalchemy.orm import sessionmaker, declarative_base, Session

# -----------------------------------------------------------------------------#
# CONFIG
# -----------------------------------------------------------------------------#
BASE_DIR = os.path.dirname(__file__)
SECRET_KEY = "change-this-in-production"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 12

DB_URL = "sqlite:///" + os.path.join(BASE_DIR, "ewaste.db")
MODELS_DIR = os.path.join(BASE_DIR, "models")
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# -----------------------------------------------------------------------------#
# LOAD TRAINED ML MODELS (PRICE + DECISION)
# -----------------------------------------------------------------------------#
ML_PREPROCESSOR = None
ML_PRICE_MODEL = None
ML_DECISION_MODEL = None

try:
    ML_PREPROCESSOR = joblib.load(os.path.join(MODELS_DIR, "preprocessor.joblib"))
    ML_PRICE_MODEL = joblib.load(os.path.join(MODELS_DIR, "regression_rf_model.joblib"))
    ML_DECISION_MODEL = joblib.load(os.path.join(MODELS_DIR, "classification_rf_model.joblib"))
    print("[startup] Trained ML models loaded successfully")
    try:
        print("[startup] ML_PREPROCESSOR type:", type(ML_PREPROCESSOR))
        if ML_PREPROCESSOR is not None and hasattr(ML_PREPROCESSOR, "transformers_"):
            print("[startup] preprocessor transformers:", [t[0] for t in ML_PREPROCESSOR.transformers_])
            try:
                # print number of expected columns if feature_names_in_ exists
                if hasattr(ML_PREPROCESSOR, "feature_names_in_"):
                    print("[startup] preprocessor.feature_names_in_ len:", len(ML_PREPROCESSOR.feature_names_in_))
            except Exception:
                pass
    except Exception:
        pass
    try:
        print("[startup] ML_PRICE_MODEL type:", type(ML_PRICE_MODEL))
        if hasattr(ML_PRICE_MODEL, "named_steps"):
            print("[startup] price model pipeline steps:", list(ML_PRICE_MODEL.named_steps.keys()))
        if hasattr(ML_PRICE_MODEL, "n_features_in_"):
            print("[startup] price model n_features_in_:", ML_PRICE_MODEL.n_features_in_)
    except Exception:
        pass
    try:
        print("[startup] ML_DECISION_MODEL type:", type(ML_DECISION_MODEL))
        if hasattr(ML_DECISION_MODEL, "named_steps"):
            print("[startup] decision model pipeline steps:", list(ML_DECISION_MODEL.named_steps.keys()))
        if hasattr(ML_DECISION_MODEL, "n_features_in_"):
            print("[startup] decision model n_features_in_:", ML_DECISION_MODEL.n_features_in_)
    except Exception:
        pass
except Exception as e:
    print("[startup] ML models not loaded, using rule-based fallback:", e)


# -----------------------------------------------------------------------------#
# APP + CORS
# -----------------------------------------------------------------------------#
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

# -----------------------------------------------------------------------------#
# DATABASE
# -----------------------------------------------------------------------------#
engine = create_engine(DB_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
Base = declarative_base()


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    email = Column(String(200), unique=True, index=True, nullable=False)
    password_hash = Column(String(128), nullable=False)
    role = Column(String(20), nullable=False, default="customer")  # customer / partner / admin
    created_at = Column(DateTime, default=datetime.utcnow)


class Listing(Base):
    __tablename__ = "listings"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True, nullable=False)
    payload = Column(Text, nullable=False)          # JSON of submitted fields
    image_path = Column(String(300), nullable=False)
    # prediction blob, image md5, and dedupe key
    result_json = Column(Text, nullable=True)
    image_md5 = Column(String(32), index=True, nullable=True)
    dedupe_key = Column(String(64), index=True, nullable=True)
    # lifecycle
    status = Column(String(30), nullable=False, default="created")   # created/shared_with_partner/in_progress/completed/cancelled
    intent = Column(String(20), nullable=False, default="sell")      # sell/repair/recycle
    chosen_partner_id = Column(Integer, index=True, nullable=True)
    final_price = Column(Integer, nullable=True)
    final_rul_months = Column(Integer, nullable=True)
    outcome = Column(String(30), nullable=True)                      # repaired/sold/recycled/...
    created_at = Column(DateTime, default=datetime.utcnow)


class Partner(Base):
    __tablename__ = "partners"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True, nullable=False)  # maps to users.id
    org_name = Column(String(200), nullable=False)
    partner_type = Column(String(50), nullable=False)      # "repair" or "recycler"
    city = Column(String(100), nullable=True)
    address = Column(Text, nullable=True)
    lat = Column(Float, nullable=True)
    lon = Column(Float, nullable=True)
    service_radius_km = Column(Float, nullable=True, default=10.0)
    contact_phone = Column(String(50), nullable=True)
    kyc_status = Column(String(20), nullable=False, default="not_submitted")
    created_at = Column(DateTime, default=datetime.utcnow)


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True, nullable=False)
    token = Column(String(128), unique=True, index=True, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


def init_db():
    Base.metadata.create_all(bind=engine)
    # best-effort migration for older DBs (SQLite)
    with engine.connect() as con:
        for alter_sql in [
            # listing migrations
            "ALTER TABLE listings ADD COLUMN result_json TEXT",
            "ALTER TABLE listings ADD COLUMN image_md5 VARCHAR(32)",
            "ALTER TABLE listings ADD COLUMN dedupe_key VARCHAR(64)",
            "ALTER TABLE listings ADD COLUMN status VARCHAR(30) DEFAULT 'created'",
            "ALTER TABLE listings ADD COLUMN intent VARCHAR(20) DEFAULT 'sell'",
            "ALTER TABLE listings ADD COLUMN chosen_partner_id INTEGER",
            "ALTER TABLE listings ADD COLUMN final_price INTEGER",
            "ALTER TABLE listings ADD COLUMN final_rul_months INTEGER",
            "ALTER TABLE listings ADD COLUMN outcome VARCHAR(30)",
            # partners migrations
            "ALTER TABLE partners ADD COLUMN org_name VARCHAR(200)",
            "ALTER TABLE partners ADD COLUMN partner_type VARCHAR(50)",
            "ALTER TABLE partners ADD COLUMN city VARCHAR(100)",
            "ALTER TABLE partners ADD COLUMN address TEXT",
            "ALTER TABLE partners ADD COLUMN lat FLOAT",
            "ALTER TABLE partners ADD COLUMN lon FLOAT",
            "ALTER TABLE partners ADD COLUMN service_radius_km FLOAT",
            "ALTER TABLE partners ADD COLUMN contact_phone VARCHAR(50)",
            "ALTER TABLE partners ADD COLUMN kyc_status VARCHAR(20) DEFAULT 'not_submitted'",
            # users: role
            "ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'customer'",
        ]:
            try:
                con.exec_driver_sql(alter_sql)
            except Exception:
                # column/table may already exist — ignore
                pass

    # Seed an admin user when environment vars are provided (simple demo flow)
    try:
        admin_email = os.environ.get("ADMIN_EMAIL")
        admin_password = os.environ.get("ADMIN_PASSWORD")
        if admin_email and admin_password:
            db = SessionLocal()
            admin_email_l = admin_email.strip().lower()
            existing = db.query(User).filter(User.email == admin_email_l).first()
            if not existing:
                user = User(
                    name="admin",
                    email=admin_email_l,
                    password_hash=sha256(admin_password),
                    role="admin",
                )
                db.add(user)
                db.commit()
                print(f"[startup] Admin user created: {admin_email_l}")
            else:
                # ensure role set to admin
                if getattr(existing, "role", None) != "admin":
                    existing.role = "admin"
                    db.add(existing)
                    db.commit()
                    print(f"[startup] Existing user promoted to admin: {admin_email_l}")
            db.close()
    except Exception:
        pass


# -----------------------------------------------------------------------------#
# HELPERS: DB session, hashing, JWT
# -----------------------------------------------------------------------------#
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


def require_admin(user: User = Depends(require_user)) -> User:
    # Require that the authenticated user has role 'admin'
    if getattr(user, "role", "customer") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def send_email(to_email: str, subject: str, body_text: str, body_html: Optional[str] = None) -> (bool, Optional[str]):
    """Send an email using SMTP settings from environment.
    Returns (success, error_message).
    Environment variables: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, SMTP_USE_TLS
    """
    host = os.environ.get("SMTP_HOST")
    if not host:
        return False, "SMTP not configured"

    try:
        port = int(os.environ.get("SMTP_PORT", "587"))
    except Exception:
        port = 587

    user = os.environ.get("SMTP_USER")
    password = os.environ.get("SMTP_PASSWORD")
    from_addr = os.environ.get("SMTP_FROM") or user or "no-reply@example.com"
    use_tls = os.environ.get("SMTP_USE_TLS", "true").lower() in ("1", "true", "yes")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to_email
    if body_html:
        msg.set_content(body_text)
        msg.add_alternative(body_html, subtype="html")
    else:
        msg.set_content(body_text)

    try:
        if use_tls:
            server = smtplib.SMTP(host, port, timeout=10)
            server.starttls()
            if user and password:
                server.login(user, password)
            server.send_message(msg)
            server.quit()
        else:
            server = smtplib.SMTP_SSL(host, port, timeout=10)
            if user and password:
                server.login(user, password)
            server.send_message(msg)
            server.quit()
        return True, None
    except Exception as e:
        return False, str(e)

# -----------------------------------------------------------------------------#
# ML PREDICTION USING TRAINED MODELS
# -----------------------------------------------------------------------------#
def ml_predict(payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Uses trained RandomForest models.
    IMPORTANT: Input columns MUST match training dataset.
    """
    if ML_PREPROCESSOR is None or ML_PRICE_MODEL is None or ML_DECISION_MODEL is None:
        return None

    try:
        # Build input row that matches the preprocessor / training columns.
        # Inspect ML_PREPROCESSOR or model pipeline to find expected input names.
        expected_cols = None
        pre = None
        try:
            if ML_PREPROCESSOR is not None:
                pre = ML_PREPROCESSOR
            elif hasattr(ML_PRICE_MODEL, "named_steps"):
                # common pipeline name is 'pre' or 'preprocessor'
                pre = ML_PRICE_MODEL.named_steps.get("pre") or ML_PRICE_MODEL.named_steps.get("preprocessor")

            # Attempt to extract expected columns from ColumnTransformer
            if pre is not None and hasattr(pre, "transformers_"):
                cols = []
                for name, transformer, colspec in pre.transformers_:
                    # colspec may be list of names or an array/slice; handle lists
                    try:
                        if isinstance(colspec, (list, tuple)):
                            cols.extend(list(colspec))
                        else:
                            # fallback: try to iterate
                            cols.extend(list(colspec))
                    except Exception:
                        pass
                expected_cols = list(dict.fromkeys(cols))
            # Some preprocessors store feature_names_in_
            if expected_cols is None and pre is not None and hasattr(pre, "feature_names_in_"):
                expected_cols = list(getattr(pre, "feature_names_in_"))
        except Exception:
            expected_cols = None

        # Default set that covers older/newer training scripts
        default_cols = [
            "device_brand",
            "brand",
            "model",
            "category",
            "city",
            "ram",
            "ram_gb",
            "internal_memory",
            "storage_gb",
            "battery",
            "battery_health",
            "screen_size",
            "rear_camera_mp",
            "front_camera_mp",
            "os",
            "4g",
            "5g",
            "weight",
            "release_year",
            "days_used",
            "age_months",
            "age_years",
            "original_price",
            "normalized_new_price",
            "issue_score",
            "defect_count",
            "screen_issues",
            "body_issues",
            "has_accessories",
        ]

        cols_to_use = expected_cols or default_cols

        # compute common derived values
        age_months = float(payload.get("age_months") or 24)
        age_years = age_months / 12.0
        original_price = float(payload.get("original_price") or 20000)
        defect_count = int(payload.get("defect_count") or 0)
        screen_issues = int(payload.get("screen_issues") or 0)
        body_issues = int(payload.get("body_issues") or 0)
        issue_score = defect_count + screen_issues + body_issues
        has_accessories = 1 if (payload.get("accessories") or "") != "" else 0
        days_used = int(age_months * 30)

        # helper to get value from payload with fallback names
        def get_field(name):
            # direct mapping
            if name in payload:
                return payload.get(name)
            # some names map to others
            mapping = {
                "device_brand": payload.get("brand"),
                "brand": payload.get("brand"),
                "ram": payload.get("ram_gb"),
                "ram_gb": payload.get("ram_gb"),
                "internal_memory": payload.get("storage_gb"),
                "storage_gb": payload.get("storage_gb"),
                "battery": payload.get("battery_health"),
                "battery_health": payload.get("battery_health"),
                "original_price": payload.get("original_price"),
                "normalized_new_price": payload.get("normalized_new_price") or (payload.get("original_price")),
                "age_months": payload.get("age_months"),
                "age_years": age_years,
                "days_used": days_used,
                "issue_score": issue_score,
                "defect_count": defect_count,
                "screen_issues": screen_issues,
                "body_issues": body_issues,
                "has_accessories": has_accessories,
                "4g": payload.get("4g", 1),
                "5g": payload.get("5g", 0),
                "os": payload.get("os", "Android"),
                "screen_size": payload.get("screen_size", 6.1),
                "rear_camera_mp": payload.get("rear_camera_mp", 12),
                "front_camera_mp": payload.get("front_camera_mp", 8),
                "weight": payload.get("weight", 180),
                "release_year": payload.get("release_year", 2020),
                "category": payload.get("category", "mobile"),
                "model": payload.get("model", ""),
                "city": payload.get("city", ""),
            }
            return mapping.get(name)

        input_row = {}

        # --- Normalization heuristics before building the input row ---
        # ensure original / normalized price mapping
        try:
            if payload.get("normalized_new_price") is None and payload.get("original_price") is not None:
                # Training used a log-scale normalized new price. Convert to ln(original_price/100).
                try:
                    op = float(payload.get("original_price"))
                    payload["normalized_new_price"] = math.log(max(op, 1.0) / 100.0)
                except Exception:
                    payload["normalized_new_price"] = payload.get("original_price")
        except Exception:
            pass

        # infer OS from brand when clearly mismatched (e.g., Apple -> iOS)
        try:
            brand_raw = payload.get("brand") or payload.get("device_brand") or ""
            brand_s = str(brand_raw).strip()
            os_raw = payload.get("os")
            if brand_s and (os_raw is None or (brand_s.lower().find("apple") != -1 and str(os_raw).lower() != "ios")):
                # if brand looks like Apple, prefer iOS
                if "apple" in brand_s.lower():
                    payload["os"] = "iOS"
                elif "samsung" in brand_s.lower() or "oneplus" in brand_s.lower() or "xiaomi" in brand_s.lower():
                    payload["os"] = "Android"
        except Exception:
            pass

        # normalize days_used <-> age_months: if only days_used is provided (and large), derive months
        try:
            days_val = payload.get("days_used")
            age_months_val = payload.get("age_months")
            if days_val is not None:
                try:
                    days_int = int(float(days_val))
                except Exception:
                    days_int = None
            else:
                days_int = None

            if (age_months_val is None or age_months_val == "") and days_int is not None:
                payload["age_months"] = max(1, int(days_int / 30))
            # if both provided but days looks like it's in days and unreasonably large (>1000), recompute months
            if age_months_val is not None and days_int is not None and days_int > 1000:
                payload["age_months"] = max(1, int(days_int / 30))
        except Exception:
            pass

        # Heuristics: treat these as numeric and provide safe defaults when missing
        numeric_defaults = {
            "screen_size": 6.1,
            "rear_camera_mp": 12,
            "front_camera_mp": 8,
            "internal_memory": 64,
            "ram": 4,
            "ram_gb": 4,
            "battery": 80.0,
            "battery_health": 80.0,
            "weight": 180,
            "release_year": 2020,
            "days_used": int(age_months * 30),
            "age_months": age_months,
            "age_years": age_years,
            "original_price": original_price,
            "normalized_new_price": math.log(max(original_price, 1.0) / 100.0),
            "defect_count": 0,
            "screen_issues": 0,
            "body_issues": 0,
            "issue_score": issue_score,
        }

        for c in cols_to_use:
            raw = get_field(c)
            # fill sensible defaults for numerics
            if raw is None:
                if c in numeric_defaults:
                    input_row[c] = numeric_defaults[c]
                elif c in ("4g", "5g"):
                    # default connectivity flags
                    input_row[c] = 0 if c == "5g" else 1
                else:
                    # fall back to empty string for categoricals
                    input_row[c] = "" if isinstance(c, str) else None
            else:
                # coerce likely numeric fields
                if c in numeric_defaults:
                    try:
                        # prefer integer when it makes sense
                        if float(raw).is_integer():
                            input_row[c] = int(float(raw))
                        else:
                            input_row[c] = float(raw)
                    except Exception:
                        input_row[c] = numeric_defaults.get(c)
                elif c in ("4g", "5g"):
                    try:
                        input_row[c] = int(bool(raw))
                    except Exception:
                        input_row[c] = 0
                else:
                    input_row[c] = raw

        input_df = pd.DataFrame([input_row])

        # Temporary debug logging to help diagnose model input/output issues
        try:
            debug_ml = os.environ.get("DEBUG_ML", "1")
        except Exception:
            debug_ml = "1"
        if debug_ml and str(debug_ml) != "0":
            try:
                print("[ML DEBUG] expected_cols:", cols_to_use)
                print("[ML DEBUG] input_df.columns:", list(input_df.columns))
                print("[ML DEBUG] sample input:", input_df.iloc[0].to_dict())
                print("[ML DEBUG] ML_PRICE_MODEL type:", type(ML_PRICE_MODEL))
                print("[ML DEBUG] ML_DECISION_MODEL type:", type(ML_DECISION_MODEL))
                print("[ML DEBUG] ML_PREPROCESSOR type:", type(ML_PREPROCESSOR))
            except Exception:
                pass

        # Try to use saved model pipelines directly (they may include preprocessing).
        try:
            # Get raw regression prediction (pipeline may accept DataFrame directly)
            if hasattr(ML_PRICE_MODEL, "predict"):
                try:
                    raw_price_pred = ML_PRICE_MODEL.predict(input_df)[0]
                except Exception:
                    X = ML_PREPROCESSOR.transform(input_df)
                    raw_price_pred = ML_PRICE_MODEL.predict(X)[0]
            else:
                X = ML_PREPROCESSOR.transform(input_df)
                raw_price_pred = ML_PRICE_MODEL.predict(X)[0]

            # Convert model target (normalized/log) back to rupees.
            try:
                price = int(round(math.exp(float(raw_price_pred)) * 100))
            except Exception:
                try:
                    price = int(float(raw_price_pred))
                except Exception:
                    price = 0

            # Decision/classifier
            if hasattr(ML_DECISION_MODEL, "predict"):
                try:
                    raw_decision_pred = ML_DECISION_MODEL.predict(input_df)[0]
                except Exception:
                    if "X" not in locals():
                        X = ML_PREPROCESSOR.transform(input_df)
                    raw_decision_pred = ML_DECISION_MODEL.predict(X)[0]
                decision_cls = int(raw_decision_pred)
            else:
                if "X" not in locals():
                    X = ML_PREPROCESSOR.transform(input_df)
                decision_cls = int(ML_DECISION_MODEL.predict(X)[0])

            decision = "sell" if decision_cls == 1 else "recycle"
            co2_saved = round((price / max(1, original_price)) * 40, 2)

            # Additional debug: print raw predictions and top feature importances (if available)
            try:
                print("[ML DEBUG] raw_price_pred:", float(raw_price_pred))
            except Exception:
                pass
            try:
                print("[ML DEBUG] raw_decision_pred:", int(raw_decision_pred))
            except Exception:
                pass
            try:
                # attempt to get underlying estimator (named 'rf' by training script)
                if hasattr(ML_PRICE_MODEL, "named_steps") and "rf" in ML_PRICE_MODEL.named_steps:
                    rf = ML_PRICE_MODEL.named_steps["rf"]
                    feat_names = None
                    try:
                        if hasattr(ML_PREPROCESSOR, "get_feature_names_out"):
                            feat_names = list(ML_PREPROCESSOR.get_feature_names_out())
                        elif hasattr(ML_PRICE_MODEL.named_steps.get("pre"), "get_feature_names_out"):
                            feat_names = list(ML_PRICE_MODEL.named_steps.get("pre").get_feature_names_out())
                    except Exception:
                        feat_names = None

                    if hasattr(rf, "feature_importances_") and feat_names is not None:
                        fi = getattr(rf, "feature_importances_")
                        idx = fi.argsort()[::-1][:10]
                        print("[ML DEBUG] top features:")
                        for i in idx:
                            nm = feat_names[i] if i < len(feat_names) else str(i)
                            print(f"  {nm}: {fi[i]:.4f}")
            except Exception:
                pass

            return {
                "price_suggest": price,
                "decision": decision,
                "co2_saved_kg": co2_saved,
            }
        except Exception as e:
            print("[ML prediction failed]", e)
            return None

    except Exception as e:
        print("[ML prediction failed]", e)
        return None


# -----------------------------------------------------------------------------#
# OPTIONAL: load pickled models if available
# -----------------------------------------------------------------------------#
def load_pickle(path: str):
    try:
        with open(path, "rb") as f:
            return pickle.load(f)
    except Exception:
        return None


PRICE_MODEL = load_pickle(os.path.join(MODELS_DIR, "price_model.pkl"))
RUL_MODEL = load_pickle(os.path.join(MODELS_DIR, "rul_model.pkl"))
DECISION_MODEL = load_pickle(os.path.join(MODELS_DIR, "decision_model.pkl"))

# -----------------------------------------------------------------------------#
# Load YOLO detection model (optional, safe)
# -----------------------------------------------------------------------------#
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


# -----------------------------------------------------------------------------#
# SCHEMAS
# -----------------------------------------------------------------------------#
class RegisterIn(BaseModel):
    name: str
    email: str
    password: str
    is_partner: Optional[bool] = False  # if True, register as partner


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    name: str
    role: Optional[str] = "customer"


class PartnerRegisterIn(BaseModel):
    org_name: str
    partner_type: str  # "repair" or "recycler"
    city: Optional[str] = None
    address: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    service_radius_km: Optional[float] = 10.0
    contact_phone: Optional[str] = None


class CompleteLeadIn(BaseModel):
    outcome: str  # repaired / sold / recycled
    final_price: Optional[int] = None
    final_rul_months: Optional[int] = None


# -----------------------------------------------------------------------------#
# STARTUP + HEALTH
# -----------------------------------------------------------------------------#
@app.on_event("startup")
def _startup():
    init_db()
    try_load_yolo_model()

    # Best-effort: import partners from repository CSV so get_nearby_partners
    # can return results even if no partners were registered via the API.
    try:
        db = SessionLocal()
        imported = load_partners_from_csv(db)
        if imported:
            print(f"[startup] partners imported: {imported}")
        db.close()
    except Exception as e:
        print("[startup] failed to import partners from CSV:", e)


@app.get("/health")
def health():
    return {"ok": True, "time": datetime.utcnow().isoformat()}


@app.post("/auth/forgot-password")
def forgot_password(
    email: str = Form(...),
    db: Session = Depends(get_db),
):
    """Request a password reset. Generates a reset token (demo: returns token in response)."""
    email = email.lower().strip()
    user = db.query(User).filter(User.email == email).first()
    if not user:
        # Don't reveal if email exists (security best practice)
        return {"message": "If email exists, reset link has been sent"}
    
    # Generate reset token
    reset_token = str(uuid.uuid4())
    expires_at = datetime.utcnow() + timedelta(hours=1)
    
    # Delete any existing reset tokens for this user
    db.query(PasswordResetToken).filter(PasswordResetToken.user_id == user.id).delete()
    
    token_obj = PasswordResetToken(
        user_id=user.id,
        token=reset_token,
        expires_at=expires_at,
    )
    db.add(token_obj)
    db.commit()
    
    # Build reset link
    reset_link = f"http://localhost:3000/reset-password?token={reset_token}"

    # Try to send an email if SMTP is configured; otherwise fall back to demo behavior.
    smtp_host = os.environ.get("SMTP_HOST")
    if smtp_host:
        subject = "Password reset for Smart Circular"
        text = f"You requested a password reset. Use the link below to reset your password:\n\n{reset_link}\n\nIf you did not request this, ignore this email."
        html = f"<p>You requested a password reset. Click the link below to reset your password:</p><p><a href=\"{reset_link}\">Reset password</a></p>"
        ok, err = send_email(email, subject, text, html)
        if ok:
            return {"message": "If email exists, reset link has been sent"}
        else:
            print(f"[email] Failed to send reset email to {email}: {err}")
            # Fall through to demo fallback (return token) so dev can continue testing

    # Demo fallback: print and return token for local testing
    print(f"[demo] Password reset link for {email}: {reset_link}")
    return {"message": "If email exists, reset link has been sent", "reset_token": reset_token}


class ResetPasswordIn(BaseModel):
    token: str
    new_password: str


@app.post("/auth/reset-password")
def reset_password(payload: ResetPasswordIn, db: Session = Depends(get_db)):
    """Reset password using a reset token."""
    token_obj = db.query(PasswordResetToken).filter(PasswordResetToken.token == payload.token).first()
    if not token_obj:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")
    
    if token_obj.expires_at < datetime.utcnow():
        db.delete(token_obj)
        db.commit()
        raise HTTPException(status_code=400, detail="Reset token has expired")
    
    user = db.query(User).filter(User.id == token_obj.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Update password
    user.password_hash = sha256(payload.new_password)
    db.add(user)
    
    # Delete used token
    db.delete(token_obj)
    db.commit()
    
    return {"message": "Password reset successfully"}


@app.post("/auth/reset-password-direct")
def reset_password_direct(
    email: str = Form(...),
    new_password: str = Form(...),
    db: Session = Depends(get_db),
):
    """Insecure direct password reset by email (no token) — only enabled when ALLOW_INSECURE_RESET=true.
    This is intentionally unsafe and should only be used for local/dev/testing.
    """
    allow = os.environ.get("ALLOW_INSECURE_RESET", "false").lower()
    if allow != "true":
        raise HTTPException(status_code=403, detail="Insecure password reset is disabled on this server")

    email_l = email.lower().strip()
    user = db.query(User).filter(User.email == email_l).first()
    if not user:
        # Don't reveal existence
        return {"message": "If email exists, password has been reset"}

    user.password_hash = sha256(new_password)
    db.add(user)
    # remove any outstanding reset tokens
    db.query(PasswordResetToken).filter(PasswordResetToken.user_id == user.id).delete()
    db.commit()
    return {"message": "Password reset successfully"}


# -----------------------------------------------------------------------------#
# AUTH: register, login
# -----------------------------------------------------------------------------#
@app.post("/auth/register")
def register(payload: RegisterIn, db: Session = Depends(get_db)):
    name = payload.name.strip()
    email = payload.email.lower().strip()
    if not name or not email or not payload.password:
        raise HTTPException(status_code=400, detail="Name, email, password required")
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    role = "partner" if payload.is_partner else "customer"
    user = User(
        name=name,
        email=email,
        password_hash=sha256(payload.password),
        role=role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    
    # If registering as partner, create a partner record with defaults
    if payload.is_partner:
        partner = Partner(
            user_id=user.id,
            org_name=name,  # use user name as default org name
            partner_type="repair",  # default, user can update later
            kyc_status="submitted",
        )
        db.add(partner)
        db.commit()
    
    return {"message": "Account created", "role": role}


@app.post("/auth/login", response_model=TokenOut)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    # Frontend sends username=email, password=...
    email = (form.username or "").lower().strip()
    user = db.query(User).filter(User.email == email).first()
    if not user or user.password_hash != sha256(form.password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token({"sub": user.email})
    # Include role in response so frontend can redirect based on role
    return TokenOut(access_token=token, token_type="bearer", name=user.name, role=getattr(user, "role", "customer"))


# -----------------------------------------------------------------------------#
# HELPER: DEMO PREDICTIONS + COERCION
# (demo_predictions is now kept only as a helper; YOLO path doesn't use it)
# -----------------------------------------------------------------------------#
def demo_predictions(payload: Dict[str, Any]) -> Dict[str, Any]:
    age = float(payload.get("age_months") or 24)
    orig_price = float(payload.get("original_price") or 20000)
    battery = float(payload.get("battery_health") or 80)
    defects = float(payload.get("defect_count") or 0)
    s_issues = float(payload.get("screen_issues") or 0)
    b_issues = float(payload.get("body_issues") or 0)

    wear = 0.03 * age + 0.5 * s_issues + 0.3 * b_issues + 0.7 * defects + max(
        0, (90 - battery) * 0.02
    )
    price = int(max(500, round(orig_price * (1 - min(0.85, wear / 10.0)), -1)))
    rul = max(1, int(48 - age - defects * 4 - s_issues * 6 - b_issues * 4))
    decision = (
        "repair"
        if (rul >= 10 and price >= orig_price * 0.25)
        else ("resell" if price >= orig_price * 0.15 else "recycle")
    )
    co2_saved = round((price / max(1, orig_price)) * 40.0, 2)

    cond = (
        "Good"
        if defects == 0 and s_issues == 0 and b_issues == 0
        else ("Fair" if defects <= 1 and (s_issues + b_issues) <= 1 else "Poor")
    )
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


# -----------------------------------------------------------------------------#
# GEO + PARTNER HELPERS
# -----------------------------------------------------------------------------#
def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(
        dlambda / 2
    ) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def get_nearby_partners(
    db: Session,
    lat: Optional[float],
    lon: Optional[float],
    intent: Optional[str] = None,
    max_results: int = 10,
) -> List[Dict[str, Any]]:
    q = db.query(Partner)

    if intent in ("repair", "recycle"):
        ptype = "repair" if intent == "repair" else "recycler"
        q = q.filter(Partner.partner_type == ptype)

    partners = q.all()
    out: List[Dict[str, Any]] = []

    if lat is None or lon is None:
        for p in partners:
            out.append(
                {
                    "id": p.id,
                    "name": p.org_name,
                    "type": p.partner_type,
                    "city": p.city,
                    "lat": p.lat,
                    "lon": p.lon,
                    "distance_km": None,
                    "contact_phone": p.contact_phone,
                }
            )
        return out[:max_results]

    for p in partners:
        if p.lat is None or p.lon is None:
            dist = None
        else:
            dist = haversine_km(lat, lon, p.lat, p.lon)

        if dist is not None and p.service_radius_km is not None and dist > p.service_radius_km:
            continue

        out.append(
            {
                "id": p.id,
                "name": p.org_name,
                "type": p.partner_type,
                "city": p.city,
                "lat": p.lat,
                "lon": p.lon,
                "distance_km": dist,
                # Only expose contact_phone to callers if partner is verified
                "contact_phone": (p.contact_phone if getattr(p, "kyc_status", "not_submitted") == "verified" else None),
            }
        )

    out.sort(key=lambda x: (x["distance_km"] is None, x["distance_km"] or 0.0))
    return out[:max_results]


def load_partners_from_csv(db: Session, csv_path: Optional[str] = None, max_import: int = 1000) -> int:
    """
    Read partners from a CSV file and insert into the `partners` table if not already present.
    This is a best-effort loader used at startup to populate partner data from
    `data/geo/partners.csv` so `get_nearby_partners` returns results even when no
    partners have been registered through the API.
    Returns the number of inserted rows.
    """
    if csv_path is None:
        csv_path = os.path.abspath(os.path.join(BASE_DIR, "..", "data", "geo", "partners.csv"))

    try:
        if not os.path.exists(csv_path):
            print(f"[startup] partners CSV not found at {csv_path}; skipping import")
            return 0

        try:
            df = pd.read_csv(csv_path, dtype=str)
        except Exception:
            # fallback to simple csv reader
            import csv

            rows = []
            with open(csv_path, newline='', encoding='utf-8') as f:
                r = csv.DictReader(f)
                for row in r:
                    rows.append(row)
            df = pd.DataFrame(rows)

        def _safe_str(v: Any) -> str:
            # Convert various types (including floats/NaN) to a clean stripped string
            try:
                if v is None:
                    return ""
                # handle pandas NaN (float) and plain float NaN
                import math

                if isinstance(v, float) and math.isnan(v):
                    return ""
            except Exception:
                pass
            try:
                s = str(v)
                if s.lower() == "nan":
                    return ""
                return s.strip()
            except Exception:
                return ""

        inserted = 0
        for i, row in df.iterrows():
            # normalize row keys to lowercase to accept CSVs with mixed-case headers
            try:
                row = {str(k).lower(): v for k, v in dict(row).items()}
            except Exception:
                # fallback: leave row as-is (it may already be a dict)
                try:
                    row = {str(k).lower(): v for k, v in (row.items() if hasattr(row, 'items') else [])}
                except Exception:
                    pass
            if inserted >= max_import:
                break

            org_name = _safe_str(row.get('name') or row.get('org_name') or '')
            shop = _safe_str(row.get('shop') or '').lower()
            recycling = _safe_str(row.get('recycling') or '').lower()
            lat_s = row.get('lat') if (row.get('lat') is not None) else (row.get('latitude') if (row.get('latitude') is not None) else '')
            lon_s = row.get('lon') if (row.get('lon') is not None) else (row.get('longitude') if (row.get('longitude') is not None) else '')
            phone = _safe_str(row.get('phone') or row.get('phone_norm') or '')
            city = _safe_str(row.get('addr_city') or row.get('city') or '')
            addr = _safe_str(row.get('addr_street') or row.get('address') or row.get('full_address') or '')
            
            # If city is empty, try to extract from full_address (format: ", street, , city, ")
            if not city and addr:
                try:
                    parts = [p.strip() for p in addr.split(',')]
                    # Last non-empty part before trailing spaces is usually the city
                    for p in reversed(parts):
                        if p and p.lower() not in ('', ' '):
                            city = p
                            break
                except Exception:
                    pass

            try:
                lat_v = float(lat_s) if lat_s not in (None, '', 'nan') else None
            except Exception:
                lat_v = None
            try:
                lon_v = float(lon_s) if lon_s not in (None, '', 'nan') else None
            except Exception:
                lon_v = None

            # map to partner_type heuristics
            ptype = 'repair'
            if 'recycle' in recycling or 'recycle' in shop or 'recycling' in shop:
                ptype = 'recycler'
            elif 'repair' in shop or 'car_repair' in shop or 'service' in shop:
                ptype = 'repair'

            # skip empty orgs
            if not org_name:
                continue

            # dedupe check: by name and approximate lat/lon or by phone
            exists_q = db.query(Partner).filter(Partner.org_name == org_name)
            maybe = exists_q.first()
            add_it = True
            if maybe:
                # if lat/lon both present, check proximity
                try:
                    if maybe.lat is not None and maybe.lon is not None and lat_v is not None and lon_v is not None:
                        if abs((maybe.lat or 0.0) - lat_v) < 0.0005 and abs((maybe.lon or 0.0) - lon_v) < 0.0005:
                            add_it = False
                    # if phone matches, skip
                    if maybe.contact_phone and phone and maybe.contact_phone == phone:
                        add_it = False
                except Exception:
                    pass

            if not add_it:
                continue

            partner = Partner(
                user_id=0,
                org_name=org_name,
                partner_type=ptype,
                city=city or None,
                address=addr or None,
                lat=lat_v,
                lon=lon_v,
                service_radius_km=10.0,
                contact_phone=phone or None,
                kyc_status='verified',
            )
            try:
                db.add(partner)
                db.commit()
                inserted += 1
            except Exception:
                db.rollback()
                continue

        if inserted:
            print(f"[startup] Imported {inserted} partners from {csv_path}")
        return inserted
    except Exception as e:
        print(f"[startup] Failed to import partners CSV: {e}")
        return 0


def require_partner(user: User, db: Session) -> Partner:
    partner = db.query(Partner).filter(Partner.user_id == user.id).first()
    if not partner:
        raise HTTPException(status_code=403, detail="This account is not registered as a partner")
    return partner


# -----------------------------------------------------------------------------#
# PARTNER ROUTES
# -----------------------------------------------------------------------------#
@app.post("/partners/register")
def register_partner(
    payload: PartnerRegisterIn,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    existing = db.query(Partner).filter(Partner.user_id == user.id).first()

    ptype = payload.partner_type.lower().strip()
    if ptype not in ("repair", "recycler"):
        raise HTTPException(status_code=400, detail="partner_type must be 'repair' or 'recycler'")

    if existing:
        # Update existing partner and mark KYC as submitted for demo
        existing.org_name = payload.org_name.strip()
        existing.partner_type = ptype
        existing.city = (payload.city or None)
        existing.address = (payload.address or None)
        existing.lat = payload.lat
        existing.lon = payload.lon
        existing.service_radius_km = payload.service_radius_km
        existing.contact_phone = (payload.contact_phone or None)
        try:
            existing.kyc_status = "submitted"
        except Exception:
            pass
        user.role = "partner"
        db.add(existing)
        db.commit()
        db.refresh(existing)
        return {"message": "Partner profile updated", "partner_id": existing.id}

    # create new partner
    partner = Partner(
        user_id=user.id,
        org_name=payload.org_name.strip(),
        partner_type=ptype,
        city=(payload.city or None),
        address=(payload.address or None),
        lat=payload.lat,
        lon=payload.lon,
        service_radius_km=payload.service_radius_km,
        contact_phone=(payload.contact_phone or None),
        kyc_status="submitted",
    )
    user.role = "partner"
    db.add(partner)
    db.commit()
    db.refresh(partner)

    return {"message": "Partner registered", "partner_id": partner.id}


@app.get("/partners/me")
def partners_me(
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    partner = db.query(Partner).filter(Partner.user_id == user.id).first()
    if not partner:
        raise HTTPException(status_code=404, detail="Partner profile not found")
    return {
        "id": partner.id,
        "org_name": partner.org_name,
        "partner_type": partner.partner_type,
        "city": partner.city,
        "address": partner.address,
        "lat": partner.lat,
        "lon": partner.lon,
        "service_radius_km": partner.service_radius_km,
        "contact_phone": partner.contact_phone,
        "kyc_status": getattr(partner, "kyc_status", "not_submitted"),
    }


@app.get("/partners/nearby")
def partners_nearby(
    lat: float = Query(...),
    lon: float = Query(...),
    intent: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    items = get_nearby_partners(db, lat, lon, intent=intent)
    return {"items": items}


@app.get("/partners/leads")
def partner_leads(
    status: str = Query("open"),  # "open" or "completed"
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    partner = require_partner(user, db)
    rows = db.query(Listing).all()
    items: List[Dict[str, Any]] = []

    for r in rows:
        try:
            payload = json.loads(r.payload)
        except Exception:
            payload = {}

        intent = getattr(r, "intent", payload.get("intent", "sell"))
        if intent not in ("repair", "recycle"):
            continue

        plat = payload.get("lat")
        plon = payload.get("lon")
        dist = None
        if plat is not None and plon is not None and partner.lat is not None and partner.lon is not None:
            try:
                plat_f = float(plat)
                plon_f = float(plon)
                dist = haversine_km(plat_f, plon_f, partner.lat, partner.lon)
                if partner.service_radius_km is not None and dist > partner.service_radius_km:
                    continue
            except Exception:
                pass

        if status == "open":
            if r.status not in ("created", "shared_with_partner", "in_progress"):
                continue
        elif status == "completed":
            if r.status != "completed":
                continue

        if r.chosen_partner_id is not None and r.chosen_partner_id != partner.id:
            continue

        try:
            res = json.loads(r.result_json) if r.result_json else {}
        except Exception:
            res = {}

        items.append(
            {
                "listing_id": r.id,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "decision": res.get("predictions", {}).get("decision"),
                "status": r.status,
                "distance_km": dist,
                "brand": payload.get("brand"),
                "model": payload.get("model"),
                "city": payload.get("city"),
                "predictions": res.get("predictions"),
                "image_condition": res.get("image_condition"),
                "image": os.path.basename(r.image_path) if r.image_path else None,
            }
        )

    return {"items": items}


@app.post("/partners/leads/{listing_id}/accept")
def partner_accept_lead(
    listing_id: int,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    partner = require_partner(user, db)
    listing = db.query(Listing).filter(Listing.id == listing_id).first()
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")

    if listing.status == "completed":
        raise HTTPException(status_code=400, detail="Listing already completed")

    listing.status = "in_progress"
    listing.chosen_partner_id = partner.id
    db.commit()
    return {"ok": True, "status": listing.status}


@app.post("/partners/leads/{listing_id}/reject")
def partner_reject_lead(
    listing_id: int,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    partner = require_partner(user, db)
    listing = db.query(Listing).filter(Listing.id == listing_id).first()
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")

    if listing.status == "completed":
        raise HTTPException(status_code=400, detail="Listing already completed")

    if listing.chosen_partner_id not in (None, partner.id):
        raise HTTPException(status_code=403, detail="Lead assigned to another partner")

    listing.status = "created"
    listing.chosen_partner_id = None
    db.commit()
    return {"ok": True, "status": listing.status}


@app.post("/partners/leads/{listing_id}/complete")
def partner_complete_lead(
    listing_id: int,
    payload: CompleteLeadIn,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    partner = require_partner(user, db)
    listing = db.query(Listing).filter(Listing.id == listing_id).first()
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")

    if listing.chosen_partner_id not in (None, partner.id):
        raise HTTPException(status_code=403, detail="Lead assigned to another partner")

    listing.status = "completed"
    listing.chosen_partner_id = partner.id
    listing.outcome = payload.outcome.lower().strip()
    if payload.final_price is not None:
        listing.final_price = payload.final_price
    if payload.final_rul_months is not None:
        listing.final_rul_months = payload.final_rul_months

    db.commit()
    return {"ok": True, "status": listing.status}


# -----------------------------------------------------------------------------#
# LISTINGS: create + mine + delete
# -----------------------------------------------------------------------------#
@app.post("/listings/create")
def create_listing(
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
    user_intent: Optional[str] = Form("sell"),
    image: UploadFile = File(...),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):

    raw_bytes = image.file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Empty image")
    image_md5 = hashlib.md5(raw_bytes).hexdigest()
    image.file.seek(0)

    ext = os.path.splitext(image.filename or "")[1].lower()
    if ext not in [".jpg", ".jpeg", ".png", ".webp", ".bmp"]:
        ext = ".jpg"
    fname = f"{uuid.uuid4().hex}{ext}"
    save_path = os.path.join(UPLOAD_DIR, fname)
    with open(save_path, "wb") as f:
        f.write(raw_bytes)

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

    intent = (user_intent or "sell").strip().lower()
    if intent not in ("sell", "repair", "recycle"):
        intent = "sell"

    status_initial = "created"
    if intent in ("repair", "recycle"):
        status_initial = "shared_with_partner"

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
        "intent": intent,
    }

    dedupe_key = hashlib.sha256(
        f"{user.id}|{(brand or '').strip().lower()}|{(model or '').strip().lower()}|{image_md5}".encode()
    ).hexdigest()

    existing = (
        db.query(Listing)
        .filter(Listing.user_id == user.id, Listing.dedupe_key == dedupe_key)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Duplicate listing detected")

    result = None
    detections: List[Dict[str, Any]] = []
    model_used = None
    inference_ms = None

    if ULTRALYTICS_AVAILABLE and YOLO_MODEL is not None:
        try:
            t0 = time.time()
            yres = YOLO_MODEL.predict(
                source=save_path, imgsz=640, conf=0.25, iou=0.45, verbose=False
            )
            inference_ms = int((time.time() - t0) * 1000)

            if len(yres) > 0:
                r0 = yres[0]
                boxes = getattr(r0, "boxes", None)
                try:
                    nat_h, nat_w = r0.orig_shape
                except Exception:
                    try:
                        with Image.open(save_path) as im:
                            nat_w, nat_h = im.width, im.height
                    except Exception:
                        nat_w, nat_h = None, None

                names = getattr(r0, "names", None)
                if names is None:
                    try:
                        names = YOLO_MODEL.model.names
                    except Exception:
                        names = {}

                if boxes is not None:
                    for b in boxes:
                        try:
                            xyxy = (
                                b.xyxy.tolist()[0]
                                if hasattr(b.xyxy, "tolist")
                                else list(map(float, b.xyxy))
                            )
                        except Exception:
                            try:
                                xy = [float(x) for x in b.xyxy]
                                xyxy = xy
                            except Exception:
                                continue
                        try:
                            conf = (
                                float(b.conf.tolist()[0])
                                if hasattr(b.conf, "tolist")
                                else float(b.conf)
                            )
                        except Exception:
                            conf = float(getattr(b, "conf", 0.0))
                        try:
                            cls_id = (
                                int(b.cls.tolist()[0])
                                if hasattr(b.cls, "tolist")
                                else int(b.cls)
                            )
                        except Exception:
                            cls_id = int(getattr(b, "cls", 0))
                        raw_label = names.get(cls_id, str(cls_id))
                        x1, y1, x2, y2 = xyxy
                        if nat_w and nat_h:
                            nx1, ny1, nx2, ny2 = (
                                x1 / nat_w,
                                y1 / nat_h,
                                x2 / nat_w,
                                y2 / nat_h,
                            )
                        else:
                            try:
                                with Image.open(save_path) as im:
                                    nw, nh = im.width, im.height
                                nx1, ny1, nx2, ny2 = (
                                    x1 / nw,
                                    y1 / nh,
                                    x2 / nw,
                                    y2 / nh,
                                )
                            except Exception:
                                nx1, ny1, nx2, ny2 = x1, y1, x2, y2
                        detections.append(
                            {
                                "label": raw_label,
                                "confidence": conf,
                                "bbox": [nx1, ny1, nx2, ny2],
                            }
                        )
            model_used = YOLO_MODEL_NAME
        except Exception as e:
            print(f"[inference] model failed: {e}")
            detections = []
            model_used = None

        # ------------------------------------------------------------------
    # 🔥 NEW PART: ML MODEL ACTUALLY USED
    # ------------------------------------------------------------------
    ml_output = ml_predict(payload)

    if ml_output is not None:
        # Determine image condition: prefer ML-provided condition when available.
        # 1) If the ML pipeline returned an explicit `image_condition`, trust it.
        # 2) Else if YOLO produced detections, derive severity-based label from them.
        # 3) Fallback to using the user-supplied form fields (defect_count, screen/body issues).
        if isinstance(ml_output, dict) and ml_output.get("image_condition"):
            ic = ml_output.get("image_condition") or {}
            cond_label = ic.get("label") or "Good"
            cond_conf = ic.get("confidence") or (0.85 if cond_label == "Good" else (0.7 if cond_label == "Fair" else 0.6))
        else:
            # derive from YOLO detections if present
            defect_dets = [d for d in detections if (d.get("label") or "").lower() not in ("mobile", "phone", "device")]
            if defect_dets:
                severity = sum(d.get("confidence", 0) for d in defect_dets) / max(1, len(defect_dets))
                # thresholds chosen heuristically; tune as needed
                if severity < 0.4:
                    cond_label = "Fair"
                    cond_conf = round(0.6 + severity * 0.5, 2)
                else:
                    cond_label = "Poor"
                    cond_conf = round(0.4 + min(0.5, severity), 2)
            else:
                # fallback to form fields
                defects = c_defect_count or 0
                s_issues = c_screen or 0
                b_issues = c_body or 0
                if defects == 0 and s_issues == 0 and b_issues == 0:
                    cond_label = "Good"
                    cond_conf = 0.85
                elif defects <= 1 and (s_issues + b_issues) <= 1:
                    cond_label = "Fair"
                    cond_conf = 0.7
                else:
                    cond_label = "Poor"
                    cond_conf = 0.6

        # simple RUL heuristic (fallback) — base life by category
        base_map = {"mobile": 48, "laptop": 72, "tablet": 60, "tv": 84}
        base = base_map.get((payload.get("category") or "").lower(), 60)
        rul_months = max(1, int(base - (payload.get("age_months") or 24)))

        preds = ml_output.copy()
        # enforce a sensible minimum price but avoid masking model outputs
        try:
            orig_price = float(payload.get("original_price") or 20000)
            pred_price = int(preds.get("price_suggest", 0) or 0)
            # minimum set to 5% of original price (at least ₹100)
            min_price = max(int(orig_price * 0.05), 100)
            if pred_price <= 0:
                preds["price_suggest"] = min_price
            else:
                preds["price_suggest"] = max(pred_price, min_price)
        except Exception:
            preds["price_suggest"] = int(preds.get("price_suggest", 0) or 100)
        # ensure rul and co2 are present
        preds.setdefault("rul_months", rul_months)
        if "co2_saved_kg" not in preds:
            preds["co2_saved_kg"] = round((preds.get("price_suggest", 0) / max(1, payload.get("original_price") or 20000)) * 40, 2)

        result = {
            "method": "ml_model",
            "model_name": "RandomForest",
            "inference_ms": inference_ms,
            "detections": detections,
            "image_condition": {
                "label": cond_label,
                "confidence": cond_conf,
            },
            "predictions": preds,
            "price_explanation": [
                "Age of device caused depreciation",
                "Battery health reduced resale value",
                "Detected defects lowered market demand",
            ],
        }

    elif detections:
        # ⬅️ YOUR ORIGINAL YOLO RULE LOGIC (UNCHANGED)
        defect_dets = [
            d for d in detections
            if (d.get("label") or "").lower() not in ("mobile", "phone", "device")
        ]

        severity = sum(d["confidence"] for d in defect_dets) / max(1, len(defect_dets))
        age = float(payload.get("age_months") or 24)
        orig_price = float(payload.get("original_price") or 20000)

        degrade = min(0.9, 0.2 + severity * 0.6)
        price = int(max(500, round(orig_price * (1 - degrade), -1)))
        rul = max(1, int(48 - age - severity * 18))

        result = {
            "method": "vision_rule_based",
            "model_name": model_used,
            "inference_ms": inference_ms,
            "detections": detections,
            "image_condition": {"label": "Fair", "confidence": 0.75},
            "predictions": {
                "price_suggest": price,
                "rul_months": rul,
                "decision": "repair" if rul > 6 else "recycle",
                "co2_saved_kg": round((price / orig_price) * 40, 2),
            },
        }

    else:
        # ⬅️ YOUR ORIGINAL SPECS FALLBACK (UNCHANGED)
        price = int(max(500, round((payload.get("original_price") or 20000) * 0.4, -1)))
        result = {
            "method": "specs_rule_based",
            "model_name": None,
            "inference_ms": None,
            "detections": [],
            "image_condition": {"label": "Fair", "confidence": 0.7},
            "predictions": {
                "price_suggest": price,
                "rul_months": 24,
                "decision": "recycle",
                "co2_saved_kg": round((price / 20000) * 40, 2),
            },
        }

    result["nearby_partners"] = get_nearby_partners(db, c_lat, c_lon, intent=intent, max_results=5)

    # If ML predicted 'repair', share with partners immediately instead of 'created'
    try:
        pred_decision = (result.get("predictions") or {}).get("decision")
        if pred_decision == "repair":
            status_initial = "shared_with_partner"
    except Exception:
        pass

    row = Listing(
        user_id=user.id,
        payload=json.dumps(payload),
        image_path=save_path,
        result_json=json.dumps(result),
        image_md5=image_md5,
        dedupe_key=dedupe_key,
        status=status_initial,
        intent=intent,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    result["listing_id"] = row.id
    result["image"] = {"path": fname}
    return result


# ---------------------------
# Admin: minimal moderation
# ---------------------------


@app.get("/admin/partners")
def admin_list_partners(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    rows = db.query(Partner).all()
    items = []
    for p in rows:
        user = db.query(User).filter(User.id == p.user_id).first()
        items.append(
            {
                "id": p.id,
                "org_name": p.org_name,
                "partner_type": p.partner_type,
                "city": p.city,
                "contact_phone": p.contact_phone,
                "kyc_status": getattr(p, "kyc_status", "not_submitted"),
                "user_email": user.email if user else None,
            }
        )
    return {"items": items}


@app.post("/admin/partners/{partner_id}/verify")
def admin_verify_partner(
    partner_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    p = db.query(Partner).filter(Partner.id == partner_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Partner not found")
    p.kyc_status = "verified"
    try:
        u = db.query(User).filter(User.id == p.user_id).first()
        if u:
            u.role = "partner"
            db.add(u)
    except Exception:
        pass
    db.add(p)
    db.commit()
    return {"ok": True, "kyc_status": p.kyc_status}


@app.post("/admin/partners/{partner_id}/reject")
def admin_reject_partner(
    partner_id: int,
    reason: Optional[str] = Form(None),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    p = db.query(Partner).filter(Partner.id == partner_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Partner not found")
    p.kyc_status = "rejected"
    db.add(p)
    db.commit()
    return {"ok": True, "kyc_status": p.kyc_status}


@app.post("/admin/partners/verify-bulk")
def admin_verify_partners_bulk(
    payload: Dict[str, Any] = None,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Bulk-verify partners. Accepts JSON body: {"ids": [1,2,3]} or {"all": true}.
    Marks partners' `kyc_status` to 'verified' and promotes associated users to role 'partner'.
    """
    if payload is None:
        payload = {}
    ids = payload.get("ids")
    all_flag = bool(payload.get("all", False))

    if not all_flag and not ids:
        raise HTTPException(status_code=400, detail="Provide 'ids' list or set 'all': true")

    if all_flag:
        rows = db.query(Partner).all()
    else:
        # ensure ids is a list of ints
        try:
            ids_list = [int(x) for x in ids]
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid ids list")
        rows = db.query(Partner).filter(Partner.id.in_(ids_list)).all()

    updated = 0
    for p in rows:
        if getattr(p, "kyc_status", None) != "verified":
            p.kyc_status = "verified"
            try:
                if getattr(p, "user_id", None):
                    u = db.query(User).filter(User.id == p.user_id).first()
                    if u:
                        u.role = "partner"
                        db.add(u)
            except Exception:
                pass
            db.add(p)
            updated += 1

    db.commit()
    return {"ok": True, "updated": updated}


@app.get("/admin/users")
def admin_list_users(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Return basic user list for admin dashboard."""
    rows = db.query(User).all()
    out = []
    for u in rows:
        out.append({
            "id": u.id,
            "name": u.name,
            "email": u.email,
            "role": getattr(u, "role", "customer"),
            "created_at": u.created_at.isoformat() if getattr(u, "created_at", None) else None,
        })
    return {"items": out}


@app.post("/admin/import-partners")
def admin_import_partners(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
    csv_path: Optional[str] = Form(None),
):
    """Trigger import of `data/geo/partners.csv` (or a provided path) into the partners table.
    Returns the number of inserted rows.
    """
    try:
        count = load_partners_from_csv(db, csv_path=csv_path)
        print(f"[admin] partners imported: {count}")
        return {"imported": count}
    except Exception as e:
        print("[admin] Failed to import partners CSV:", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/admin/listings")
def admin_listings(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
    status: Optional[str] = Query(None),
):
    q = db.query(Listing)
    if status:
        q = q.filter(Listing.status == status)
    rows = q.order_by(Listing.created_at.desc()).limit(200).all()
    items = []
    for r in rows:
        try:
            payload = json.loads(r.payload)
        except Exception:
            payload = {}
        user = db.query(User).filter(User.id == r.user_id).first()
        items.append(
            {
                "id": r.id,
                "user_email": user.email if user else None,
                "status": r.status,
                "intent": getattr(r, "intent", payload.get("intent")),
                "image": os.path.basename(r.image_path) if r.image_path else None,
                "payload": payload,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
        )
    return {"items": items}


@app.post("/admin/listings/{listing_id}/hide")
def admin_hide_listing(
    listing_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    r = db.query(Listing).filter(Listing.id == listing_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Listing not found")
    r.status = "hidden"
    db.add(r)
    db.commit()
    return {"ok": True, "status": r.status}


@app.post("/admin/listings/{listing_id}/restore")
def admin_restore_listing(
    listing_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    r = db.query(Listing).filter(Listing.id == listing_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Listing not found")
    r.status = "created"
    db.add(r)
    db.commit()
    return {"ok": True, "status": r.status}


@app.delete("/admin/listings/{listing_id}")
def admin_remove_listing(
    listing_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    r = db.query(Listing).filter(Listing.id == listing_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Listing not found")
    r.status = "removed"
    db.add(r)
    db.commit()
    return {"ok": True, "status": r.status}


@app.get("/listings/mine")
def my_listings(user: User = Depends(require_user), db: Session = Depends(get_db)):
    """Return listings created by the authenticated user."""
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
                "image": os.path.basename(r.image_path) if r.image_path else None,
                "predictions": res.get("predictions"),
                "image_condition": res.get("image_condition"),
                "status": getattr(r, "status", None),
                "intent": getattr(r, "intent", None),
            }
        )

    return {"items": items}


@app.delete("/listings/{listing_id}")
def delete_listing(listing_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    """Delete a listing owned by the authenticated user.

    Returns 404 if listing does not exist, 403 if the listing belongs to another user.
    Also removes the image file from disk when present.
    """
    row = db.query(Listing).filter(Listing.id == listing_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Listing not found")

    if row.user_id != user.id:
        raise HTTPException(status_code=403, detail="Not authorized to delete this listing")

    # attempt to remove image file (best-effort)
    try:
        if row.image_path and os.path.exists(row.image_path):
            os.remove(row.image_path)
    except Exception:
        pass

    db.delete(row)
    db.commit()
    return {"ok": True}

# ---------------------------------------------------------------------
# PARTNER LEADS - simple version for partner dashboard
# ---------------------------------------------------------------------

def _serialize_listing_for_lead(row: Listing) -> Dict[str, Any]:
    """Convert Listing row to a lightweight 'lead' object."""
    try:
        p = json.loads(row.payload)
    except Exception:
        p = {}
    try:
        res = json.loads(row.result_json) if row.result_json else {}
    except Exception:
        res = {}

    return {
        "id": row.id,
        "listing_id": row.id,
        "brand": p.get("brand"),
        "model": p.get("model"),
        "city": p.get("city"),
        "intention": p.get("intention") or p.get("use_case"),
        "status": p.get("status") or "created",
        "image": os.path.basename(row.image_path) if row.image_path else None,
        "predictions": res.get("predictions"),
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


@app.get("/partner/leads")
def partner_leads_simple(user: User = Depends(require_user), db: Session = Depends(get_db)):
    """
    Basic implementation:
    - Returns recent listings as 'leads'.
    - You can later filter by intention (repair/recycle) and by distance/partner_id.
    """
    rows = (
        db.query(Listing)
        .order_by(Listing.created_at.desc())
        .limit(50)
        .all()
    )
    items = [_serialize_listing_for_lead(r) for r in rows]
    return {"items": items}
