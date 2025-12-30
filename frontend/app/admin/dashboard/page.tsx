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
    <div className="min-h-screen bg-slate-50">
      {/* Top navbar */}
      <div className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image src="/logo.png" alt="Logo" width={28} height={28} className="rounded" />
            <div className="flex items-baseline gap-2 select-none">
              <span className="text-xl font-semibold text-slate-900">Smart Circular</span>
              <span className="text-xl font-semibold text-sky-600">E‑Waste Platform</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-slate-600">Hi, admin</span>
            <button
              onClick={logout}
              className="px-4 py-2 text-sm rounded-full bg-red-600 text-white hover:bg-red-700"
            >
              Logout
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-8">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">Admin Dashboard</h1>
        </div>

        <div className="mb-4 text-sm text-slate-600 bg-white p-4 rounded shadow-sm">
          <strong>Admin Access: This dashboard allows authorized administrators to manage partner verification, users, and platform listings securely.</strong>
        </div>

        <div className="bg-white shadow rounded p-4">
          <div className="mb-4 flex gap-2">
            <button className={"px-3 py-1 rounded " + (tab === "partners" ? "bg-sky-600 text-white" : "border") } onClick={() => setTab("partners")}>Partners</button>
            <button className={"px-3 py-1 rounded " + (tab === "users" ? "bg-sky-600 text-white" : "border") } onClick={() => setTab("users")}>Users</button>
            <button className={"px-3 py-1 rounded " + (tab === "listings" ? "bg-sky-600 text-white" : "border") } onClick={() => setTab("listings")}>Listings</button>
          </div>

          {loading ? (
            <div>Loading…</div>
          ) : tab === "partners" ? (
            partners.length === 0 ? (
              <div className="text-sm text-slate-500">No partners found.</div>
            ) : (
              <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="py-2 px-4">ID</th>
                      <th className="py-2 px-4">Name</th>
                      <th className="py-2 px-4">Type</th>
                      <th className="py-2 px-4">City</th>
                      <th className="py-2 px-4">Phone</th>
                      <th className="py-2 px-4">KYC</th>
                      <th className="py-2 px-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {partners.map((p) => (
                      <tr key={p.id} className="border-t">
                        <td className="py-3 px-4 text-sm text-slate-700">{p.id}</td>
                        <td className="py-3 px-4">{p.name || "-"}</td>
                        <td className="py-3 px-4">{p.type || "-"}</td>
                        <td className="py-3 px-4">{p.city || "-"}</td>
                        <td className="py-3 px-4">{p.contact_phone || "(hidden)"}</td>
                        <td className="py-3 px-4">{p.kyc_status || "not_submitted"}</td>
                        <td className="py-3 px-4">
                          <div className="flex gap-3">
                            <button className="btn btn-primary px-3 py-1" onClick={() => doAction(p.id, "verify")}>Verify</button>
                            <button className="btn px-3 py-1 bg-red-600 text-white" onClick={() => doAction(p.id, "reject")}>Reject</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
            )
          ) : tab === "listings" ? (
            /* Listings tab */
            listings.length === 0 ? (
              <div className="text-sm text-slate-500">No listings found.</div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-slate-600">Status:</label>
                    <select
                      value={listingStatus}
                      onChange={(e) => setListingStatus(e.target.value as any)}
                      className="px-2 py-1 text-sm border rounded bg-white"
                    >
                      <option value="all">All</option>
                      <option value="created">Created</option>
                      <option value="hidden">Hidden</option>
                      <option value="removed">Removed</option>
                    </select>
                  </div>
                  <button
                    onClick={() => fetchListings(listingStatus)}
                    className="px-3 py-1 text-sm border rounded hover:bg-slate-50"
                  >
                    Refresh
                  </button>
                </div>
                {listings.map((listing) => (
                  <div
                    key={listing.id}
                    className="border rounded p-4 bg-gray-50"
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-semibold">Listing #{listing.id}</span>
                          <span className={`px-2 py-1 text-xs rounded ${
                            listing.status === "hidden" ? "bg-yellow-100 text-yellow-800" :
                            listing.status === "removed" ? "bg-red-100 text-red-800" :
                            "bg-green-100 text-green-800"
                          }`}>
                            {listing.status}
                          </span>
                        </div>
                        <div className="text-sm text-gray-600 mb-2">
                          <p><strong>User:</strong> {listing.user_email || "Unknown"}</p>
                          <p><strong>Intent:</strong> {listing.intent || "N/A"}</p>
                          <p><strong>Created:</strong> {listing.created_at ? new Date(listing.created_at).toLocaleDateString() : "N/A"}</p>
                        </div>
                        {listing.image && (
                          <div className="mt-2 flex items-start gap-4">
                            {/* Preview (served from backend /uploads) */}
                            <img
                              src={`${API}/uploads/${listing.image}`}
                              alt="Listing image"
                              className="w-48 h-48 object-cover rounded border border-gray-200 bg-white"
                              onError={(e) => {
                                const el = e.target as HTMLImageElement;
                                el.style.display = "none";
                              }}
                            />
                            <div className="text-xs text-gray-600">
                              <p><strong>File:</strong> {listing.image}</p>
                              <a
                                href={`${API}/uploads/${listing.image}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sky-600 hover:underline"
                              >
                                Open full image
                              </a>
                            </div>
                          </div>
                        )}
                        {Object.keys(listing.payload).length > 0 && (
                          <div className="mt-2 text-xs bg-white p-2 rounded border border-gray-200 max-h-32 overflow-auto">
                            <p className="font-semibold mb-1">Payload:</p>
                            <pre className="text-gray-700">{JSON.stringify(listing.payload, null, 2)}</pre>
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2 flex-col">
                        {listing.status !== "hidden" && listing.status !== "removed" && (
                          <button
                            onClick={() => hideListing(listing.id)}
                            className="px-3 py-1 text-sm bg-yellow-500 text-white rounded hover:bg-yellow-600"
                          >
                            Hide
                          </button>
                        )}
                        {(listing.status === "hidden" || listing.status === "removed") && (
                          <button
                            onClick={() => restoreListing(listing.id)}
                            className="px-3 py-1 text-sm bg-sky-600 text-white rounded hover:bg-sky-700"
                          >
                            Restore
                          </button>
                        )}
                        <button
                          onClick={() => deleteListing(listing.id)}
                          className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            users.length === 0 ? (
              <div className="text-sm text-slate-500">No users found.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left">
                    <th className="py-2">ID</th>
                    <th className="py-2">Name</th>
                    <th className="py-2">Email</th>
                    <th className="py-2">Role</th>
                    <th className="py-2">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-t">
                      <td className="py-2">{u.id}</td>
                      <td className="py-2">{u.name || "-"}</td>
                      <td className="py-2">{u.email}</td>
                      <td className="py-2">{u.role}</td>
                      <td className="py-2">{u.created_at || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </div>
      </div>
    </div>
  );
}
