"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import toast from "react-hot-toast";
import Image from "next/image";

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Smart Circular E‑Waste";

type Partner = {
  id: number;
  name: string | null;
  type: string | null;
  city: string | null;
  contact_phone: string | null;
  kyc_status?: string | null;
};

type UserItem = {
  id: number;
  name?: string | null;
  email: string;
  role?: string | null;
  created_at?: string | null;
};

type Listing = {
  id: number;
  user_email: string | null;
  status: string;
  intent: string | null;
  image: string | null;
  payload: Record<string, any>;
  created_at: string | null;
};

export default function AdminDashboardPage() {
  const router = useRouter();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [tab, setTab] = useState<"partners" | "users" | "listings">("partners");
  const [listingStatus, setListingStatus] = useState<"all" | "created" | "hidden" | "removed">("all");

  const token = typeof window !== "undefined" ? localStorage.getItem("ew_token") : null;

  useEffect(() => {
    // simple guard: if no token, redirect away
    if (typeof window !== "undefined" && !localStorage.getItem("ew_token")) {
      router.replace("/");
      return;
    }
    fetchPartners();
    // do not auto-fetch users/listings until tab selected
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab === "users") fetchUsers();
    else if (tab === "listings") fetchListings(listingStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (tab === "listings") fetchListings(listingStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingStatus]);

  const fetchPartners = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/admin/partners`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      // Backend returns { items: [...] }. Normalize to an array of partner objects.
      const data = res.data;
      let rows: any[] = [];
      if (Array.isArray(data)) rows = data;
      else if (Array.isArray(data?.items)) rows = data.items;
      else if (Array.isArray(data?.partners)) rows = data.partners;
      else rows = [];

      // Normalize fields to the Partner type used in the UI
      const normalized = rows.map((r: any) => ({
        id: r.id,
        name: r.org_name || r.name || null,
        type: r.partner_type || r.type || null,
        city: r.city || null,
        contact_phone: r.contact_phone || null,
        kyc_status: r.kyc_status || null,
      }));
      setPartners(normalized);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Failed to load partners");
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/admin/users`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = res.data;
      let rows: any[] = [];
      if (Array.isArray(data)) rows = data;
      else if (Array.isArray(data?.items)) rows = data.items;
      else rows = [];
      const normalized = rows.map((r: any) => ({
        id: r.id,
        name: r.name || null,
        email: r.email || "",
        role: r.role || "customer",
        created_at: r.created_at || null,
      }));
      setUsers(normalized);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  const fetchListings = async (status: "all" | "created" | "hidden" | "removed" = "all") => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/admin/listings`, {
        params: status !== "all" ? { status } : {},
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = res.data;
      let rows: any[] = [];
      if (Array.isArray(data)) rows = data;
      else if (Array.isArray(data?.items)) rows = data.items;
      else rows = [];
      const normalized = rows.map((r: any) => ({
        id: r.id,
        user_email: r.user_email || null,
        status: r.status || "created",
        intent: r.intent || null,
        image: r.image || null,
        payload: r.payload || {},
        created_at: r.created_at || null,
      }));
      setListings(normalized);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Failed to load listings");
    } finally {
      setLoading(false);
    }
  };

  const deleteListing = async (id: number) => {
    if (!confirm("Are you sure you want to delete this listing?")) return;
    try {
      await axios.delete(`${API}/admin/listings/${id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      toast.success("Listing deleted");
      setListings((prev) => prev.filter((l) => l.id !== id));
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Failed to delete listing");
    }
  };

  const hideListing = async (id: number) => {
    try {
      await axios.post(`${API}/admin/listings/${id}/hide`, null, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      toast.success("Listing hidden");
      setListings((prev) =>
        prev.map((l) => (l.id === id ? { ...l, status: "hidden" } : l))
      );
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Failed to hide listing");
    }
  };

  const restoreListing = async (id: number) => {
    try {
      await axios.post(`${API}/admin/listings/${id}/restore`, null, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      toast.success("Listing restored");
      setListings((prev) =>
        prev.map((l) => (l.id === id ? { ...l, status: "created" } : l))
      );
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Failed to restore listing");
    }
  };

  const doAction = async (id: number, action: "verify" | "reject") => {
    try {
      await axios.post(`${API}/admin/partners/${id}/${action}`, null, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      toast.success(`Partner ${action}ed`);
      setPartners((p) => p.map((x) => (x.id === id ? { ...x, kyc_status: action === "verify" ? "verified" : "rejected" } : x)));
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || `Failed to ${action}`);
    }
  };

  const logout = () => {
    try {
      if (typeof window !== "undefined") {
        localStorage.removeItem("ew_token");
      }
    } catch {}
    router.replace("/");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#ECFDF5] via-[#E6F7F3] to-[#F5F7F6] relative">
      {/* Ambient gradient orbs */}
      <div className="fixed top-0 left-0 w-96 h-96 bg-gradient-to-br from-[rgb(var(--eco-primary))] to-[rgb(var(--eco-secondary))] rounded-full blur-3xl opacity-5" />
      <div className="fixed bottom-0 right-0 w-96 h-96 bg-gradient-to-tl from-[rgb(var(--eco-accent))] to-[rgb(var(--eco-secondary))] rounded-full blur-3xl opacity-5" />
      
      {/* Top navbar */}
      <div className="sticky top-0 z-30 bg-white/70 backdrop-blur-xl border-b border-slate-200/60 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image src="/logo.png" alt="Logo" width={32} height={32} className="rounded-xl" />
            <div className="flex items-baseline gap-2 select-none">
              <span className="text-xl font-bold text-slate-900">Smart Circular</span>
              <span className="text-xl font-bold text-gradient-eco">E‑Waste Platform</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-600">👤 Hi, <span className="font-semibold text-slate-900">admin</span></span>
            <button
              onClick={logout}
              className="eco-btn-ghost text-sm text-red-600 hover:bg-red-50"
            >
              Logout
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-8 relative z-10">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">🛡️ Admin Dashboard</h1>
          <p className="text-slate-600">Manage platform operations and partner verification</p>
        </div>

        <div className="eco-card mb-6 bg-gradient-to-br from-blue-50/50 to-indigo-50/50 border-2 border-blue-100">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xl flex-shrink-0">
              ℹ️
            </div>
            <div>
              <h3 className="text-sm font-bold text-blue-900 mb-1">Admin Access</h3>
              <p className="text-sm text-blue-800">This dashboard allows authorized administrators to manage partner verification, users, and platform listings securely.</p>
            </div>
          </div>
        </div>

        <div className="eco-card">
          <div className="mb-6 flex gap-3">
            <button 
              className={tab === "partners" ? "eco-btn-primary" : "eco-btn-secondary"}
              onClick={() => setTab("partners")}
            >
              🏪 Partners
            </button>
            <button 
              className={tab === "users" ? "eco-btn-primary" : "eco-btn-secondary"}
              onClick={() => setTab("users")}
            >
              👥 Users
            </button>
            <button 
              className={tab === "listings" ? "eco-btn-primary" : "eco-btn-secondary"}
              onClick={() => setTab("listings")}
            >
              📱 Listings
            </button>
          </div>

          {loading ? (
            <div className="text-center py-12">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 animate-spin">
                <div className="w-10 h-10 rounded-full bg-white" />
              </div>
              <p className="mt-3 text-sm text-slate-600">Loading admin data...</p>
            </div>
          ) : tab === "partners" ? (
            partners.length === 0 ? (
              <div className="eco-empty-state">
                <div className="text-5xl mb-3">🏪</div>
                <h3 className="text-lg font-semibold text-slate-800 mb-1">No Partners Yet</h3>
                <p className="text-sm text-slate-600">Partner registrations will appear here for verification.</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg">
              <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b-2 border-emerald-100 bg-gradient-to-r from-emerald-50/50 to-teal-50/50">
                      <th className="text-left py-3 px-4 font-bold text-slate-700">ID</th>
                      <th className="text-left py-3 px-4 font-bold text-slate-700">Name</th>
                      <th className="text-left py-3 px-4 font-bold text-slate-700">Type</th>
                      <th className="text-left py-3 px-4 font-bold text-slate-700">City</th>
                      <th className="text-left py-3 px-4 font-bold text-slate-700">Phone</th>
                      <th className="text-left py-3 px-4 font-bold text-slate-700">KYC Status</th>
                      <th className="text-left py-3 px-4 font-bold text-slate-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {partners.map((p) => (
                      <tr key={p.id} className="border-t border-slate-100 hover:bg-emerald-50/30 transition-colors">
                        <td className="py-3 px-4 text-sm text-slate-700 font-medium">{p.id}</td>
                        <td className="py-3 px-4 font-medium text-slate-800">{p.name || "-"}</td>
                        <td className="py-3 px-4 text-slate-600">{p.type || "-"}</td>
                        <td className="py-3 px-4 text-slate-600">{p.city || "-"}</td>
                        <td className="py-3 px-4 text-slate-600">{p.contact_phone || "(hidden)"}</td>
                        <td className="py-3 px-4">
                          <span className={`eco-badge ${
                            p.kyc_status === "verified" ? "eco-badge-success" :
                            p.kyc_status === "rejected" ? "eco-badge-danger" :
                            p.kyc_status === "pending" ? "eco-badge-warning" :
                            "eco-badge-secondary"
                          }`}>
                            {p.kyc_status === "verified" ? "✓ Verified" :
                             p.kyc_status === "rejected" ? "✗ Rejected" :
                             p.kyc_status === "pending" ? "⏳ Pending" :
                             "Not Submitted"}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex gap-2">
                            <button 
                              className="px-4 py-1.5 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-sm" 
                              onClick={() => doAction(p.id, "verify")}
                            >
                              ✓ Verify
                            </button>
                            <button 
                              className="px-4 py-1.5 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors shadow-sm" 
                              onClick={() => doAction(p.id, "reject")}
                            >
                              ✗ Reject
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : tab === "listings" ? (
            /* Listings tab */
            listings.length === 0 ? (
              <div className="eco-empty-state">
                <div className="text-5xl mb-3">📱</div>
                <h3 className="text-lg font-semibold text-slate-800 mb-1">No Listings Found</h3>
                <p className="text-sm text-slate-600">Device listings will appear here for moderation.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between py-3 px-4 bg-gradient-to-r from-emerald-50/50 to-teal-50/50 rounded-lg border border-emerald-100">
                  <div className="flex items-center gap-3">
                    <label className="text-sm font-medium text-slate-700">📊 Status:</label>
                    <select
                      value={listingStatus}
                      onChange={(e) => setListingStatus(e.target.value as any)}
                      className="eco-select"
                    >
                      <option value="all">All</option>
                      <option value="created">Created</option>
                      <option value="hidden">Hidden</option>
                      <option value="removed">Removed</option>
                    </select>
                  </div>
                  <button
                    onClick={() => fetchListings(listingStatus)}
                    className="eco-btn-secondary"
                  >
                    🔄 Refresh
                  </button>
                </div>
                {listings.map((listing) => (
                  <div
                    key={listing.id}
                    className="eco-card hover:shadow-lg transition-all duration-300 hover:scale-[1.01]"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-lg font-bold text-slate-800">📱 Listing #{listing.id}</span>
                          <span className={`eco-badge ${
                            listing.status === "hidden" ? "eco-badge-warning" :
                            listing.status === "removed" ? "eco-badge-danger" :
                            "eco-badge-success"
                          }`}>
                            {listing.status === "hidden" ? "⏸️ Hidden" :
                             listing.status === "removed" ? "🗑️ Removed" :
                             "✓ Active"}
                          </span>
                        </div>
                        <div className="text-sm text-slate-600 mb-3 space-y-1 bg-slate-50/50 p-3 rounded-lg border border-slate-100">
                          <p><strong className="text-slate-700">👤 User:</strong> {listing.user_email || "Unknown"}</p>
                          <p><strong className="text-slate-700">🎯 Intent:</strong> {listing.intent || "N/A"}</p>
                          <p><strong className="text-slate-700">📅 Created:</strong> {listing.created_at ? new Date(listing.created_at).toLocaleDateString() : "N/A"}</p>
                        </div>
                        {listing.image && (
                          <div className="mt-3 flex items-start gap-4 bg-white/50 p-3 rounded-lg border border-emerald-100">
                            {/* Preview (served from backend /uploads) */}
                            <img
                              src={`${API}/uploads/${listing.image}`}
                              alt="Listing image"
                              className="w-48 h-48 object-cover rounded-lg border-2 border-emerald-200 bg-white shadow-sm"
                              onError={(e) => {
                                const el = e.target as HTMLImageElement;
                                el.style.display = "none";
                              }}
                            />
                            <div className="text-xs text-slate-600 flex-1">
                              <p className="mb-1"><strong className="text-slate-700">📎 File:</strong> {listing.image}</p>
                              <a
                                href={`${API}/uploads/${listing.image}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-700 font-medium hover:underline"
                              >
                                🔍 Open full image
                              </a>
                            </div>
                          </div>
                        )}
                        {Object.keys(listing.payload).length > 0 && (
                          <div className="mt-3 text-xs bg-gradient-to-br from-slate-50 to-slate-100 p-3 rounded-lg border border-slate-200 max-h-32 overflow-auto">
                            <p className="font-bold mb-2 text-slate-700">📦 Payload Data:</p>
                            <pre className="text-slate-600 font-mono">{JSON.stringify(listing.payload, null, 2)}</pre>
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2 flex-col ml-4">
                        {listing.status !== "hidden" && listing.status !== "removed" && (
                          <button
                            onClick={() => hideListing(listing.id)}
                            className="px-4 py-2 text-sm font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors shadow-sm whitespace-nowrap"
                          >
                            🚫 Hide
                          </button>
                        )}
                        {(listing.status === "hidden" || listing.status === "removed") && (
                          <button
                            onClick={() => restoreListing(listing.id)}
                            className="px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors shadow-sm whitespace-nowrap"
                          >
                            ↺ Restore
                          </button>
                        )}
                        <button
                          onClick={() => deleteListing(listing.id)}
                          className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors shadow-sm whitespace-nowrap"
                        >
                          🗑️ Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            users.length === 0 ? (
              <div className="eco-empty-state">
                <div className="text-5xl mb-3">👥</div>
                <h3 className="text-lg font-semibold text-slate-800 mb-1">No Users Found</h3>
                <p className="text-sm text-slate-600">Registered users will appear here.</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-emerald-100 bg-gradient-to-r from-emerald-50/50 to-teal-50/50">
                    <th className="text-left py-3 px-4 font-bold text-slate-700">ID</th>
                    <th className="text-left py-3 px-4 font-bold text-slate-700">Name</th>
                    <th className="text-left py-3 px-4 font-bold text-slate-700">Email</th>
                    <th className="text-left py-3 px-4 font-bold text-slate-700">Role</th>
                    <th className="text-left py-3 px-4 font-bold text-slate-700">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-t border-slate-100 hover:bg-emerald-50/30 transition-colors">
                      <td className="py-3 px-4 text-sm text-slate-700 font-medium">{u.id}</td>
                      <td className="py-3 px-4 font-medium text-slate-800">{u.name || "-"}</td>
                      <td className="py-3 px-4 text-slate-600">{u.email}</td>
                      <td className="py-3 px-4">
                        <span className={`eco-badge ${
                          u.role === "admin" ? "eco-badge-danger" :
                          u.role === "partner" ? "eco-badge-info" :
                          "eco-badge-secondary"
                        }`}>
                          {u.role === "admin" ? "🔑 Admin" :
                           u.role === "partner" ? "🏪 Partner" :
                           "👤 Customer"}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-600 text-sm">{u.created_at || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
