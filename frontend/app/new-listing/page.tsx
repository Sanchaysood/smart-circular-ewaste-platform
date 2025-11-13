"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import axios from "axios";
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

export default function NewListingPage() {
  const [auth, setAuth] = useState<AuthState>({ token: null, name: null });
  const [isLoading, setIsLoading] = useState(false);
  const [tab, setTab] = useState<"login" | "register">("login");

  const [reg, setReg] = useState({ name: "", email: "", password: "" });
  const [login, setLogin] = useState({ email: "", password: "" });

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [form, setForm] = useState<any>({
    category: "mobile",
    brand: "",
    model: "",
    age_months: "",
    original_price: "",
    defect_count: 0,
    battery_health: "",
    storage_gb: "",
    ram_gb: "",
    screen_issues: 0,
    body_issues: 0,
    accessories: "",
    city: "Bengaluru",
    lat: "",
    lon: "",
  });
  const [result, setResult] = useState<any>(null);

  // ---------- auth ----------
  useEffect(() => {
    const t = localStorage.getItem("ew_token");
    const n = localStorage.getItem("ew_name");
    if (t) setAuth({ token: t, name: n });
  }, []);

  const saveAuth = (token: string, name: string) => {
    setAuth({ token, name });
    localStorage.setItem("ew_token", token);
    localStorage.setItem("ew_name", name);
  };

  const doRegister = async () => {
    try {
      if (!reg.name || !reg.email || !reg.password) {
        toast.error("Fill Name, Email, Password");
        return;
      }
      await axios.post(`${API}/auth/register`, reg);
      toast.success("Account created. Please login.");
      setTab("login");
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || err.message || "Register failed");
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
      saveAuth(res.data.access_token, res.data.name);
      toast.success("Signed in");
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Login failed");
    }
  };

  const logout = () => {
    setAuth({ token: null, name: null });
    localStorage.removeItem("ew_token");
    localStorage.removeItem("ew_name");
  };

  // ---------- UX helpers ----------
  const requiredKeys: Array<keyof typeof form> = [
    "category",
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

  const getLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      setForm((f: any) => ({
        ...f,
        lat: String(pos.coords.latitude.toFixed(6)),
        lon: String(pos.coords.longitude.toFixed(6)),
      }));
      toast.success("Location detected");
    });
  };

  const toNum = (v: any): number | undefined => {
    if (v === "" || v === null || v === undefined) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const submitListing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.token) return toast.error("Please login first");
    if (!file) return toast.error("Choose an image");
    if (missing.length) {
      return toast.error(
        `Please fill required fields: ${missing.join(", ").replaceAll("_", " ")}`
      );
    }

    const fd = new FormData();
    const entries: Record<string, any> = {
      category: form.category,
      brand: form.brand,
      model: form.model,
      age_months: toNum(form.age_months),
      original_price: toNum(form.original_price),
      defect_count: toNum(form.defect_count),
      battery_health: toNum(form.battery_health),
      storage_gb: toNum(form.storage_gb),
      ram_gb: toNum(form.ram_gb),
      screen_issues: toNum(form.screen_issues),
      body_issues: toNum(form.body_issues),
      accessories: form.accessories || "",
      city: form.city || "",
      lat: toNum(form.lat),
      lon: toNum(form.lon),
    };
    Object.entries(entries).forEach(([k, v]) => {
      if (v !== undefined && v !== "") fd.append(k, String(v));
    });
    fd.append("image", file);

    setIsLoading(true);
    try {
      const { data } = await axios.post(`${API}/listings/create`, fd, {
        headers: {
          Authorization: `Bearer ${auth.token}`,
          "Content-Type": "multipart/form-data",
        },
      });
      setResult(data);
      toast.success("Uploaded & predicted");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err.message || "Upload failed";
      if (err?.response?.status === 409) {
        toast.error("Duplicate listing detected");
      } else {
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

  // preview url cleanup
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  /* ------------------------- AUTH VIEW ------------------------- */
  if (!auth.token) {
    return (
      <div className="min-h-screen">
        <nav className="navbar">
          <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="E-Waste Logo" className="w-9 h-9 rounded-md" />
              <h1 className="text-2xl font-bold tracking-tight">
                <span className="brand-text">Smart Circular E-Waste Platform</span>
              </h1>
            </div>
            <Link
              href="/"
              className="rounded-xl border px-3 py-2 bg-white hover:bg-slate-100 text-sm"
            >
              ← Go to Dashboard
            </Link>
          </div>
        </nav>

        <main className="mx-auto max-w-4xl px-6 py-10">
          <div className="card card-hover p-8 space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                <button
                  onClick={() => setTab("login")}
                  className={cx("tab", tab === "login" ? "tab-active" : "tab-passive")}
                >
                  Login
                </button>
                <button
                  onClick={() => setTab("register")}
                  className={cx("tab", tab === "register" ? "tab-active" : "tab-passive")}
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
                  onChange={(e) => setLogin({ ...login, email: e.target.value })}
                  placeholder="you@example.com"
                  required
                />
                <TextField
                  label="Password"
                  type="password"
                  value={login.password}
                  onChange={(e) => setLogin({ ...login, password: e.target.value })}
                  placeholder="••••••••"
                  required
                />
                <div className="md:col-span-2">
                  <button onClick={doLogin} className="btn btn-primary w-full md:w-auto">
                    Login
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid md:grid-cols-3 gap-6">
                <TextField
                  label="Full name"
                  value={reg.name}
                  onChange={(e) => setReg({ ...reg, name: e.target.value })}
                  placeholder="Test User"
                  required
                />
                <TextField
                  label="Email"
                  value={reg.email}
                  onChange={(e) => setReg({ ...reg, email: e.target.value })}
                  placeholder="you@example.com"
                  required
                />
                <TextField
                  label="Password"
                  type="password"
                  value={reg.password}
                  onChange={(e) => setReg({ ...reg, password: e.target.value })}
                  placeholder="••••••••"
                  required
                />
                <div className="md:col-span-3">
                  <button onClick={doRegister} className="btn btn-primary w-full md:w-auto">
                    Create account
                  </button>
                </div>
              </div>
            )}
          </div>
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
            <img src="/logo.png" alt="E-Waste Logo" className="w-9 h-9 rounded-md" />
            <h1 className="text-xl md:text-2xl font-bold tracking-tight brand-text">
              Smart Circular E-Waste Platform
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="rounded-xl border px-3 py-2 bg-white hover:bg-slate-100 text-sm"
            >
              ← Go to Dashboard
            </Link>
            <span className="hidden sm:inline text-sm text-slate-700">Hi, {auth.name}</span>
            <button onClick={logout} className="btn bg-red-600 text-white px-3 py-2 hover:bg-red-700">
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-10 grid lg:grid-cols-2 gap-10">
        {/* LEFT: Form */}
        <section className="card card-hover p-8 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">📦 New Listing</h2>
            <span className="badge">Complete required fields</span>
          </div>
          <div className="divider" />

          <form onSubmit={submitListing} className="space-y-8">
            <div className="grid sm:grid-cols-2 gap-6">
              <TextField label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="mobile / laptop / tablet" required />
              <TextField label="Brand" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} placeholder="Apple / Samsung / Dell" required />
              <TextField label="Model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="iPhone 12 / Inspiron 15" required />
              <TextField label="Age (months)" type="number" value={form.age_months} onChange={(e) => setForm({ ...form, age_months: e.target.value })} placeholder="24" required />
              <TextField label="Original Price (₹)" type="number" value={form.original_price} onChange={(e) => setForm({ ...form, original_price: e.target.value })} placeholder="20000" required />
              <TextField label="Defect Count" type="number" value={form.defect_count} onChange={(e) => setForm({ ...form, defect_count: e.target.value })} placeholder="0" />
              <TextField label="Battery Health (%)" type="number" value={form.battery_health} onChange={(e) => setForm({ ...form, battery_health: e.target.value })} placeholder="80" />
              <TextField label="Storage (GB)" type="number" value={form.storage_gb} onChange={(e) => setForm({ ...form, storage_gb: e.target.value })} placeholder="64" />
              <TextField label="RAM (GB)" type="number" value={form.ram_gb} onChange={(e) => setForm({ ...form, ram_gb: e.target.value })} placeholder="4" />
              <TextField label="Screen Issues (0/1)" type="number" value={form.screen_issues} onChange={(e) => setForm({ ...form, screen_issues: e.target.value })} placeholder="0" />
              <TextField label="Body Issues (0/1)" type="number" value={form.body_issues} onChange={(e) => setForm({ ...form, body_issues: e.target.value })} placeholder="0" />
              <TextField label="Accessories" value={form.accessories} onChange={(e) => setForm({ ...form, accessories: e.target.value })} placeholder="charger, box" />
              <TextField label="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Bengaluru" />
              <TextField label="Latitude" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} placeholder="(auto)" readOnly />
              <TextField label="Longitude" value={form.lon} onChange={(e) => setForm({ ...form, lon: e.target.value })} placeholder="(auto)" readOnly />
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
                    }}
                  />
                  <span className="text-sm text-slate-600">
                    {file ? file.name : "Click to choose file"}
                  </span>
                </label>
                {preview && (
                  <img src={preview} alt="preview" className="mt-2 h-28 w-auto rounded-lg border" />
                )}
              </div>

              <div className="flex items-end gap-3">
                <button type="button" onClick={getLocation} className="btn btn-ghost">
                  Use my location
                </button>
                <button
                  disabled={!canSubmit}
                  className={cx(
                    "btn btn-primary",
                    (!canSubmit || isLoading) && "opacity-60 cursor-not-allowed"
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
            <h2 className="text-lg font-semibold text-slate-900">📈 Prediction</h2>
            {!result ? (
              <p className="text-sm text-slate-600">
                Submit a listing to see condition, price, RUL, repair/recycle, CO₂ saved, and nearby partners.
              </p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-6">
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="text-xs text-slate-500">Image Condition</div>
                  <div className="mt-1 text-lg font-semibold">{result.image_condition?.label}</div>
                  <div className="text-xs text-slate-500">
                    confidence: {result.image_condition?.confidence}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="text-xs text-slate-500">RUL</div>
                  <div className="mt-1 text-lg font-semibold">
                    {result.predictions?.rul_months} months
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="text-xs text-slate-500">Suggested Price</div>
                  <div className="mt-1 text-lg font-semibold">
                    ₹{result.predictions?.price_suggest}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="text-xs text-slate-500">Decision</div>
                  <div className="mt-1 text-lg font-semibold">
                    {result.predictions?.decision}
                  </div>
                  <div className="text-xs text-slate-500">
                    CO₂ saved: {result.predictions?.co2_saved_kg} kg
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Location badge */}
          {(form.lat || form.lon) && (
            <div className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="text-xs text-slate-500">Detected Location</div>
              <div className="mt-1 text-sm font-medium">
                {form.lat || "—"}, {form.lon || "—"}
              </div>
            </div>
          )}

          {/* Map (smaller height) */}
          {map && (
            <div className="rounded-2xl overflow-hidden ring-1 ring-black/5 shadow-sm">
              <iframe title="map" src={map.src} className="w-full h-[220px]" />
              <a
                href={map.link}
                target="_blank"
                className="block text-center text-sm py-2 text-sky-700"
              >
                Open in OpenStreetMap
              </a>
            </div>
          )}

          {/* Nearby partners */}
          {result?.nearby_partners?.length ? (
            <div className="card card-hover p-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-slate-900">
                  🏪 Nearby Repair/Recycling Partners
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
                      <div className="font-medium">{p.name}</div>
                      <div className="text-slate-500 text-xs">
                        {p.lat.toFixed(4)}, {p.lon.toFixed(4)}
                      </div>
                    </div>
                    <a
                      className="text-sky-700 text-xs underline"
                      href={`https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=16/${p.lat}/${p.lon}`}
                      target="_blank"
                    >
                      View map
                    </a>
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
