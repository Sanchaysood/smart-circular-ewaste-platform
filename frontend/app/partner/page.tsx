"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import toast from "react-hot-toast";

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

type PartnerProfile = {
  org_name: string;
  partner_type: string; // "repair" | "recycler" | "both"
  city: string;
  address: string;
  service_radius_km: number | string;
  contact_phone: string;
  lat?: number | string | null;
  lon?: number | string | null;
  kyc_status?: string;
};

type Lead = {
  id?: number;
  listing_id: number;
  brand?: string;
  model?: string;
  city?: string;
  intent?: string; // canonical field
  intention?: string; // legacy/alt field
  status?: string;
  created_at?: string;
  image?: string;
  predictions?: {
    price_suggest?: number;
    rul_months?: number;
    decision?: string;
    co2_saved_kg?: number;
  };
};

function cx(...a: Array<string | false | null | undefined>) {
  return a.filter(Boolean).join(" ");
}

export default function PartnerPage() {
  const [token, setToken] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);

  const [profile, setProfile] = useState<PartnerProfile>({
    org_name: "",
    partner_type: "repair",
    city: "",
    address: "",
    service_radius_km: 5,
    contact_phone: "",
    lat: "",
    lon: "",
    kyc_status: "not_submitted",
  });

  const [loadingProfile, setLoadingProfile] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileExists, setProfileExists] = useState(false);
  const [notPartnerRole, setNotPartnerRole] = useState(false);

  const [leads, setLeads] = useState<Lead[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(false);

  // --------- INIT: read token ----------
  useEffect(() => {
    const t = localStorage.getItem("ew_token");
    const n = localStorage.getItem("ew_name");
    setToken(t);
    setName(n);
  }, []);

  // --------- LOAD PROFILE ----------
  // Use backend's GET /partners/me
  useEffect(() => {
    if (!token) {
      setLoadingProfile(false);
      return;
    }
    (async () => {
      setLoadingProfile(true);
      try {
        const res = await axios.get(`${API}/partners/me`, {
          headers: { Authorization: `Bearer ${token}` },
          validateStatus: () => true,
        });

        if (res.status === 403) {
          setNotPartnerRole(true);
          setLoadingProfile(false);
          return;
        }

        if (res.status === 200 && res.data) {
          setProfile({
            org_name: res.data.org_name ?? "",
            partner_type: res.data.partner_type ?? "repair",
            city: res.data.city ?? "",
            address: res.data.address ?? "",
            service_radius_km: res.data.service_radius_km ?? 5,
            contact_phone: res.data.contact_phone ?? "",
            lat: res.data.lat ?? "",
            lon: res.data.lon ?? "",
          });
          setProfileExists(true);
        }
      } catch (e) {
        // ignore – we just show empty form
        console.error("Load profile error", e);
      } finally {
        setLoadingProfile(false);
      }
    })();
  }, [token]);

  // --------- SAVE PROFILE ----------
  // Use backend's POST /partners/register
  const saveProfile = async () => {
    if (!token) {
      toast.error("Please log in first.");
      return;
    }
    if (!profile.org_name || !profile.city || !profile.address) {
      toast.error("Please fill Organisation name, City and Address.");
      return;
    }
    setSavingProfile(true);
    try {
      const payload = {
        org_name: profile.org_name,
        partner_type: profile.partner_type,
        city: profile.city,
        address: profile.address,
        service_radius_km: Number(profile.service_radius_km) || 5,
        contact_phone: profile.contact_phone,
        lat: profile.lat === "" ? null : Number(profile.lat),
        lon: profile.lon === "" ? null : Number(profile.lon),
      };

      // NOTE: backend expects /partners/register (plural)
      const res = await axios.post(`${API}/partners/register`, payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        validateStatus: () => true,
      });

      if (res.status === 200 || res.status === 201) {
        toast.success("Partner profile saved.");
        setProfileExists(true);
        // reload leads after successful save
        loadLeads();
        // refresh profile to pick up kyc_status
        try {
          const me = await axios.get(`${API}/partners/me`, {
            headers: { Authorization: `Bearer ${token}` },
            validateStatus: () => true,
          });
          if (me.status === 200 && me.data) {
            setProfile((p) => ({ ...p, kyc_status: me.data.kyc_status ?? p.kyc_status }));
          }
        } catch (e) {
          // ignore
        }
      } else {
        toast.error(res.data?.detail || "Could not save profile. Check backend logs.");
      }
    } catch (e: any) {
      const msg = e?.response?.data?.detail || "Save failed.";
      toast.error(msg);
      console.error("Save profile failed", e);
    } finally {
      setSavingProfile(false);
    }
  };

  // --------- LOAD LEADS ----------
  // Use backend's GET /partners/leads?status=open (plural)
  const loadLeads = async () => {
    if (!token) return;
    setLoadingLeads(true);
    try {
      const res = await axios.get(`${API}/partners/leads?status=open`, {
        headers: { Authorization: `Bearer ${token}` },
        validateStatus: () => true,
      });

      if (res.status === 403) {
        setNotPartnerRole(true);
        setLeads([]);
        return;
      }

      if (res.status !== 200) {
        // 404 or any error → treat as "no leads" instead of crashing
        setLeads([]);
        return;
      }

      // Normalize returned structure:
      // backend returns { items: [...] } or array
      let items: any[] = [];
      if (Array.isArray(res.data)) items = res.data;
      else if (res.data && Array.isArray(res.data.items)) items = res.data.items;
      else items = [];

      const normalized: Lead[] = items.map((it: any) => {
        // prefer explicit listing_id, fallback to id
        const listing_id = it.listing_id ?? it.id;
        // payload may store intent under 'intent' (create_listing uses 'intent') — ensure we read it
        const payload = it.payload || it.predictions?.payload || {};
        // If API already returned 'intention' or 'intent' inside object, read them too
        const intention = it.intention ?? it.intent ?? payload?.intent ?? payload?.intention ?? it.predictions?.decision;
        return {
          id: it.id ?? undefined,
          listing_id,
          brand: it.brand ?? it.model ?? undefined,
          model: it.model ?? undefined,
          city: it.city ?? undefined,
          intent: it.intent ?? intention ?? undefined,
          intention: it.intention ?? it.intent ?? undefined,
          status: it.status ?? it.state ?? "created",
          created_at: it.created_at ?? it.createdAt ?? undefined,
          image: it.image ?? undefined,
          predictions: it.predictions ?? undefined,
        } as Lead;
      });

      setLeads(normalized);
    } catch (e) {
      console.error("Load leads error", e);
      toast.error("Could not load leads.");
      setLeads([]);
    } finally {
      setLoadingLeads(false);
    }
  };

  useEffect(() => {
    if (token) {
      loadLeads();
    }
  }, [token]);

  // --------- ACTIONS ON LEADS ----------
  // Use plural endpoints: /partners/leads/{id}/accept|reject|complete
  const updateLead = async (
    listingId: number,
    action: "accept" | "reject" | "complete",
  ) => {
    if (!token) return;
    let url = "";
    let body: any = {};

    // NOTE: backend partner action endpoints live under /partners/leads/...
    if (action === "accept") {
      url = `${API}/partners/leads/${listingId}/accept`;
    } else if (action === "reject") {
      url = `${API}/partners/leads/${listingId}/reject`;
    } else {
      const outcome = window.prompt("Enter outcome (repaired / sold / recycled):", "repaired");
      if (!outcome) return;
      const finalPriceStr = window.prompt("Enter final price (if applicable, else leave blank):", "");
      const final_price = finalPriceStr ? Number(finalPriceStr) : null;
      url = `${API}/partners/leads/${listingId}/complete`;
      body = { outcome, final_price };
    }

    try {
      const res = await axios.post(url, body, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        validateStatus: () => true,
      });
      if (res.status >= 200 && res.status < 300) {
        toast.success("Updated lead.");
        loadLeads();
      } else {
        toast.error(res.data?.detail || "Could not update lead.");
      }
    } catch (e: any) {
      const msg = e?.response?.data?.detail || "Update failed.";
      toast.error(msg);
      console.error("Update lead error", e);
    }
  };

  const logout = () => {
    localStorage.removeItem("ew_token");
    localStorage.removeItem("ew_name");
    setToken(null);
    setName(null);
    window.location.href = "/partner";
  };

  // --------- VIEW: NOT LOGGED IN ----------
  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-sky-50">
        <div className="rounded-3xl border bg-white/90 backdrop-blur-md p-10 text-center shadow-lg max-w-lg w-full">
          <img
            src="/logo.png"
            alt="logo"
            className="mx-auto w-16 mb-5 rounded-md"
          />
          <h1 className="text-2xl font-bold tracking-tight mb-2 text-slate-800">
            Partner Portal
          </h1>
          <p className="text-slate-600 mb-6 text-sm leading-relaxed">
            Sign in with your existing account to manage repair / recycling
            leads.
          </p>

          <Link
            href="/new-listing?next=/partner"
            className="inline-block bg-sky-600 hover:bg-sky-700 text-white px-6 py-2 rounded-xl font-medium transition"
          >
            Go to Login
          </Link>
        </div>
      </div>
    );
  }

  // --------- VIEW: LOGGED IN PARTNER DASHBOARD ----------
  return (
    <div className="min-h-screen bg-slate-50">
     <header className="navbar">
  <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
    <div className="flex items-center gap-3">
      <img
        src="/logo.png"
        alt="E-Waste Logo"
        className="w-9 h-9 rounded-md"
      />
      <div>
        <h1 className="text-xl md:text-2xl font-bold tracking-tight brand-text">
          Partner Portal
        </h1>
        <p className="text-xs text-slate-500">
          Manage your profile & circular-economy leads
        </p>
      </div>
    </div>
    <div className="flex items-center gap-3">
      <span className="hidden sm:inline text-sm text-slate-700">
        Hi, {name || "Partner"}
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

      <main className="mx-auto max-w-7xl px-6 py-8 space-y-8">
        {notPartnerRole && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Your account is not marked as a <strong>partner</strong> in the
            backend yet. Ask your guide/admin to set <code>role="partner"</code>{" "}
            for your user in the database.
          </div>
        )}

        {/* PROFILE / KYC */}
        <section className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Partner Profile (KYC-lite)
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                We use this to calculate distance and show you relevant repair /
                recycling leads.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {profileExists && (
                <span className="text-xs px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Profile saved
                </span>
              )}
              <span
                className={cx(
                  "text-xs px-2 py-1 rounded-full border",
                  profile.kyc_status === "verified"
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : profile.kyc_status === "submitted"
                    ? "bg-amber-50 text-amber-700 border-amber-200"
                    : "bg-slate-50 text-slate-700 border-slate-200",
                )}
              >
                KYC: {profile.kyc_status ?? "not_submitted"}
              </span>
            </div>
          </div>

          {loadingProfile ? (
            <p className="text-sm text-slate-600">Loading profile…</p>
          ) : (
            <div className="grid md:grid-cols-2 gap-5">
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="label">Organisation name *</label>
                  <input
                    className="input"
                    value={profile.org_name}
                    onChange={(e) =>
                      setProfile((p) => ({
                        ...p,
                        org_name: e.target.value,
                      }))
                    }
                    placeholder="GreenTech Repairs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="label">Partner type</label>
                  <select
                    className="input"
                    value={profile.partner_type}
                    onChange={(e) =>
                      setProfile((p) => ({
                        ...p,
                        partner_type: e.target.value,
                      }))
                    }
                  >
                    <option value="repair">Repair</option>
                    <option value="recycler">Recycler</option>
                    <option value="both">Both</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="label">Contact phone</label>
                  <input
                    className="input"
                    value={profile.contact_phone}
                    onChange={(e) =>
                      setProfile((p) => ({
                        ...p,
                        contact_phone: e.target.value,
                      }))
                    }
                    placeholder="+91-9876543210"
                  />
                  <div className="text-xs text-slate-500 mt-1">
                    Your phone will be visible to users only after KYC is verified.
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="label">City *</label>
                  <input
                    className="input"
                    value={profile.city}
                    onChange={(e) =>
                      setProfile((p) => ({ ...p, city: e.target.value }))
                    }
                    placeholder="Bengaluru"
                  />
                </div>

                <div className="space-y-1">
                  <label className="label">Address *</label>
                  <textarea
                    className="input min-h-[60px]"
                    value={profile.address}
                    onChange={(e) =>
                      setProfile((p) => ({ ...p, address: e.target.value }))
                    }
                    placeholder="Street, area, landmark"
                  />
                </div>

                <div className="grid grid-cols-3 gap-3 items-end">
                  <div className="space-y-1">
                    <label className="label">Service radius (km)</label>
                    <input
                      className="input"
                      type="number"
                      value={profile.service_radius_km}
                      onChange={(e) =>
                        setProfile((p) => ({
                          ...p,
                          service_radius_km: e.target.value,
                        }))
                      }
                      placeholder="5"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="label">Lat</label>
                    <input
                      className="input"
                      value={profile.lat ?? ""}
                      onChange={(e) =>
                        setProfile((p) => ({ ...p, lat: e.target.value }))
                      }
                      placeholder="optional"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="label">Lon</label>
                    <input
                      className="input"
                      value={profile.lon ?? ""}
                      onChange={(e) =>
                        setProfile((p) => ({ ...p, lon: e.target.value }))
                      }
                      placeholder="optional"
                    />
                  </div>
                </div>
              </div>

              <div className="md:col-span-2 flex justify-end mt-2">
                <button
                  onClick={saveProfile}
                  disabled={savingProfile}
                  className={cx(
                    "btn btn-primary",
                    savingProfile && "opacity-70 cursor-not-allowed",
                  )}
                >
                  {savingProfile ? "Saving…" : "Save profile"}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* LEADS */}
        <section className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Assigned / Nearby Leads
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Listings where users chose repair / recycle and were routed to
                you.
              </p>
            </div>
            <button
              onClick={loadLeads}
              className="text-xs rounded-xl border px-3 py-1 bg-slate-50 hover:bg-slate-100"
            >
              Refresh
            </button>
          </div>

          {loadingLeads ? (
            <p className="text-sm text-slate-600">Loading leads…</p>
          ) : !Array.isArray(leads) || leads.length === 0 ? (
            <p className="text-sm text-slate-600">
              No leads yet. Once users in your service area choose{" "}
              <strong>repair</strong> or <strong>recycle</strong>, they will
              appear here.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-slate-600">
                    <th className="py-2 pr-4">Device</th>
                    <th className="py-2 pr-4">Intention</th>
                    <th className="py-2 pr-4">City</th>
                    <th className="py-2 pr-4">Suggested price</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Created</th>
                    <th className="py-2 pr-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => (
                    <tr
                      key={lead.listing_id}
                      className="border-b hover:bg-slate-50 align-top"
                    >
                      <td className="py-2 pr-4">
                        <div className="font-medium">
                          {[lead.brand, lead.model]
                            .filter(Boolean)
                            .join(" ")}
                        </div>
                        {lead.image && (
                          <img
                            src={`${API}/uploads/${lead.image}`}
                            className="mt-1 h-10 w-10 rounded object-cover border"
                            alt="thumb"
                          />
                        )}
                      </td>
                      <td className="py-2 pr-4 capitalize">
                        {lead.intent || lead.intention || "—"}
                      </td>
                      <td className="py-2 pr-4">{lead.city || "—"}</td>
                      <td className="py-2 pr-4">
                        {lead.predictions?.price_suggest
                          ? `₹${lead.predictions.price_suggest}`
                          : "—"}
                      </td>
                      <td className="py-2 pr-4">
                        <span className="text-xs rounded-full px-2 py-0.5 border bg-slate-50">
                          {lead.status || "pending"}
                        </span>
                      </td>
                      <td className="py-2 pr-4">
                        {lead.created_at
                          ? new Date(lead.created_at).toLocaleDateString()
                          : "—"}
                      </td>
                      <td className="py-2 pr-4 space-x-2 whitespace-nowrap">
                        <button
                          className="text-xs rounded bg-emerald-50 px-2 py-1 text-emerald-700 border border-emerald-200"
                          onClick={() =>
                            updateLead(lead.listing_id, "accept")
                          }
                        >
                          Accept
                        </button>
                        <button
                          className="text-xs rounded bg-amber-50 px-2 py-1 text-amber-700 border border-amber-200"
                          onClick={() =>
                            updateLead(lead.listing_id, "complete")
                          }
                        >
                          Mark completed
                        </button>
                        <button
                          className="text-xs rounded bg-red-50 px-2 py-1 text-red-700 border border-red-200"
                          onClick={() =>
                            updateLead(lead.listing_id, "reject")
                          }
                        >
                          Reject
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
