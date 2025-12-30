"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { useSearchParams } from "next/navigation";
import toast from "react-hot-toast"; 

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

function cx(...a: Array<string | false | null | undefined>) {
  return a.filter(Boolean).join(" ");
}

const Label = ({ children }: { children: React.ReactNode }) => (
  <label className="label">{children}</label>
);

function TextField(props: {
  label: string;
  value: any;
  onChange: (e: any) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  readOnly?: boolean;
}) {
  const {
    label,
    value,
    onChange,
    type = "text",
    placeholder,
    required = false,
    readOnly = false,
  } = props;
  return (
    <div className="space-y-1">
      <Label>
        {label} {required && <span className="text-red-500">*</span>}
      </Label>
      <input
        className={cx("input", readOnly && "bg-slate-100 cursor-not-allowed")}
        value={value}
        onChange={onChange}
        type={type}
        placeholder={placeholder}
        required={required}
        readOnly={readOnly}
      />
    </div>
  );
}

type AuthState = { token: string | null; name: string | null };

const labelInfo: Record<
  string,
  { explanation: string; reduction_pct?: number; short: string }
> = {
  glass_crack: {
    explanation:
      "Visible glass crack on front screen. Replacing glass/display is costly and reduces resale price.",
    reduction_pct: 30,
    short: "Screen crack",
  },
  "in-display-pixel-defect": {
    explanation:
      "Display/pixel/touch defects that affect usability and are expensive to repair.",
    reduction_pct: 35,
    short: "Display defect",
  },
  "body-damage": {
    explanation: "Dents or large scratches on body reduce buyer confidence.",
    reduction_pct: 20,
    short: "Body damage",
  },
  battery_fault: {
    explanation: "Low battery health reduces expected lifespan and resale value.",
    reduction_pct: 15,
    short: "Battery fault",
  },
  default: {
    explanation: "Detected defect affecting appearance or functionality.",
    reduction_pct: 15,
    short: "Defect",
  },
};

