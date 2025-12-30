"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import axios from "axios";
import toast from "react-hot-toast";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";

type Listing = {
  id: number | string;
  created_at?: string;
  category?: string;
  brand?: string;
  model?: string;
  city?: string;
  image?: string;
  status?: string; // created / shared_with_partner / in_progress / completed / cancelled
  predictions?: {
    price_suggest?: number;
    rul_months?: number;
    decision?: string;
    co2_saved_kg?: number;
  };
  image_condition?: {
    label?: "Good" | "Fair" | "Poor" | string;
    confidence?: number;
  };
};

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
const COLORS = ["#10b981", "#3b82f6", "#f59e0b"];

function StatCard({
  title,
  value,
  foot,
}: {
  title: string;
  value: string | number;
  foot?: string;
}) {
  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm hover:shadow transition">
      <div className="text-xs text-slate-500">{title}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      {foot ? <div className="text-xs text-slate-500 mt-1">{foot}</div> : null}
    </div>
  );
}

export default function Dashboard() {
  const [auth, setAuth] = useState<{ token: string | null; name: string | null }>({
    token: null,
    name: null,
  });
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  // ---------------------- FETCH LISTINGS ----------------------
  useEffect(() => {
    const token = localStorage.getItem("ew_token");
    const name = localStorage.getItem("ew_name");
    setAuth({ token, name });

    if (!token) {
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const res = await axios.get(`${API}/listings/mine`, {
          headers: { Authorization: `Bearer ${token}` },
          validateStatus: () => true,
        });

        if (res.status === 401) {
          localStorage.removeItem("ew_token");
          localStorage.removeItem("ew_name");
          toast.error("Session expired, please sign in.");
          window.location.href = "/new-listing";
          return;
        }

        const data = Array.isArray(res.data) ? res.data : res.data?.items ?? [];
        setListings(data);
      } catch {
        toast.error("Could not load your listings.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const logout = () => {
    localStorage.removeItem("ew_token");
    localStorage.removeItem("ew_name");
    window.location.href = "/new-listing";
  };

  // ---------------------- METRICS ----------------------
  const {
    count,
    avgPrice,
    avgRul,
    co2Total,
    goodPct,
    fairPct,
    poorPct,
    dailySeries,
    pieSeries,
  } = useMemo(() => {
    const count = listings.length;
    let priceSum = 0,
      rulSum = 0,
      co2 = 0,
      good = 0,
      fair = 0,
      poor = 0;
    const byDay: Record<string, number> = {};

    for (const it of listings) {
      const p = it.predictions;
      if (p?.price_suggest) priceSum += p.price_suggest;
      if (p?.rul_months) rulSum += p.rul_months;
      if (p?.co2_saved_kg) co2 += p.co2_saved_kg;

      const c = it.image_condition?.label;
      if (c === "Good") good++;
      else if (c === "Fair") fair++;
      else if (c === "Poor") poor++;

      const day = (it.created_at || "").slice(0, 10);
      if (day) byDay[day] = (byDay[day] || 0) + 1;
    }

    const totalCond = good + fair + poor || 1;
    const avgPrice = count ? Math.round(priceSum / count) : 0;
    const avgRul = count ? Math.round(rulSum / count) : 0;
    const goodPct = Math.round((good / totalCond) * 100);
    const fairPct = Math.round((fair / totalCond) * 100);
    const poorPct = Math.round((poor / totalCond) * 100);

    const dailySeries = Object.entries(byDay)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, n]) => ({ date, listings: n as number }));

    const pieSeries = [
      { name: "Good", value: good },
      { name: "Fair", value: fair },
      { name: "Poor", value: poor },
    ];

    return {
      count,
      avgPrice,
      avgRul,
      co2Total: Math.round(co2),
      goodPct,
      fairPct,
      poorPct,
      dailySeries,
      pieSeries,
    };
  }, [listings]);

  // ---------------------- LOGIN SCREEN ----------------------
  if (!auth.token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-sky-50">
        <div className="rounded-3xl border bg-white/80 backdrop-blur-md p-10 text-center shadow-lg max-w-md w-full">
          <img src="/logo.png" alt="logo" className="mx-auto w-16 mb-5" />
          <h1 className="text-2xl font-bold tracking-tight mb-2 text-slate-800">
            Smart Circular E-Waste Platform
          </h1>
          <p className="text-slate-600 mb-6 text-sm">
            Secure access to your personalized analytics and listings.
          </p>
          <Link
            href="/new-listing"
            className="inline-block bg-sky-600 hover:bg-sky-700 text-white px-6 py-2 rounded-xl font-medium transition"
          >
            Sign In to Continue
          </Link>
        </div>
      </div>
    );
  }

  // ---------------------- DASHBOARD ----------------------
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="navbar">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="E-Waste Logo" className="w-9 h-9 rounded-md" />
            <h1 className="text-xl md:text-2xl font-bold tracking-tight brand-text">
              Smart Circular E-Waste Platform
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline text-sm text-slate-700">Hi, {auth.name}</span>
            <Link
              href="/new-listing"
              className="rounded-xl border px-3 py-2 bg-white hover:bg-slate-100 text-sm"
            >
              + New Listing
            </Link>
            <button
              onClick={logout}
              className="btn bg-red-600 text-white px-3 py-2 hover:bg-red-700"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8 space-y-8">
        {/* ===== METRICS ===== */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard title="Total Listings" value={count} />
          <StatCard title="Avg. Suggested Price (₹)" value={avgPrice} />
          <StatCard title="Avg. RUL (months)" value={avgRul} />
          <StatCard title="Total CO₂ Saved (kg)" value={co2Total} />
        </div>

        {/* ===== CHARTS ===== */}
        <div className="grid lg:grid-cols-2 gap-6">
          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <h3 className="font-semibold mb-4 text-slate-800">📈 Listings over Time</h3>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={dailySeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Area type="monotone" dataKey="listings" stroke="#3b82f6" fill="#bfdbfe" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <h3 className="font-semibold mb-4 text-slate-800">📊 Condition Distribution</h3>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={pieSeries} dataKey="value" nameKey="name" outerRadius={80} label>
                  {pieSeries.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="text-xs text-slate-500 mt-3">
              Good: {goodPct}% • Fair: {fairPct}% • Poor: {poorPct}%
            </div>
          </div>
        </div>

        {/* ===== LISTINGS TABLE ===== */}
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <h3 className="font-semibold mb-4 text-slate-800">🗂️ My Listings</h3>
          {loading ? (
            <p className="text-sm text-slate-600">Loading...</p>
          ) : listings.length === 0 ? (
            <p className="text-sm text-slate-600">
              You have no listings yet. Create one to start tracking predictions.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-slate-600">
                    <th className="py-2 pr-4">Image</th>
                    <th className="py-2 pr-4">Device</th>
                    <th className="py-2 pr-4">Category</th>
                    <th className="py-2 pr-4">Condition</th>
                    <th className="py-2 pr-4">Price (₹)</th>
                    <th className="py-2 pr-4">RUL</th>
                    <th className="py-2 pr-4">Decision</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Created</th>
                    <th className="py-2 pr-4">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {listings.map((l) => (
                    <tr key={l.id} className="border-b hover:bg-slate-50 align-top">
                      <td className="py-2 pr-4">
                        {l.image ? (
                          <img
                            src={`${API}/uploads/${l.image}`}
                            className="h-10 w-10 rounded object-cover border"
                            alt="thumb"
                          />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        {[l.brand, l.model].filter(Boolean).join(" ")}
                      </td>
                      <td className="py-2 pr-4">{l.category}</td>

                      {/* ✅ FIXED: use image_condition.label so it shows Good / Fair / Poor */}
                      <td className="py-2 pr-4">
                        {l.image_condition?.label ?? "—"}
                      </td>

                      <td className="py-2 pr-4">
                        {l.predictions?.price_suggest ?? "—"}
                      </td>
                      <td className="py-2 pr-4">
                        {l.predictions?.rul_months ?? "—"} mo
                      </td>
                      <td className="py-2 pr-4">
                        {l.predictions?.decision ?? "—"}
                      </td>
                      <td className="py-2 pr-4">
                        {l.status ?? "created"}
                      </td>
                      <td className="py-2 pr-4">
                        {l.created_at
                          ? new Date(l.created_at).toLocaleDateString()
                          : "—"}
                      </td>
                      <td className="py-2 pr-4">
                        <button
                          className="text-red-600 hover:underline text-xs"
                          onClick={async () => {
                            const token = localStorage.getItem("ew_token");
                            if (!token) return;
                            if (!confirm("Delete this listing?")) return;
                            try {
                              await axios.delete(`${API}/listings/${l.id}`, {
                                headers: { Authorization: `Bearer ${token}` },
                              });
                              setListings((prev) => prev.filter((x) => x.id !== l.id));
                              toast.success("Listing deleted");
                            } catch (e: any) {
                              const msg = e?.response?.data?.detail || "Delete failed";
                              toast.error(msg);
                            }
                          }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
