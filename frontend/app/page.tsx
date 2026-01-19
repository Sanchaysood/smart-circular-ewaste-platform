"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  status?: string;
  intent?: string;
  predicted_price?: number;
  predicted_decision?: string;
  predicted_rul_months?: number;
  co2_saved_kg?: number;
  predictions?: {
    price_suggest?: number;
    price_rupees?: number;
    rul_months?: number;
    decision?: string;
    co2_saved_kg?: number;
  };
  image_condition?: {
    label?: "Good" | "Fair" | "Poor" | string;
    confidence?: number;
  };
  offer?: {
    id: number;
    partner_name: string;
    partner_city: string | null;
    partner_phone: string | null;
    partner_kyc_status: string | null;
    offer_price: number;
    message: string;
    status: string;
  } | null;
  message_count?: number;
  final_price?: number | null;
};

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
const COLORS = ["#22C55E", "#2BAE9E", "#F59E0B"];

function StatCard({
  title,
  value,
  foot,
  icon,
}: {
  title: string;
  value: string | number;
  foot?: string;
  icon?: string;
}) {
  return (
    <div className="eco-card group">
      <div className="flex items-start justify-between mb-3">
        <div className="text-sm font-medium text-slate-600">{title}</div>
        {icon && (
          <div className="text-2xl opacity-50 group-hover:opacity-100 transition-opacity">
            {icon}
          </div>
        )}
      </div>
      <div className="text-3xl font-bold text-gradient-eco mb-1">{value}</div>
      {foot && <div className="text-xs text-slate-500">{foot}</div>}
    </div>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const [auth, setAuth] = useState<{ token: string | null; name: string | null }>({
    token: null,
    name: null,
  });
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);

  // Messaging state
  const [chatModal, setChatModal] = useState<{ open: boolean; listingId: number | null }>({
    open: false,
    listingId: null,
  });
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);

  // ---------------------- FETCH LISTINGS ----------------------
  useEffect(() => {
    const token = localStorage.getItem("ew_token");
    const name = localStorage.getItem("ew_name");
    setAuth({ token, name });
    setAuthChecked(true);

    if (!token) {
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const res = await axios.get(`${API}/users/me/listings`, {
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

        const data = res.data?.listings ?? [];
        setListings(data);
      } catch {
        toast.error("Could not load your listings.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Don't redirect if not logged in - show login prompt instead
  useEffect(() => {
    if (!authChecked) return;
  }, [authChecked, auth.token, router]);

  const logout = () => {
    localStorage.removeItem("ew_token");
    localStorage.removeItem("ew_name");
    window.location.href = "/new-listing";
  };

  // ---------------------- MESSAGING FUNCTIONS ----------------------
  const openChat = async (listing: Listing) => {
    setChatModal({ open: true, listingId: Number(listing.id) });
    setMessages([]);
    await fetchMessages(Number(listing.id));
  };

  const closeChat = () => {
    setChatModal({ open: false, listingId: null });
    setMessages([]);
    setNewMessage("");
  };

  const fetchMessages = async (listingId: number) => {
    if (!auth.token) return;
    try {
      const res = await axios.get(`${API}/listings/${listingId}/messages`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (res.status === 200 && res.data.messages) {
        setMessages(res.data.messages);
      }
    } catch (e) {
      console.error("Failed to fetch messages:", e);
    }
  };

  const sendMessage = async () => {
    if (!chatModal.listingId || !newMessage.trim() || !auth.token) return;

    setSendingMessage(true);
    try {
      const res = await axios.post(
        `${API}/listings/${chatModal.listingId}/messages`,
        { message: newMessage },
        { headers: { Authorization: `Bearer ${auth.token}` } }
      );

      if (res.status === 200) {
        setNewMessage("");
        await fetchMessages(chatModal.listingId);
      }
    } catch (e) {
      toast.error("Failed to send message");
      console.error("Send message error:", e);
    } finally {
      setSendingMessage(false);
    }
  };

  const acceptOffer = async (listingId: number) => {
    if (!confirm("Accept this offer? This action cannot be undone.")) return;
    if (!auth.token) return;

    try {
      const res = await axios.post(`${API}/listings/${listingId}/offer/accept`, {}, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });

      if (res.status === 200) {
        toast.success("Offer accepted! The partner will contact you soon.");
        // Reload listings
        const res2 = await axios.get(`${API}/users/me/listings`, {
          headers: { Authorization: `Bearer ${auth.token}` },
        });
        setListings(res2.data?.listings ?? []);
      } else {
        const data = res.data;
        toast.error(data.detail || "Failed to accept offer");
      }
    } catch (error) {
      console.error("Failed to accept offer:", error);
      toast.error("Error accepting offer");
    }
  };

  const rejectOffer = async (listingId: number) => {
    if (!confirm("Reject this offer? The listing will return to available status.")) return;
    if (!auth.token) return;

    try {
      const res = await axios.post(`${API}/listings/${listingId}/offer/reject`, {}, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });

      if (res.status === 200) {
        toast.success("Offer rejected. You can receive new offers.");
        // Reload listings
        const res2 = await axios.get(`${API}/users/me/listings`, {
          headers: { Authorization: `Bearer ${auth.token}` },
        });
        setListings(res2.data?.listings ?? []);
      } else {
        const data = res.data;
        toast.error(data.detail || "Failed to reject offer");
      }
    } catch (error) {
      console.error("Failed to reject offer:", error);
      toast.error("Error rejecting offer");
    }
  };

  // ---------------------- METRICS ----------------------
  const {
    count,
    totalValue,
    completedDeals,
    co2Total,
    goodPct,
    fairPct,
    poorPct,
    dailySeries,
    pieSeries,
  } = useMemo(() => {
    const count = listings.length;
    let totalValue = 0,
      completedDeals = 0,
      co2 = 0,
      good = 0,
      fair = 0,
      poor = 0;
    const byDay: Record<string, number> = {};

    for (const it of listings) {
      // Use top-level fields from API response
      if (it.predicted_price) totalValue += it.predicted_price;
      if (it.co2_saved_kg) co2 += it.co2_saved_kg;
      if (it.status === "completed" || it.status === "accepted") completedDeals++;

      const c = it.image_condition?.label;
      if (c === "Good") good++;
      else if (c === "Fair") fair++;
      else if (c === "Poor") poor++;

      const day = (it.created_at || "").slice(0, 10);
      if (day) byDay[day] = (byDay[day] || 0) + 1;
    }

    const totalCond = good + fair + poor || 1;
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
      totalValue: Math.round(totalValue),
      completedDeals,
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
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="eco-card max-w-md w-full text-center space-y-6">
          <img src="/logo.png" alt="logo" className="mx-auto w-16 h-16 rounded-xl object-contain" />
          <div>
            <h1 className="text-3xl font-bold text-gradient-eco mb-2">
              Smart Circular E-Waste Platform
            </h1>
            <p className="text-slate-600 text-sm">
              Give your devices a second life. Track impact, optimize value, drive sustainability.
            </p>
          </div>
          <button
            type="button"
            className="eco-btn-primary w-full text-center"
            onClick={() => {
              try {
                router.push("/new-listing");
              } catch {
                if (typeof window !== "undefined") {
                  window.location.href = "/new-listing";
                }
              }
            }}
          >
            Sign In to Continue →
          </button>
        </div>
      </div>
    );
  }

  // ---------------------- DASHBOARD ----------------------
  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/70 backdrop-blur-xl border-b border-slate-200/60 shadow-sm">
        <div className="container-eco py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="E-Waste Logo" className="w-10 h-10 rounded-xl object-contain" />
            <h1 className="text-lg md:text-xl font-bold text-gradient-eco">
              Smart Circular E-Waste Platform
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline text-sm text-slate-700 font-medium">
              Hi, {auth.name}
            </span>
            <Link
              href="/new-listing"
              className="eco-btn-primary text-sm"
            >
              + New Listing
            </Link>
            <button
              onClick={logout}
              className="eco-btn-ghost text-sm text-red-600 hover:bg-red-50"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="container-eco py-8 space-y-10">
        {/* ===== HERO SECTION ===== */}
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[rgb(var(--eco-primary))] via-[rgb(var(--eco-secondary))] to-[rgb(var(--eco-primary))] p-8 md:p-12 text-white shadow-xl">
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-0 right-0 w-64 h-64 rounded-full bg-white blur-3xl"></div>
            <div className="absolute bottom-0 left-0 w-48 h-48 rounded-full bg-white blur-3xl"></div>
          </div>
          
          <div className="relative z-10 grid lg:grid-cols-2 gap-8 items-center">
            {/* Left Side - Content */}
            <div>
              <h2 className="text-3xl md:text-5xl font-bold mb-4 leading-tight">
                Turn E-Waste Into Impact
              </h2>
              <p className="text-white/90 text-lg mb-8">
                Track sustainability metrics, optimize device value, and make data-driven decisions powered by AI insights.
              </p>
              
              {/* Inline Metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/20">
                  <div className="text-2xl md:text-3xl font-bold">{count}</div>
                  <div className="text-sm text-white/80 mt-1">Devices Listed</div>
                </div>
                <div className="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/20">
                  <div className="text-xl md:text-2xl font-bold">
                    ₹{(totalValue / 1000).toFixed(1)}K
                  </div>
                  <div className="text-xs text-white/80 mt-1">Marketplace Value</div>
                </div>
                <div className="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/20">
                  <div className="flex items-baseline gap-2">
                    <div className="text-2xl md:text-3xl font-bold">{completedDeals}</div>
                    <span className="text-lg">✅</span>
                  </div>
                  <div className="text-sm text-white/80 mt-1">Completed Deals</div>
                </div>
                <div className="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/20">
                  <div className="flex items-baseline gap-2">
                    <div className="text-2xl md:text-3xl font-bold">{co2Total}kg</div>
                    <span className="text-lg">🌱</span>
                  </div>
                  <div className="text-sm text-white/80 mt-1">CO₂ Saved</div>
                </div>
              </div>
            </div>

            {/* Right Side - Illustration */}
            <div className="hidden lg:flex items-center justify-center">
              <div className="relative">
                <div className="absolute inset-0 bg-white/10 rounded-full blur-3xl"></div>
                <img 
                  src="/hero-illustration.png" 
                  alt="Circular Economy" 
                  className="relative z-10 w-full max-w-md drop-shadow-2xl"
                />
              </div>
            </div>
          </div>
        </section>

        {/* ===== INSIGHTS SECTION ===== */}
        <section className="space-y-6">
          <div>
            <h3 className="text-2xl font-bold text-slate-900">Analytics & Trends</h3>
            <p className="text-sm text-slate-600 mt-1">Monitor your circular economy journey</p>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* Key Metrics - Takes 2 columns */}
            <div className="lg:col-span-2 grid md:grid-cols-2 gap-4">
              {/* Devices by Status */}
              <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-50 to-white p-6 border border-slate-200/60 shadow-sm">
                <div className="absolute top-0 right-0 w-24 h-24 bg-[rgb(var(--eco-primary))]/5 rounded-full blur-3xl"></div>
                <div className="relative z-10">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-2 h-2 rounded-full bg-[rgb(var(--eco-primary))]"></div>
                    <h4 className="font-semibold text-slate-800">Active Listings</h4>
                  </div>
                  <div className="text-4xl font-bold text-[rgb(var(--eco-primary))]">{listings.filter(l => l.status === 'created' || l.status === 'offer_sent').length}</div>
                  <p className="text-sm text-slate-500 mt-2">Devices waiting for partners</p>
                </div>
              </div>

              {/* Pending Offers */}
              <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-amber-50 to-white p-6 border border-amber-200/60 shadow-sm">
                <div className="absolute top-0 right-0 w-24 h-24 bg-amber-400/10 rounded-full blur-3xl"></div>
                <div className="relative z-10">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                    <h4 className="font-semibold text-slate-800">Pending Offers</h4>
                  </div>
                  <div className="text-4xl font-bold text-amber-600">{listings.filter(l => l.offer && l.offer.status === 'pending').length}</div>
                  <p className="text-sm text-slate-500 mt-2">Awaiting your decision</p>
                </div>
              </div>

              {/* Total Messages */}
              <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-blue-50 to-white p-6 border border-blue-200/60 shadow-sm">
                <div className="absolute top-0 right-0 w-24 h-24 bg-blue-400/10 rounded-full blur-3xl"></div>
                <div className="relative z-10">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                    <h4 className="font-semibold text-slate-800">Messages</h4>
                  </div>
                  <div className="text-4xl font-bold text-blue-600">{listings.reduce((sum, l) => sum + (l.message_count || 0), 0)}</div>
                  <p className="text-sm text-slate-500 mt-2">Partner conversations</p>
                </div>
              </div>

              {/* Average Value */}
              <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-50 to-white p-6 border border-emerald-200/60 shadow-sm">
                <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-400/10 rounded-full blur-3xl"></div>
                <div className="relative z-10">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                    <h4 className="font-semibold text-slate-800">Avg. Device Value</h4>
                  </div>
                  <div className="text-4xl font-bold text-emerald-600">₹{count ? Math.round(totalValue / count).toLocaleString() : 0}</div>
                  <p className="text-sm text-slate-500 mt-2">Per device estimate</p>
                </div>
              </div>
            </div>

            {/* Condition Stats - Redesigned as stat cards instead of pie */}
            <div className="space-y-4">
              <div className="rounded-2xl bg-gradient-to-br from-emerald-50 to-white p-6 border border-emerald-200/60">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-emerald-700">Good Condition</span>
                  <span className="text-2xl">✨</span>
                </div>
                <div className="text-3xl font-bold text-emerald-600">{goodPct}%</div>
                <p className="text-xs text-emerald-600/80 mt-1">Ready for resale</p>
              </div>

              <div className="rounded-2xl bg-gradient-to-br from-blue-50 to-white p-6 border border-blue-200/60">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-blue-700">Fair Condition</span>
                  <span className="text-2xl">🔧</span>
                </div>
                <div className="text-3xl font-bold text-blue-600">{fairPct}%</div>
                <p className="text-xs text-blue-600/80 mt-1">Minor refurbishing needed</p>
              </div>

              <div className="rounded-2xl bg-gradient-to-br from-amber-50 to-white p-6 border border-amber-200/60">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-amber-700">Poor Condition</span>
                  <span className="text-2xl">♻️</span>
                </div>
                <div className="text-3xl font-bold text-amber-600">{poorPct}%</div>
                <p className="text-xs text-amber-600/80 mt-1">Recycling recommended</p>
              </div>
            </div>
          </div>
        </section>

        {/* ===== LISTINGS TABLE ===== */}
        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-2xl font-bold text-slate-900">Your Devices</h3>
              <p className="text-sm text-slate-600 mt-1">Manage your circular economy listings</p>
            </div>
            <Link href="/new-listing" className="eco-btn-primary text-sm">
              + Add Device
            </Link>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-shimmer h-8 w-32 rounded-lg"></div>
            </div>
          ) : listings.length === 0 ? (
            <div className="eco-card">
              <div className="eco-empty-state">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-50 flex items-center justify-center mb-4">
                  <span className="text-4xl">📦</span>
                </div>
                <h4 className="text-xl font-bold text-slate-900 mb-2">No devices listed yet</h4>
                <p className="text-slate-600 text-sm max-w-md mb-6">
                  Start your circular economy journey by listing your first device. Get instant AI predictions and track environmental impact.
                </p>
                <Link href="/new-listing" className="eco-btn-primary">
                  List Your First Device
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {listings.map((l) => (
                <div 
                  key={l.id} 
                  className="group relative overflow-hidden rounded-2xl bg-white border border-slate-200/60 hover:border-[rgb(var(--eco-primary))]/30 hover:shadow-lg transition-all duration-300"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-[rgb(var(--eco-primary))]/0 to-[rgb(var(--eco-primary))]/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                  
                  <div className="relative p-5 flex items-start gap-5">
                    {/* Image */}
                    <div className="flex-shrink-0">
                      {l.image ? (
                        <img
                          src={`${API}/uploads/${l.image}`}
                          className="w-24 h-24 rounded-xl object-cover border-2 border-slate-100 group-hover:border-[rgb(var(--eco-primary))]/20 transition-colors shadow-sm"
                          alt="device"
                        />
                      ) : (
                        <div className="w-24 h-24 rounded-xl bg-gradient-to-br from-slate-100 to-slate-50 flex items-center justify-center text-slate-400 text-3xl border-2 border-slate-100">
                          📷
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div>
                          <h4 className="text-lg font-semibold text-slate-900 mb-1">
                            {[l.brand, l.model].filter(Boolean).join(" ") || "Unnamed Device"}
                          </h4>
                          <div className="flex items-center gap-2 text-sm text-slate-600">
                            <span>{l.category || "—"}</span>
                            {l.city && (
                              <>
                                <span className="text-slate-300">•</span>
                                <span>📍 {l.city}</span>
                              </>
                            )}
                          </div>
                        </div>
                        
                        {/* Status Badge */}
                        <span className="eco-badge eco-badge-neutral capitalize flex-shrink-0">
                          {(l.status || "created").replace(/_/g, " ")}
                        </span>
                      </div>

                      {/* Metrics Grid */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                        <div className="rounded-xl bg-gradient-to-br from-slate-50 to-white p-3 border border-slate-100">
                          <div className="text-xs text-slate-500 mb-1">Condition</div>
                          {l.image_condition?.label ? (
                            <span className={`inline-flex eco-badge text-xs ${
                              l.image_condition.label === "Good" ? "eco-badge-success" :
                              l.image_condition.label === "Fair" ? "eco-badge-info" :
                              "eco-badge-warning"
                            }`}>
                              {l.image_condition.label}
                            </span>
                          ) : (
                            <span className="text-sm text-slate-400">—</span>
                          )}
                        </div>

                        <div className="rounded-xl bg-gradient-to-br from-emerald-50/50 to-white p-3 border border-emerald-100/50">
                          <div className="text-xs text-slate-500 mb-1">Suggested Price</div>
                          <div className="text-base font-bold text-[rgb(var(--eco-primary))]">
                            {l.predicted_price ? `₹${Math.round(l.predicted_price)}` : "—"}
                          </div>
                        </div>

                        <div className="rounded-xl bg-gradient-to-br from-blue-50/50 to-white p-3 border border-blue-100/50">
                          <div className="text-xs text-slate-500 mb-1">Remaining Life</div>
                          <div className="text-base font-bold text-blue-600">
                            {l.predicted_rul_months ? `${l.predicted_rul_months} mo` : "—"}
                          </div>
                        </div>

                        <div className="rounded-xl bg-gradient-to-br from-amber-50/50 to-white p-3 border border-amber-100/50">
                          <div className="text-xs text-slate-500 mb-1">Decision</div>
                          <div className="text-sm font-semibold text-amber-700 capitalize">
                            {l.predicted_decision || "—"}
                          </div>
                        </div>
                      </div>

                      {/* Offer Section */}
                      {l.offer && l.offer.status === "pending" && (
                        <div className="bg-amber-50 border-2 border-amber-200 rounded-lg p-3 mb-3">
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="font-bold text-amber-900 mb-1">💰 Offer from {l.offer.partner_name}</div>
                              {l.offer.partner_kyc_status === "verified" && (
                                <span className="eco-badge eco-badge-success text-xs">✓ Verified Partner</span>
                              )}
                              <div className="text-sm text-amber-800 mt-2">
                                <div><strong>Price:</strong> ₹{l.offer.offer_price}</div>
                                {l.offer.partner_city && <div><strong>City:</strong> {l.offer.partner_city}</div>}
                                {l.offer.partner_phone && <div><strong>Phone:</strong> {l.offer.partner_phone}</div>}
                                {l.offer.message && <div className="mt-1"><strong>Message:</strong> {l.offer.message}</div>}
                              </div>
                            </div>
                            <div className="flex gap-2 ml-2">
                              <button
                                onClick={() => acceptOffer(Number(l.id))}
                                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-sm whitespace-nowrap"
                              >
                                ✓ Accept
                              </button>
                              <button
                                onClick={() => rejectOffer(Number(l.id))}
                                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors shadow-sm whitespace-nowrap"
                              >
                                ✗ Reject
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {l.offer && l.offer.status === "accepted" && (
                        <div className="bg-emerald-50 border-2 border-emerald-200 rounded-lg p-3 mb-3">
                          <div className="font-bold text-emerald-900">✓ Deal Accepted with {l.offer.partner_name}</div>
                          <div className="text-sm text-emerald-800">Final Price: ₹{l.final_price}</div>
                          {l.offer.partner_phone && (
                            <div className="text-sm text-emerald-800">Contact: {l.offer.partner_phone}</div>
                          )}
                        </div>
                      )}

                      {/* Footer */}
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <div className="flex items-center gap-3">
                          <span>
                            Listed {l.created_at ? new Date(l.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : "—"}
                          </span>
                          <button
                            onClick={() => openChat(l)}
                            className="eco-btn-secondary text-xs px-3 py-1"
                          >
                            💬 Messages {l.message_count ? `(${l.message_count})` : ""}
                          </button>
                        </div>
                        <button
                          className="text-red-600 hover:text-red-700 font-medium hover:underline transition-colors"
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
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* Chat Modal */}
      {chatModal.open && chatModal.listingId && (() => {
        const currentListing = listings.find(l => l.id === chatModal.listingId);
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="eco-card max-w-2xl w-full h-[600px] flex flex-col">
            <div className="flex items-center justify-between mb-4 pb-4 border-b border-slate-200 flex-shrink-0">
              <div>
                <h3 className="text-xl font-bold bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent flex items-center gap-2">
                  💬 Conversation
                </h3>
                {currentListing && (
                  <p className="text-sm text-slate-600 mt-1">
                    {currentListing.brand} {currentListing.model}
                  </p>
                )}
              </div>
              <button onClick={closeChat} className="text-slate-400 hover:text-slate-600 text-2xl transition-colors">
                ✕
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto mb-4 space-y-3 min-h-0">
              {messages.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <div className="text-4xl mb-2">💬</div>
                  <p>No messages yet. Start a conversation!</p>
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.sender_role === "customer" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[70%] rounded-lg p-3 ${
                        msg.sender_role === "customer"
                          ? "bg-gradient-to-br from-emerald-500 to-teal-600 text-white"
                          : "bg-slate-100 text-slate-800"
                      }`}
                    >
                      <div className="text-xs opacity-75 mb-1">
                        {msg.sender_name} • {new Date(msg.created_at).toLocaleString()}
                      </div>
                      <div className="text-sm">{msg.message}</div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Input */}
            <div className="flex gap-2 pt-4 border-t border-slate-200 flex-shrink-0">
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && sendMessage()}
                placeholder="Type your message..."
                className="eco-input flex-1"
                disabled={sendingMessage}
              />
              <button
                onClick={sendMessage}
                disabled={sendingMessage || !newMessage.trim()}
                className="eco-btn-primary"
              >
                {sendingMessage ? "..." : "Send"}
              </button>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