export default function NewListingPage() {
  const [auth, setAuth] = useState<AuthState>({ token: null, name: null });
  const [isLoading, setIsLoading] = useState(false);
  const [tab, setTab] = useState<"login" | "register">("login");

  const [reg, setReg] = useState({ name: "", email: "", password: "", confirmPassword: "", isPartner: false });
  const [login, setLogin] = useState({ email: "", password: "" });
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotStage, setForgotStage] = useState<"email" | "reset">("email");
  const [resetTokenInput, setResetTokenInput] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");
  const [resetLoading, setResetLoading] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [form, setForm] = useState<any>({
    brand: "Apple",
    model: "",
    age_months: "",
    original_price: "",
    battery_health: "",
    storage_gb: "64",
    city: "Bengaluru",
    lat: "",
    lon: "",
    intent: "sell", // sell / repair / recycle
  });
  const [result, setResult] = useState<any>(null);
  const [cropUrl, setCropUrl] = useState<string | null>(null);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cropCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // ---------- compute backHref from ?next=... ----------
  const searchParams = useSearchParams();
  const nextParamRaw = searchParams?.get("next") ?? "";
  let backHref = "/";
  if (nextParamRaw) {
    try {
      const decoded = decodeURIComponent(nextParamRaw);
      // If they came from /partner, treat that as part of listing flow and send them to /new-listing instead
      if (decoded === "/partner" || decoded.startsWith("/partner")) {
        backHref = "/new-listing";
      } else {
        backHref = decoded;
      }
    } catch {
      backHref = nextParamRaw;
    }
  }
  // -----------------------------------------------------

  const isValidResult = (r: any) =>
  !!r && (!!r.predictions || !!r.image_condition);

  useEffect(() => {
    const t = localStorage.getItem("ew_token");
    const n = localStorage.getItem("ew_name");
    if (t) setAuth({ token: t, name: n });
  }, []);

  const saveAuth = (token: string, name: string, role: string = "customer") => {
    setAuth({ token, name });
    localStorage.setItem("ew_token", token);
    localStorage.setItem("ew_name", name);
    localStorage.setItem("ew_role", role);
  };

  const doRegister = async () => {
    try {
      if (!reg.name || !reg.email || !reg.password) {
        toast.error("Fill Name, Email, Password");
        return;
      }
      if (reg.password !== reg.confirmPassword) {
        toast.error("Passwords do not match");
        return;
      }
      if (reg.password.length < 6) {
        toast.error("Password must be at least 6 characters");
        return;
      }
      const payload = {
        name: reg.name.trim(),
        email: reg.email.trim().toLowerCase(),
        password: reg.password,
        is_partner: reg.isPartner,
      };
      await axios.post(`${API}/auth/register`, payload);
      toast.success("Account created. Please login.");
      setTab("login");
      setReg({ name: "", email: "", password: "", confirmPassword: "", isPartner: false });
    } catch (err: any) {
      toast.error(
        err?.response?.data?.detail || err.message || "Register failed",
      );
    }
  };

  const doLogin = async () => {
    try {
      const data = new URLSearchParams();
      data.append("username", login.email);
      data.append("password", login.password);

      const res = await axios.post(`${API}/auth/login`, data, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      const role = res.data.role || "customer";
      saveAuth(res.data.access_token, res.data.name, role);
      toast.success("Signed in");

      if (typeof window !== "undefined") {
        if (role === "admin") {
          window.location.href = "/admin/dashboard";
        } else if (role === "partner") {
          window.location.href = "/partner";
        } else {
          const params = new URLSearchParams(window.location.search);
          const next = params.get("next") || params.get("redirect");
          if (next) {
            window.location.href = next;
          } else {
            window.location.href = "/new-listing";
          }
        }
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Login failed");
    }
  };

  const doForgotPassword = async () => {
    if (!forgotEmail) {
      toast.error("Enter your email");
      return;
    }
    setForgotLoading(true);
    try {
      const form = new URLSearchParams();
      form.append("email", forgotEmail);
      const res = await axios.post(`${API}/auth/forgot-password`, form, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      toast.success("Reset link sent! Check your email.");
      // Move to reset stage so user can paste token and set a new password immediately (helpful for demo)
      setForgotStage("reset");
      if (res.data?.reset_token) {
        setResetTokenInput(res.data.reset_token);
        toast((t) => (
          <div className="text-sm">
            <p className="font-semibold mb-2">Demo: Reset Token</p>
            <p className="text-xs break-all bg-slate-100 p-2 rounded font-mono">
              {res.data.reset_token}
            </p>
          </div>
        ), { duration: 15000 });
      }
    } catch (err: any) {
      toast.error("Failed to send reset link");
    } finally {
      setForgotLoading(false);
    }
  };

  const doResetPasswordInline = async () => {
    if (!resetTokenInput) {
      toast.error("Enter reset token (from email)");
      return;
    }
    if (resetNewPassword !== resetConfirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (resetNewPassword.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setResetLoading(true);
    try {
      const res = await axios.post(
        `${API}/auth/reset-password`,
        { token: resetTokenInput, new_password: resetNewPassword },
        { validateStatus: () => true }
      );
      if (res.status === 200) {
        toast.success("Password reset successfully. Please login.");
        // close and reset modal state
        setShowForgot(false);
        setForgotStage("email");
        setForgotEmail("");
        setResetTokenInput("");
        setResetNewPassword("");
        setResetConfirmPassword("");
      } else {
        const msg = res.data?.detail || res.data?.error || "Password reset failed";
        toast.error(msg);
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || err?.message || "Password reset failed");
    } finally {
      setResetLoading(false);
    }
  };

  const logout = () => {
    setAuth({ token: null, name: null });
    localStorage.removeItem("ew_token");
    localStorage.removeItem("ew_name");
  };

  // ---------- UX helpers ----------
  const requiredKeys: Array<keyof typeof form> = [
    "brand",
    "model",
    "age_months",
    "original_price",
  ];

  const missing = requiredKeys.filter((k) => {
    const v = form[k];
    return v === null || v === undefined || String(v).trim() === "";
  });

  const canSubmit = !!auth.token && !!file && missing.length === 0 && !isLoading;

  const toNum = (v: any): number | undefined => {
    if (v === "" || v === null || v === undefined) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  function drawBoxesOnCanvas(detections: any[] = []) {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2;

    if (!detections || detections.length === 0) return;

    const sx = img.width / (img.naturalWidth || img.width);
    const sy = img.height / (img.naturalHeight || img.height);

    const sorted = [...detections].sort(
      (a, b) =>
        (b.confidence ?? b.score ?? 0) - (a.confidence ?? a.score ?? 0),
    );
    const top = sorted[0];

    sorted.forEach((d: any, i: number) => {
      let bbox = d.bbox || d.box || null;
      if (!bbox || bbox.length < 4) return;
      const isNormalized =
        Array.isArray(bbox) &&
        bbox.every(
          (v: number) => typeof v === "number" && v >= 0 && v <= 1,
        );
      let [x1, y1, x2, y2] = bbox;
      if (isNormalized) {
        x1 = x1 * (img.naturalWidth || img.width);
        y1 = y1 * (img.naturalHeight || img.height);
        x2 = x2 * (img.naturalWidth || img.width);
        y2 = y2 * (img.naturalHeight || img.height);
      }
      const rx = x1 * sx;
      const ry = y1 * sy;
      const rw = (x2 - x1) * sx;
      const rh = (y2 - y1) * sy;

      const isTop = top && top === d;
      if (isTop) {
        ctx.lineWidth = 4;
        ctx.strokeStyle = "#ff2d55";
        ctx.fillStyle = "#ff2d55";
      } else {
        ctx.lineWidth = 2;
        const colors = [
          "#e6194b",
          "#3cb44b",
          "#ffe119",
          "#4363d8",
          "#f58231",
          "#911eb4",
          "#46f0f0",
        ];
        ctx.strokeStyle = colors[i % colors.length];
        ctx.fillStyle = ctx.strokeStyle as string;
      }

      ctx.globalAlpha = 1.0;
      ctx.strokeRect(rx, ry, rw, rh);

      const label = d.label || d.name || "obj";
      const conf =
        typeof d.confidence !== "undefined"
          ? d.confidence
          : d.score || 0;
      const txt = `${label} ${(conf || 0).toFixed(2)}`;
      ctx.font = "14px Arial";
      const textWidth = ctx.measureText(txt).width + 6;
      const textHeight = 18;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(rx, ry - textHeight, textWidth, textHeight);
      ctx.globalAlpha = 1.0;
      ctx.fillStyle = "#fff";
      ctx.fillText(txt, rx + 3, ry - 4);
    });
  }

  function generateCropFromDetection(d: any) {
    const img = imgRef.current;
    if (!img || !d || !d.bbox) {
      setCropUrl(null);
      return;
    }
    let [x1, y1, x2, y2] = d.bbox;
    const isNormalized =
      [x1, y1, x2, y2].every(
        (v: number) => typeof v === "number" && v >= 0 && v <= 1,
      );
    const natW = img.naturalWidth || img.width;
    const natH = img.naturalHeight || img.height;
    if (isNormalized) {
      x1 = x1 * natW;
      y1 = y1 * natH;
      x2 = x2 * natW;
      y2 = y2 * natH;
    }
    x1 = Math.max(0, Math.round(x1));
    y1 = Math.max(0, Math.round(y1));
    x2 = Math.min(natW, Math.round(x2));
    y2 = Math.min(natH, Math.round(y2));
    const w = Math.max(8, x2 - x1);
    const h = Math.max(8, y2 - y1);

    let c = cropCanvasRef.current;
    if (!c) {
      c = document.createElement("canvas");
      cropCanvasRef.current = c;
    }
    const maxThumb = 300;
    const scale = Math.min(1, maxThumb / w);
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    const ctx = c.getContext("2d");
    if (!ctx) {
      setCropUrl(null);
      return;
    }
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(img, x1, y1, w, h, 0, 0, c.width, c.height);
    ctx.strokeStyle = "#ff2d55";
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, c.width, c.height);
    const dataUrl = c.toDataURL("image/jpeg", 0.9);
    setCropUrl(dataUrl);
  }

  useEffect(() => {
    drawBoxesOnCanvas(result?.detections || []);
    if (result?.detections?.length) {
      const top = [...result.detections].sort(
        (a: any, b: any) =>
          (b.confidence ?? b.score ?? 0) -
          (a.confidence ?? a.score ?? 0),
      )[0];
      const img = imgRef.current;
      if (img && !img.naturalWidth) {
        img.onload = () => generateCropFromDetection(top);
      } else {
        generateCropFromDetection(top);
      }
    } else {
      setCropUrl(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, result?.detections]);

  async function reverseGeocode(lat: number, lon: number) {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "SmartCircularE-Waste/1.0" },
      });
      if (!res.ok) return null;
      const data = await res.json();
      const place =
        data?.address?.city ||
        data?.address?.town ||
        data?.address?.village ||
        data?.address?.county;
      return place || null;
    } catch {
      return null;
    }
  }

  const getLocation = () => {
    if (!navigator.geolocation) {
      toast.error("Geolocation not supported");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lon = Number(pos.coords.longitude.toFixed(6));
        const city = await reverseGeocode(lat, lon);
        setForm((f: any) => ({
          ...f,
          lat: String(lat),
          lon: String(lon),
          city: city || f.city,
        }));
        toast.success("Location detected");
      },
      () => {
        toast.error("Unable to get location");
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const submitListing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.token) return toast.error("Please login first");
    if (!file) return toast.error("Choose an image");
    if (missing.length) {
      return toast.error(
        `Please fill required fields: ${missing
          .join(", ")
          .replaceAll("_", " ")}`,
      );
    }

    const fd = new FormData();
    const entries: Record<string, any> = {
      brand: form.brand,
      model: form.model,
      age_months: toNum(form.age_months),
      original_price: toNum(form.original_price),
      battery_health: toNum(form.battery_health),
      storage_gb: form.storage_gb,
      city: form.city || "",
      lat: toNum(form.lat),
      lon: toNum(form.lon),
    };
    Object.entries(entries).forEach(([k, v]) => {
      if (v !== undefined && v !== "") fd.append(k, String(v));
    });
    fd.append("user_intent", form.intent || "sell");
    fd.append("image", file);

    setIsLoading(true);
    try {
      const { data } = await axios.post(`${API}/listings/create`, fd, {
        headers: {
          Authorization: `Bearer ${auth.token}`,
          "Content-Type": "multipart/form-data",
        },
      });

      setResult(data || null);
      toast.success("Uploaded & predicted");

      if (data?.image?.path) {
        const backendImageUrl = `${API.replace(
          /\/$/,
          "",
        )}/uploads/${data.image.path}`;
        setPreview(backendImageUrl);
      } else {
        if (file) setPreview(URL.createObjectURL(file));
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err: any) {
      const status = err?.response?.status;
      const payload = err?.response?.data;

      if (status === 422 && payload) {
        let userMsg = "Validation error";
        try {
          if (Array.isArray(payload)) {
            userMsg = payload
              .map((p: any) => {
                const loc = Array.isArray(p.loc)
                  ? p.loc.join(".")
                  : String(p.loc || "");
                return `${loc}: ${p.msg}`;
              })
              .join("; ");
          } else if (payload.detail) {
            userMsg =
              typeof payload.detail === "string"
                ? payload.detail
                : JSON.stringify(payload.detail);
          } else {
            userMsg = JSON.stringify(payload);
          }
        } catch {
          userMsg = "Invalid input. Please check the form.";
        }

        toast.error(userMsg);
       // setResult(null);
      } else {
        const msg =
          err?.response?.data?.detail ||
          err?.message ||
          "Upload failed";
        toast.error(msg);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const map = useMemo(() => {
    let lat = Number(form.lat),
      lon = Number(form.lon);
    if ((isNaN(lat) || isNaN(lon)) && result?.nearby_partners?.length) {
      lat = result.nearby_partners[0].lat;
      lon = result.nearby_partners[0].lon;
    }
    if (isNaN(lat) || isNaN(lon)) return null;
    const delta = 0.02;
    const left = lon - delta,
      right = lon + delta,
      bottom = lat - delta,
      top = lat + delta;
    const marker = `${lat}%2C${lon}`;
    const src = `https://www.openstreetmap.org/export/embed.html?bbox=${left}%2C${bottom}%2C${right}%2C${top}&layer=mapnik&marker=${marker}`;
    const link = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=15/${lat}/${lon}`;
    return { src, link, lat, lon };
  }, [form.lat, form.lon, result?.nearby_partners]);

  useEffect(() => {
    return () => {
      if (preview && preview.startsWith("blob:")) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  /* ------------------------- AUTH VIEW ------------------------- */
  if (!auth.token) {
    return (
      <div className="min-h-screen">
        <nav className="navbar">
          <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img
                src="/logo.png"
                alt="E-Waste Logo"
                className="w-9 h-9 rounded-md"
              />
              <h1 className="text-2xl font-bold tracking-tight">
                <span className="brand-text">
                  Smart Circular E-Waste Platform
                </span>
              </h1>
            </div>
            {/* Back to app uses computed backHref */}
            <Link
              href={backHref}
              className="rounded-xl border px-3 py-2 bg-white hover:bg-slate-100 text-sm"
            >
              ← Back to app
            </Link>
          </div>
        </nav>

        <main className="mx-auto max-w-4xl px-6 py-10">
          <div className="card card-hover p-8 space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                <button
                  onClick={() => setTab("login")}
                  className={cx(
                    "tab",
                    tab === "login" ? "tab-active" : "tab-passive",
                  )}
                >
                  Login
                </button>
                <button
                  onClick={() => setTab("register")}
                  className={cx(
                    "tab",
                    tab === "register" ? "tab-active" : "tab-passive",
                  )}
                >
                  Register
                </button>
              </div>
            </div>

            {tab === "login" ? (
              <div className="grid md:grid-cols-2 gap-6">
                <TextField
                  label="Email"
                  value={login.email}
                  onChange={(e) =>
                    setLogin({ ...login, email: e.target.value })
                  }
                  placeholder="you@example.com"
                  required
                />
                <TextField
                  label="Password"
                  type="password"
                  value={login.password}
                  onChange={(e) =>
                    setLogin({ ...login, password: e.target.value })
                  }
                  placeholder="••••••••"
                  required
                />
                <div className="md:col-span-2 flex items-center justify-between">
                  <div className="flex gap-2 text-xs text-slate-500">
                    <button
                      type="button"
                      onClick={() => setShowForgot(true)}
                      className="underline text-sky-600 hover:font-semibold"
                    >
                      Forgot password?
                    </button>
                    <span>•</span>
                    <span>
                      Are you a repair / recycler partner?{" "}
                      <Link
                        className="underline text-sky-600 hover:font-semibold"
                        href={`/partner?next=${encodeURIComponent("/new-listing")}`}
                      >
                        Go to Partner Portal
                      </Link>
                    </span>
                  </div>
                  <button
                    onClick={doLogin}
                    className="btn btn-primary w-full md:w-auto"
                  >
                    Login
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid md:grid-cols-3 gap-6">
                <TextField
                  label="Full name"
                  value={reg.name}
                  onChange={(e) =>
                    setReg({ ...reg, name: e.target.value })
                  }
                  placeholder="Test User"
                  required
                />
                <TextField
                  label="Email"
                  value={reg.email}
                  onChange={(e) =>
                    setReg({ ...reg, email: e.target.value })
                  }
                  placeholder="you@example.com"
                  required
                />
                <TextField
                  label="Password"
                  type="password"
                  value={reg.password}
                  onChange={(e) =>
                    setReg({ ...reg, password: e.target.value })
                  }
                  placeholder="••••••••"
                  required
                />
                <TextField
                  label="Confirm Password"
                  type="password"
                  value={reg.confirmPassword}
                  onChange={(e) =>
                    setReg({ ...reg, confirmPassword: e.target.value })
                  }
                  placeholder="••••••••"
                  required
                />
                {/* Partner Checkbox */}
                <div className="md:col-span-3 rounded-lg bg-slate-50 border border-slate-200 p-4">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={reg.isPartner}
                      onChange={(e) =>
                        setReg({ ...reg, isPartner: e.target.checked })
                      }
                      className="w-4 h-4"
                    />
                    <span className="text-sm text-slate-700 font-medium">
                      Register as a Partner
                    </span>
                  </label>
                  <p className="text-xs text-slate-500 ml-7 mt-2">
                    Check this if you&apos;re a repair or recycling business. Your profile will be reviewed by our admin team.
                  </p>
                </div>
                <div className="md:col-span-3">
                  <button
                    onClick={doRegister}
                    className="btn btn-primary w-full md:w-auto"
                  >
                    Create account
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Forgot Password Modal */}
          {showForgot && (
            <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-50">
              <div className="card p-6 max-w-sm w-full">
                <h3 className="text-lg font-bold mb-4">Reset Password</h3>
                <div className="space-y-4">
                  {/* Simple no-email flow: enter email + new password and submit. This calls a guarded backend endpoint (ALLOW_INSECURE_RESET=true). */}
                  <>
                    <div className="text-sm text-slate-600">Enter your account email and choose a new password. (No email will be sent.)</div>
                    <div className="space-y-3 mt-2">
                      <TextField label="Email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} placeholder="your@email.com" />
                      <TextField label="New Password" type="password" value={resetNewPassword} onChange={(e) => setResetNewPassword(e.target.value)} placeholder="••••••••" />
                      <TextField label="Confirm Password" type="password" value={resetConfirmPassword} onChange={(e) => setResetConfirmPassword(e.target.value)} placeholder="••••••••" />
                    </div>
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => {
                          setShowForgot(false);
                          setForgotEmail("");
                          setResetNewPassword("");
                          setResetConfirmPassword("");
                        }}
                        className="flex-1 px-4 py-2 border rounded text-slate-600 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={async () => {
                          if (!forgotEmail) { toast.error("Enter your email"); return; }
                          if (resetNewPassword !== resetConfirmPassword) { toast.error("Passwords do not match"); return; }
                          if (resetNewPassword.length < 6) { toast.error("Password must be at least 6 characters"); return; }
                          try {
                            const form = new URLSearchParams();
                            form.append("email", forgotEmail);
                            form.append("new_password", resetNewPassword);
                            const res = await axios.post(`${API}/auth/reset-password-direct`, form, { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
                            toast.success(res.data?.message || "Password reset")
                            setShowForgot(false);
                            setForgotEmail("");
                            setResetNewPassword("");
                            setResetConfirmPassword("");
                          } catch (err: any) {
                            const msg = err?.response?.data?.detail || err?.message || "Reset failed";
                            toast.error(msg);
                          }
                        }}
                        className="flex-1 btn btn-primary"
                      >
                        Reset Password
                      </button>
                    </div>
                  </>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    );
  }

  /* ------------------------- APP VIEW ------------------------- */
  return (
    <div className="min-h-screen">
      <header className="navbar">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="E-Waste Logo"
              className="w-9 h-9 rounded-md"
            />
            <h1 className="text-xl md:text-2xl font-bold tracking-tight brand-text">
              Smart Circular E-Waste Platform
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href={backHref}
              className="rounded-xl border px-3 py-2 bg-white hover:bg-slate-100 text-sm"
            >
              ← Back to app
            </Link>
            <span className="hidden sm:inline text-sm text-slate-700">
              Hi, {auth.name}
            </span>
            <button
              onClick={logout}
              className="btn bg-red-600 text-white px-3 py-2 hover:bg-red-700"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-10 grid lg:grid-cols-2 gap-10">
        {/* LEFT: Form */}
        <section className="card card-hover p-8 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">
              📦 Quick Listing
            </h2>
            <span className="badge">Fast — 1 min</span>
          </div>
          <div className="divider" />

          <form onSubmit={submitListing} className="space-y-6">
            <div className="grid sm:grid-cols-2 gap-6">
              <div className="space-y-1">
                <Label>Brand</Label>
                <select
                  className="input"
                  value={form.brand}
                  onChange={(e) =>
                    setForm({ ...form, brand: e.target.value })
                  }
                >
                  <option>Apple</option>
                  <option>Samsung</option>
                  <option>OnePlus</option>
                  <option>Realme</option>
                  <option>Xiaomi</option>
                  <option>Vivo</option>
                  <option>Nokia</option>
                  <option>Other</option>
                </select>
              </div>

              <TextField
                label="Model"
                value={form.model}
                onChange={(e) =>
                  setForm({ ...form, model: e.target.value })
                }
                placeholder="iPhone 12 / Galaxy S21"
                required
              />

              <TextField
                label="Age (months)"
                type="number"
                value={form.age_months}
                onChange={(e) =>
                  setForm({ ...form, age_months: e.target.value })
                }
                placeholder="12"
                required
              />
              <TextField
                label="Original Price (₹)"
                type="number"
                value={form.original_price}
                onChange={(e) =>
                  setForm({
                    ...form,
                    original_price: e.target.value,
                  })
                }
                placeholder="30000"
                required
              />

              <TextField
                label="Battery (%)"
                type="number"
                value={form.battery_health}
                onChange={(e) =>
                  setForm({
                    ...form,
                    battery_health: e.target.value,
                  })
                }
                placeholder="80"
              />

              <div className="space-y-1">
                <Label>Storage (GB)</Label>
                <select
                  className="input"
                  value={form.storage_gb}
                  onChange={(e) =>
                    setForm({ ...form, storage_gb: e.target.value })
                  }
                >
                  <option>32</option>
                  <option>64</option>
                  <option>128</option>
                  <option>256</option>
                </select>
              </div>

              {/* User intent: what they want to do */}
              <div className="space-y-1 sm:col-span-2">
                <Label>What do you want to do?</Label>
                <select
                  className="input max-w-xs"
                  value={form.intent}
                  onChange={(e) => setForm({ ...form, intent: e.target.value })}
                >
                  <option value="sell">I want to sell this device</option>
                  <option value="repair">I want to repair this device</option>
                  <option value="recycle">I want to recycle / dispose safely</option>
                </select>
              </div>

              {/* Location fields */}
              <div className="space-y-1">
                <Label>Latitude</Label>
                <input
                  className="input"
                  value={form.lat}
                  readOnly
                  placeholder="(auto)"
                />
              </div>
              <div className="space-y-1">
                <Label>Longitude</Label>
                <input
                  className="input"
                  value={form.lon}
                  readOnly
                  placeholder="(auto)"
                />
              </div>
              <div className="space-y-1">
                <Label>City</Label>
                <input
                  className="input"
                  value={form.city}
                  onChange={(e) =>
                    setForm({ ...form, city: e.target.value })
                  }
                  placeholder="City"
                />
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={getLocation}
                  className="btn btn-ghost w-full"
                >
                  Use my location
                </button>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-6">
              <div className="space-y-1">
                <Label>Product Image</Label>
                <label className="flex items-center justify-center h-28 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 cursor-pointer transition">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0] || null;
                      setFile(f);
                      setPreview(f ? URL.createObjectURL(f) : null);
                      setResult(null);
                      setCropUrl(null);
                    }}
                  />
                  <span className="text-sm text-slate-600">
                    {file ? file.name : "Click to choose file"}
                  </span>
                </label>
                {preview && (
                  <div className="mt-2 relative inline-block">
                    <img
                      ref={imgRef}
                      src={preview}
                      alt="preview"
                      className="h-28 w-auto rounded-lg border"
                    />
                    <canvas
                      ref={canvasRef}
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        pointerEvents: "none",
                      }}
                    />
                  </div>
                )}
              </div>

              <div className="flex items-end gap-3">
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className={cx(
                    "btn btn-primary w-full",
                    (!canSubmit || isLoading) &&
                      "opacity-60 cursor-not-allowed",
                  )}
                >
                  {isLoading ? "Uploading..." : "Upload & Predict"}
                </button>
              </div>
            </div>

            {missing.length > 0 && (
              <p className="text-xs text-red-600">
                Required: {missing.join(", ").replaceAll("_", " ")}
              </p>
            )}
          </form>
        </section>

        {/* RIGHT: Results + Map + Partners */}
        <section className="space-y-6">
          <div className="card card-hover p-8 space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">
              📈 Prediction (explanation)
            </h2>

            {isValidResult(result) && (
              <div className="mt-2 text-xs text-slate-500">
                <span>
                  Detections: {" "}
                  <strong>
                    {Array.isArray(result.detections)
                      ? result.detections.length
                      : 0}
                  </strong>
                </span>
              </div>
            )}

            {!isValidResult(result) ? (
              <p className="text-sm text-slate-600">
                Submit a listing to see condition, price, RUL and nearby
                partners.
              </p>
            ) : (
              <>
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-xs text-slate-500">
                        Predicted condition
                      </div>
                      <div className="mt-1 text-lg font-semibold">
                        {(result.image_condition &&
                          result.image_condition.label) ||
                          "Unknown"}
                      </div>
                      <div className="text-xs text-slate-500">
                        Confidence:{" "}
                        {result.image_condition &&
                        typeof result.image_condition.confidence ===
                          "number"
                          ? result.image_condition.confidence.toFixed(2)
                          : "—"}
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-xs text-slate-500">
                        Estimated impact
                      </div>
                      <div className="text-xl font-bold text-rose-600">
                        {(() => {
                          const top =
                            Array.isArray(result.detections) &&
                            result.detections.length
                              ? result.detections[0]
                              : null;
                          const info =
                            top && top.label
                              ? labelInfo[top.label] ?? labelInfo.default
                              : labelInfo.default;
                          return info.short;
                        })()}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 text-sm text-slate-700">
                    {/* Prefer server-provided explanation (from ML + vision) when available */}
                    {Array.isArray(result?.price_explanation) && result.price_explanation.length ? (
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Why the price changed</div>
                        <ul className="list-disc pl-5 space-y-1 text-slate-700">
                          {result.price_explanation.map((t: string, i: number) => (
                            <li key={i} className="text-sm">{t}</li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      (() => {
                        const top =
                          Array.isArray(result.detections) &&
                          result.detections.length
                            ? result.detections[0]
                            : null;
                        if (top && top.label) {
                          const info =
                            labelInfo[top.label] ?? labelInfo.default;
                          return `${info.short}: ${info.explanation}`;
                        }
                        if (
                          result.predictions &&
                          (result.predictions.price_suggest ||
                            result.predictions.rul_months)
                        ) {
                          return `Price and RUL estimated from device specs and image.`;
                        }
                        return `No specific defect was identified by the model.`;
                      })()
                    )}
                  </div>

                  {Array.isArray(result.detections) &&
                  result.detections.length ? (
                    <div className="mt-3 text-xs space-y-2">
                      <div className="text-slate-600 mb-2">
                        Detected issues
                      </div>
                      {result.detections.map((d: any, i: number) => (
                        <div
                          key={i}
                          className="flex items-center gap-3"
                        >
                          <div className="w-28 text-xs">
                            {d.label || d.name || "issue"}
                          </div>
                          <div className="flex-1 bg-slate-100 rounded h-3 overflow-hidden">
                            <div
                              style={{
                                width: `${Math.round(
                                  ((d.confidence ?? d.score ?? 0) as number) *
                                    100,
                                )}%`,
                              }}
                              className="h-3 bg-green-500"
                            />
                          </div>
                          <div className="text-xs w-10 text-right">
                            {Math.round(
                              ((d.confidence ?? d.score ?? 0) as number) * 100,
                            )}
                            %
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>

                {cropUrl &&
                Array.isArray(result.detections) &&
                result.detections.length ? (
                  <div className="mt-4 flex gap-4 items-start">
                    <div className="w-28 h-28 flex-shrink-0 rounded overflow-hidden border">
                      <img
                        src={cropUrl}
                        alt="defect crop"
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div>
                      <div className="text-sm font-medium">
                        {(() => {
                          const top = [...result.detections].sort(
                            (a: any, b: any) =>
                              (b.confidence ?? b.score ?? 0) -
                              (a.confidence ?? a.score ?? 0),
                          )[0];
                          return (
                            labelInfo[top?.label]?.short ||
                            top?.label ||
                            "Defect"
                          );
                        })()}
                      </div>
                      <div className="text-xs text-slate-600 mt-1">
                        {(() => {
                          const top = [...result.detections].sort(
                            (a: any, b: any) =>
                              (b.confidence ?? b.score ?? 0) -
                              (a.confidence ?? a.score ?? 0),
                          )[0];
                          const info =
                            labelInfo[top?.label] ?? labelInfo.default;
                          return `${info.explanation} Confidence ${(top.confidence ??
                            top.score ??
                            0
                          ).toFixed(2)}`;
                        })()}
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="grid sm:grid-cols-3 gap-4 mt-4">
                  <div className="rounded-xl border p-4 bg-white">
                    <div className="text-xs text-slate-500">
                      Suggested price
                    </div>
                    <div className="text-lg font-semibold mt-1">
                      ₹
                      {result?.predictions?.price_suggest ??
                        result?.predictions?.predicted_price ??
                        "—"}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      Original: ₹{form.original_price || "—"}
                    </div>
                  </div>

                  <div className="rounded-xl border p-4 bg-white">
                    <div className="text-xs text-slate-500">
                      Remaining useful life
                    </div>
                    <div className="text-lg font-semibold mt-1">
                      {result?.predictions?.rul_months ?? "—"} months
                    </div>
                  </div>

                  <div className="rounded-xl border p-4 bg-white">
                    <div className="text-xs text-slate-500">
                      Recommendation
                    </div>
                    <div className="text-lg font-semibold mt-1">
                      {result?.predictions?.decision ?? "—"}
                    </div>
                    <div className="text-xs text-slate-400 mt-2">
                      CO₂ saved:{" "}
                      {result?.predictions?.co2_saved_kg ?? "—"} kg
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {preview && (
            <div className="rounded-xl border bg-white p-4">
              <div className="text-xs text-slate-500 mb-2">
                Uploaded image (detections overlay)
              </div>
              <div className="relative w-full">
                <img
                  ref={imgRef}
                  src={preview}
                  alt="uploaded"
                  className="max-h-[360px] w-auto max-w-full block mx-auto"
                />
                <canvas
                  ref={canvasRef}
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    pointerEvents: "none",
                  }}
                />
              </div>
            </div>
          )}

          {map && (
            <div className="rounded-2xl overflow-hidden ring-1 ring-black/5 shadow-sm">
              <iframe
                title="map"
                src={map.src}
                className="w-full h-[180px]"
              />
              <a
                href={map.link}
                target="_blank"
                rel="noreferrer"
                className="block text-center text-sm py-2 text-sky-700"
              >
                Open in OpenStreetMap
              </a>
            </div>
          )}

          {Array.isArray(result?.nearby_partners) &&
          result.nearby_partners.length ? (
            <div className="card card-hover p-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-slate-900">
                  🏪 Nearby Repair / Recycling
                </h3>
                <span className="text-xs text-slate-500">
                  {result.nearby_partners.length} found
                </span>
              </div>
              <ul className="space-y-2">
                {result.nearby_partners.map((p: any, i: number) => (
                  <li
                    key={i}
                    className="rounded-lg border bg-white px-4 py-3 text-sm flex items-center justify-between"
                  >
                    <div>
                      <div className="flex items-center gap-3">
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs">
                          <span className="inline-block px-2 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                            {p.type || p.partner_type || 'partner'}
                          </span>
                        </div>
                      </div>
                      <div className="text-slate-500 text-xs mt-1 flex items-center gap-3">
                        <div>
                          {typeof p.distance_km === 'number' && !isNaN(p.distance_km)
                            ? `${p.distance_km.toFixed(2)} km`
                            : '—'}
                        </div>
                        <div>
                          {p.lat != null && p.lon != null
                            ? `${Number(p.lat).toFixed(4)}, ${Number(p.lon).toFixed(4)}`
                            : ''}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      {p.contact_phone ? (
                        <a
                          className="text-xs bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full"
                          href={`tel:${p.contact_phone.replace(/\s+/g, '')}`}
                        >
                          Call
                        </a>
                      ) : null}

                      <a
                        className="text-sky-700 text-xs underline"
                        href={`https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=16/${p.lat}/${p.lon}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
