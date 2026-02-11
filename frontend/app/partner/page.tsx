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

  // Messaging state
  const [chatModal, setChatModal] = useState<{ open: boolean; listingId: number | null }>({
    open: false,
    listingId: null,
  });
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);

  // Offer state
  const [offerModal, setOfferModal] = useState<{ open: boolean; listingId: number | null; currentOffer?: any }>({
    open: false,
    listingId: null,
  });
  const [offerPrice, setOfferPrice] = useState("");
  const [offerMessage, setOfferMessage] = useState("");
  const [submittingOffer, setSubmittingOffer] = useState(false);

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
  }, [token, loadLeads]);

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

  // --------- MESSAGING FUNCTIONS ----------
  const openChat = async (listingId: number) => {
    setChatModal({ open: true, listingId });
    setMessages([]);
    await fetchMessages(listingId);
  };

  const closeChat = () => {
    setChatModal({ open: false, listingId: null });
    setMessages([]);
    setNewMessage("");
  };

  const fetchMessages = async (listingId: number) => {
    if (!token) return;
    try {
      const res = await axios.get(`${API}/listings/${listingId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 200 && res.data.messages) {
        setMessages(res.data.messages);
      }
    } catch (e) {
      console.error("Failed to fetch messages:", e);
    }
  };

  const sendMessage = async () => {
    if (!chatModal.listingId || !newMessage.trim() || !token) return;

    setSendingMessage(true);
    try {
      const res = await axios.post(
        `${API}/listings/${chatModal.listingId}/messages`,
        { message: newMessage },
        { headers: { Authorization: `Bearer ${token}` } }
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

  // --------- OFFER FUNCTIONS ----------
  const openOfferModal = async (listingId: number) => {
    if (!token) return;
    
    // Fetch existing offer if any
    try {
      const res = await axios.get(`${API}/listings/${listingId}/offer`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (res.status === 200 && res.data.offer) {
        setOfferPrice(res.data.offer.offer_price.toString());
        setOfferMessage(res.data.offer.message || "");
        setOfferModal({ open: true, listingId, currentOffer: res.data.offer });
      } else {
        // No existing offer
        setOfferPrice("");
        setOfferMessage("");
        setOfferModal({ open: true, listingId });
      }
    } catch (e) {
      // No offer exists, that's fine
      setOfferPrice("");
      setOfferMessage("");
      setOfferModal({ open: true, listingId });
    }
  };

  const closeOfferModal = () => {
    setOfferModal({ open: false, listingId: null });
    setOfferPrice("");
    setOfferMessage("");
  };

  const submitOffer = async () => {
    if (!offerModal.listingId || !token) return;
    
    const price = Number(offerPrice);
    if (!price || price <= 0) {
      toast.error("Please enter a valid offer price");
      return;
    }

    setSubmittingOffer(true);
    try {
      const res = await axios.post(
        `${API}/listings/${offerModal.listingId}/offer`,
        {
          offer_price: price,
          message: offerMessage,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (res.status === 200) {
        toast.success("Offer submitted successfully!");
        closeOfferModal();
        loadLeads(); // Refresh leads
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Failed to submit offer");
      console.error("Submit offer error:", e);
    } finally {
      setSubmittingOffer(false);
    }
  };

  // --------- VIEW: NOT LOGGED IN ----------
  if (!token) {
    return (
      <div className="min-h-screen">
        <header className="sticky top-0 z-40 bg-white/70 backdrop-blur-xl border-b border-slate-200/60 shadow-sm">
          <div className="container-eco py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img
                src="/logo.png"
                alt="E-Waste Logo"
                className="w-10 h-10 rounded-xl object-contain"
              />
              <h1 className="text-lg md:text-xl font-bold text-gradient-eco">
                Partner Portal
              </h1>
            </div>
            <Link
              href="/new-listing"
              className="eco-btn-ghost text-sm"
            >
              ← User Login
            </Link>
          </div>
        </header>

        <main className="container-eco py-10">
          <div className="max-w-2xl mx-auto">
            <div className="eco-card space-y-6">
              <div className="text-center mb-4">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[rgb(var(--eco-primary))]/10 to-[rgb(var(--eco-secondary))]/10 flex items-center justify-center">
                  <span className="text-3xl">🏪</span>
                </div>
                <h2 className="text-2xl font-bold text-slate-900 mb-2">Join as a Partner</h2>
                <p className="text-sm text-slate-600">Register your repair or recycling business to receive leads</p>
              </div>

              <div className="eco-divider" />

              <div className="text-center space-y-4">
                <p className="text-slate-700">
                  Partners get access to device repair and recycling leads from our platform users.
                </p>
                
                <div className="grid sm:grid-cols-2 gap-4 text-left">
                  <div className="rounded-xl bg-gradient-to-br from-emerald-50 to-white border border-emerald-100 p-4">
                    <div className="text-2xl mb-2">📱</div>
                    <div className="font-semibold text-slate-900 mb-1">Receive Leads</div>
                    <div className="text-xs text-slate-600">Get notified about devices in your service area</div>
                  </div>
                  
                  <div className="rounded-xl bg-gradient-to-br from-blue-50 to-white border border-blue-100 p-4">
                    <div className="text-2xl mb-2">🌱</div>
                    <div className="font-semibold text-slate-900 mb-1">Circular Economy</div>
                    <div className="text-xs text-slate-600">Help reduce e-waste and extend device lifespans</div>
                  </div>
                </div>

                <Link
                  href="/new-listing?partner=true"
                  className="eco-btn-primary w-full inline-block"
                >
                  Create Partner Account →
                </Link>

                <p className="text-xs text-slate-500">
                  Already have an account?{" "}
                  <Link 
                    href="/new-listing?partner=true" 
                    className="text-[rgb(var(--eco-primary))] hover:text-[rgb(var(--eco-secondary))] font-medium transition"
                  >
                    Sign in here
                  </Link>
                </p>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // --------- VIEW: LOGGED IN PARTNER DASHBOARD ----------
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 bg-white/70 backdrop-blur-xl border-b border-slate-200/60 shadow-sm">
        <div className="container-eco py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="E-Waste Logo"
              className="w-10 h-10 rounded-xl object-contain"
            />
            <div>
              <h1 className="text-lg md:text-xl font-bold text-gradient-eco">
                Partner Portal
              </h1>
              <p className="text-xs text-slate-600">
                Manage your profile & circular-economy leads
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline text-sm text-slate-700 font-medium">
              Hi, {name || "Partner"}
            </span>
            <button
              onClick={logout}
              className="eco-btn-ghost text-sm text-red-600 hover:bg-red-50"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="container-eco py-8 space-y-8">
        {notPartnerRole && (
          <div className="rounded-xl border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-white p-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl">⚠️</span>
              <div className="text-sm text-amber-900">
                Your account is not marked as a <strong>partner</strong> yet. Ask your admin to set <code className="bg-amber-100 px-1.5 py-0.5 rounded">role=&quot;partner&quot;</code> in the database.
              </div>
            </div>
          </div>
        )}

        {/* PROFILE / KYC */}
        <section className="eco-card">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <span>🏪</span>
                Partner Profile
              </h2>
              <p className="text-sm text-slate-600 mt-1">
                We use this to calculate distance and show you relevant repair / recycling leads.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {profileExists && (
                <span className="eco-badge eco-badge-success">
                  Profile saved
                </span>
              )}
              <span
                className={cx(
                  "eco-badge",
                  profile.kyc_status === "verified"
                    ? "eco-badge-success"
                    : profile.kyc_status === "submitted"
                    ? "eco-badge-warning"
                    : "eco-badge-secondary",
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
                  <label className="eco-label">Organisation name *</label>
                  <input
                    className="eco-input"
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
                  <label className="eco-label">Partner type</label>
                  <select
                    className="eco-input"
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
                  <label className="eco-label">Contact phone</label>
                  <input
                    className="eco-input"
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
                  <label className="eco-label">City *</label>
                  <input
                    className="eco-input"
                    value={profile.city}
                    onChange={(e) =>
                      setProfile((p) => ({ ...p, city: e.target.value }))
                    }
                    placeholder="Bengaluru"
                  />
                </div>

                <div className="space-y-1">
                  <label className="eco-label">Address *</label>
                  <textarea
                    className="eco-input min-h-[60px]"
                    value={profile.address}
                    onChange={(e) =>
                      setProfile((p) => ({ ...p, address: e.target.value }))
                    }
                    placeholder="Street, area, landmark"
                  />
                </div>

                <div className="grid grid-cols-3 gap-3 items-end">
                  <div className="space-y-1">
                    <label className="eco-label">Service radius (km)</label>
                    <input
                      className="eco-input"
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
                    <label className="eco-label">Lat</label>
                    <input
                      className="eco-input"
                      value={profile.lat ?? ""}
                      onChange={(e) =>
                        setProfile((p) => ({ ...p, lat: e.target.value }))
                      }
                      placeholder="optional"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="eco-label">Lon</label>
                    <input
                      className="eco-input"
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
                    "eco-btn-primary",
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
        <section className="eco-card">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <span>📋</span>
                Assigned / Nearby Leads
              </h2>
              <p className="text-sm text-slate-600 mt-1">
                Listings where users chose repair / recycle and were routed to
                you.
              </p>
            </div>
            <button
              onClick={loadLeads}
              className="eco-btn-secondary text-xs"
            >
              Refresh
            </button>
          </div>

          {loadingLeads ? (
            <p className="text-sm text-slate-600">Loading leads…</p>
          ) : !Array.isArray(leads) || leads.length === 0 ? (
            <div className="eco-empty-state">
              <div className="text-center text-slate-500">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-50 flex items-center justify-center">
                  <span className="text-3xl">📋</span>
                </div>
                <p className="text-sm font-medium text-slate-700 mb-1">No leads yet</p>
                <p className="text-xs text-slate-500">Once users in your service area choose repair or recycle, they will appear here.</p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-slate-200 text-left text-slate-700 font-semibold">
                    <th className="py-3 pr-4">Device</th>
                    <th className="py-3 pr-4">Intention</th>
                    <th className="py-3 pr-4">City</th>
                    <th className="py-3 pr-4">Suggested price</th>
                    <th className="py-3 pr-4">Status</th>
                    <th className="py-3 pr-4">Created</th>
                    <th className="py-3 pr-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => (
                    <tr
                      key={lead.listing_id}
                      className="border-b border-slate-100 hover:bg-slate-50 align-top transition"
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
                      <td className="py-3 pr-4 space-x-2 whitespace-nowrap">
                        <button
                          className="eco-badge eco-badge-info cursor-pointer hover:bg-blue-100 transition"
                          onClick={() => openChat(lead.listing_id)}
                        >
                          💬 Message
                        </button>
                        <button
                          className="eco-badge eco-badge-warning cursor-pointer hover:bg-amber-100 transition"
                          onClick={() => openOfferModal(lead.listing_id)}
                        >
                          💰 Make Offer
                        </button>
                        <button
                          className="eco-badge eco-badge-success cursor-pointer hover:bg-emerald-100 transition"
                          onClick={() =>
                            updateLead(lead.listing_id, "accept")
                          }
                        >
                          Accept
                        </button>
                        <button
                          className="eco-badge eco-badge-error cursor-pointer hover:bg-red-100 transition"
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

      {/* Chat Modal */}
      {chatModal.open && chatModal.listingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="eco-card max-w-2xl w-full max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4 pb-4 border-b border-slate-200">
              <h3 className="text-lg font-bold text-slate-900">
                💬 Messages - Listing #{chatModal.listingId}
              </h3>
              <button onClick={closeChat} className="text-slate-400 hover:text-slate-600 text-2xl">
                ✕
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto mb-4 space-y-3 min-h-[300px]">
              {messages.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <div className="text-4xl mb-2">💬</div>
                  <p>No messages yet. Start a conversation!</p>
                </div>
              ) : (
                messages.map((msg: any) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.sender_role === "partner" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[70%] rounded-lg p-3 ${
                        msg.sender_role === "partner"
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
            <div className="flex gap-2">
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
      )}

      {/* Offer Modal */}
      {offerModal.open && offerModal.listingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="eco-card max-w-md w-full">
            <div className="flex items-center justify-between mb-4 pb-4 border-b border-slate-200">
              <h3 className="text-lg font-bold text-slate-900">
                💰 {offerModal.currentOffer ? "Update Offer" : "Make Offer"} - Listing #{offerModal.listingId}
              </h3>
              <button onClick={closeOfferModal} className="text-slate-400 hover:text-slate-600 text-2xl">
                ✕
              </button>
            </div>

            <div className="space-y-4">
              {offerModal.currentOffer && offerModal.currentOffer.status === "pending" && (
                <div className="bg-amber-50 border-2 border-amber-200 rounded-lg p-3">
                  <div className="text-sm text-amber-900">
                    ⏳ <strong>Current Offer Status:</strong> Pending user response
                  </div>
                </div>
              )}

              {offerModal.currentOffer && offerModal.currentOffer.status === "accepted" && (
                <div className="bg-emerald-50 border-2 border-emerald-200 rounded-lg p-3">
                  <div className="text-sm text-emerald-900">
                    ✓ <strong>Offer Accepted!</strong> Final price: ₹{offerModal.currentOffer.offer_price}
                  </div>
                </div>
              )}

              {offerModal.currentOffer && offerModal.currentOffer.status === "rejected" && (
                <div className="bg-red-50 border-2 border-red-200 rounded-lg p-3">
                  <div className="text-sm text-red-900">
                    ✗ <strong>Offer Rejected</strong> - You can submit a new offer
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Offer Price (₹) *
                </label>
                <input
                  type="number"
                  value={offerPrice}
                  onChange={(e) => setOfferPrice(e.target.value)}
                  placeholder="Enter your offer price"
                  className="eco-input w-full"
                  disabled={offerModal.currentOffer?.status === "accepted"}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Message (Optional)
                </label>
                <textarea
                  value={offerMessage}
                  onChange={(e) => setOfferMessage(e.target.value)}
                  placeholder="Add a note to the user..."
                  rows={3}
                  className="eco-input w-full"
                  disabled={offerModal.currentOffer?.status === "accepted"}
                />
              </div>

              <div className="flex gap-2">
                <button onClick={closeOfferModal} className="eco-btn-secondary flex-1">
                  Cancel
                </button>
                {offerModal.currentOffer?.status !== "accepted" && (
                  <button
                    onClick={submitOffer}
                    disabled={submittingOffer || !offerPrice}
                    className="eco-btn-primary flex-1"
                  >
                    {submittingOffer ? "Submitting..." : "Submit Offer"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
