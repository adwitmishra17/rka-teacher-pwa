// =========================================================================
// MyDocuments.jsx
//
// Teacher-facing documents screen for the rka-teacher PWA.
//
//  - "Required documents": 7 onboarding slots the teacher uploads themselves
//    (Class 10, Class 12, Graduation, Post-Graduation, B.Ed, Aadhaar, PAN).
//    Upload flow: optimize file → presign-my-document-upload → PUT to R2 →
//    confirm-my-upload. Accepts JPG + PDF; images are optimized client-side.
//  - "Other documents on file": everything the office uploaded for them
//    (appointment letter, etc.), view-only.
//
// Auth: Firebase ID token (auth.currentUser.getIdToken) on every edge call.
// Env: VITE_SUPABASE_FUNCTIONS_URL.
// =========================================================================

import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { auth } from "../firebase/config";
import { optimizeForUpload } from "../lib/optimizeFile";

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL;

// The 7 required slots — keys MUST match confirm-my-upload's SLOTS.
const REQUIRED_SLOTS = [
  { key: "class_10",        label: "Class 10 Marksheet" },
  { key: "class_12",        label: "Class 12 Marksheet" },
  { key: "graduation",      label: "Graduation — Final-Year Marksheet / Degree" },
  { key: "post_graduation", label: "Post-Graduation — Final-Year Marksheet / Degree" },
  { key: "bed",             label: "B.Ed — Final-Year Marksheet / Degree" },
  { key: "aadhaar",         label: "Aadhaar Card" },
  { key: "pan",             label: "PAN Card" },
];
const SLOT_KEYS = new Set(REQUIRED_SLOTS.map((s) => s.key));

const dateFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });

export default function MyDocuments() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [openingId, setOpeningId] = useState(null);
  const [busySlot, setBusySlot] = useState(null);
  const [slotError, setSlotError] = useState({});

  const load = useCallback(async () => {
    setError(null);
    const user = auth.currentUser;
    if (!user) { setError("Not signed in"); setLoading(false); return; }
    async function callOnce() {
      const token = await user.getIdToken(true);
      return fetch(`${FUNCTIONS_URL}/get-my-documents`, { method: "GET", headers: { Authorization: `Bearer ${token}` } });
    }
    try {
      let res;
      try { res = await callOnce(); }
      catch { await new Promise((r) => setTimeout(r, 600)); res = await callOnce(); }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || `Server returned ${res.status}`);
      setDocuments(Array.isArray(data.documents) ? data.documents : []);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Newest doc per slot (confirm-my-upload soft-deletes prior ones, so there's
  // normally just one, but guard anyway).
  const bySlot = {};
  for (const d of documents) {
    if (d.doc_type && SLOT_KEYS.has(d.doc_type)) {
      if (!bySlot[d.doc_type]) bySlot[d.doc_type] = d;
    }
  }
  const others = documents.filter((d) => !d.doc_type || !SLOT_KEYS.has(d.doc_type));
  const uploadedCount = REQUIRED_SLOTS.filter((s) => bySlot[s.key]).length;

  async function handleView(docId) {
    setOpeningId(docId);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Not signed in");
      const token = await user.getIdToken(true);
      const res = await fetch(`${FUNCTIONS_URL}/presign-my-document-download`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: docId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.downloadUrl) throw new Error(data.message || data.error || `Server returned ${res.status}`);
      window.open(data.downloadUrl, "_blank", "noopener,noreferrer");
    } catch (e) {
      alert("Couldn't open document: " + (e.message || String(e)));
    } finally {
      setOpeningId(null);
    }
  }

  async function uploadForSlot(slotKey, file) {
    if (!file) return;
    setBusySlot(slotKey);
    setSlotError((s) => ({ ...s, [slotKey]: null }));
    try {
      const optimized = await optimizeForUpload(file);
      const user = auth.currentUser;
      if (!user) throw new Error("Not signed in");
      const token = await user.getIdToken(true);

      const pres = await fetch(`${FUNCTIONS_URL}/presign-my-document-upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ filename: optimized.name, sizeBytes: optimized.size, mimeType: optimized.type }),
      });
      const pdata = await pres.json().catch(() => ({}));
      if (!pres.ok) throw new Error(pdata.message || pdata.error || `Upload could not start (${pres.status})`);

      const put = await fetch(pdata.uploadUrl, { method: "PUT", headers: pdata.headers || { "Content-Type": optimized.type }, body: optimized });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);

      const conf = await fetch(`${FUNCTIONS_URL}/confirm-my-upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ r2Key: pdata.r2Key, filename: optimized.name, docType: slotKey, sizeBytes: optimized.size, mimeType: optimized.type }),
      });
      const cdata = await conf.json().catch(() => ({}));
      if (!conf.ok) throw new Error(cdata.message || cdata.error || `Could not save (${conf.status})`);

      await load();
    } catch (e) {
      setSlotError((s) => ({ ...s, [slotKey]: e.message || String(e) }));
    } finally {
      setBusySlot(null);
    }
  }

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <Link to="/hrms" style={backLinkStyle}>&larr; Back to HRMS</Link>
        <h1 style={titleStyle}>My Documents</h1>
        <p style={subtitleStyle}>Upload your records once — the office picks them up from here.</p>
      </div>

      {/* Progress */}
      <div style={progressWrap}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "#4b5563", marginBottom: 6 }}>
          <span>Required documents</span>
          <span>{uploadedCount} of {REQUIRED_SLOTS.length} uploaded</span>
        </div>
        <div style={progressTrack}>
          <div style={{ ...progressFill, width: `${(uploadedCount / REQUIRED_SLOTS.length) * 100}%` }} />
        </div>
        <p style={{ fontSize: 11.5, color: "#6b6b6b", margin: "8px 0 0" }}>
          JPG or PDF, up to 8&nbsp;MB. Photos are automatically optimized to save space.
        </p>
      </div>

      {loading && <div style={messageStyle}>Loading…</div>}
      {error && (
        <div style={errorStyle}><strong>Couldn't load documents</strong><div style={{ marginTop: 6, fontSize: 13 }}>{error}</div></div>
      )}

      {!loading && !error && (
        <>
          <ul style={listStyle}>
            {REQUIRED_SLOTS.map((slot) => {
              const doc = bySlot[slot.key];
              const busy = busySlot === slot.key;
              const err = slotError[slot.key];
              return (
                <li key={slot.key} style={{ ...itemStyle, flexDirection: "column", alignItems: "stretch", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={fileNameStyle}>{slot.label}</div>
                      <div style={fileMetaStyle}>
                        {doc
                          ? <span style={{ color: "#0a7d3a" }}>✓ Uploaded {doc.created_at ? dateFmt.format(new Date(doc.created_at)) : ""}</span>
                          : <span style={{ color: "#a15c00" }}>Not uploaded yet</span>}
                      </div>
                    </div>
                    {doc && (
                      <button onClick={() => handleView(doc.id)} disabled={openingId === doc.id}
                        style={{ ...viewButtonStyle, background: "#fff", color: "#1a4a2e", border: "1px solid #1a4a2e" }}>
                        {openingId === doc.id ? "Opening…" : "View"}
                      </button>
                    )}
                    <label style={{ ...viewButtonStyle, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.6 : 1 }}>
                      {busy ? "Uploading…" : doc ? "Replace" : "Upload"}
                      <input type="file" accept=".jpg,.jpeg,.pdf,image/jpeg,application/pdf" disabled={busy}
                        style={{ display: "none" }}
                        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; uploadForSlot(slot.key, f); }} />
                    </label>
                  </div>
                  {err && <div style={{ fontSize: 12, color: "#8b1a1a" }}>{err}</div>}
                </li>
              );
            })}
          </ul>

          {others.length > 0 && (
            <>
              <h2 style={sectionHeadingStyle}>Other documents on file</h2>
              <ul style={listStyle}>
                {others.map((d) => (
                  <li key={d.id} style={itemStyle}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={fileNameStyle} title={d.filename}>{d.filename}</div>
                      {d.created_at && <div style={fileMetaStyle}>Uploaded {dateFmt.format(new Date(d.created_at))}</div>}
                    </div>
                    <button onClick={() => handleView(d.id)} disabled={openingId === d.id}
                      style={{ ...viewButtonStyle, opacity: openingId === d.id ? 0.6 : 1, cursor: openingId === d.id ? "wait" : "pointer" }}>
                      {openingId === d.id ? "Opening…" : "View"}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---- inline styles ----
const containerStyle = { maxWidth: 600, margin: "0 auto", padding: "16px 16px 80px" };
const headerStyle = { marginBottom: 16 };
const backLinkStyle = { display: "inline-block", fontSize: 13, color: "#1a4a2e", textDecoration: "none", marginBottom: 12 };
const titleStyle = { fontFamily: "'Playfair Display', serif", fontSize: 28, fontWeight: 600, color: "#1a4a2e", margin: "0 0 4px 0", lineHeight: 1.2 };
const subtitleStyle = { fontSize: 13, color: "#6b6b6b", margin: 0 };
const progressWrap = { background: "#fff", border: "1px solid #e8e6dc", borderRadius: 8, padding: "14px 16px", marginBottom: 16 };
const progressTrack = { height: 8, borderRadius: 999, background: "#eceadf", overflow: "hidden" };
const progressFill = { height: "100%", borderRadius: 999, background: "#1a4a2e", transition: "width .3s ease" };
const sectionHeadingStyle = { fontSize: 13, fontWeight: 700, color: "#6b6b6b", textTransform: "uppercase", letterSpacing: ".04em", margin: "22px 0 10px" };
const messageStyle = { padding: "32px 16px", textAlign: "center", color: "#6b6b6b", fontSize: 14, background: "#fafaf7", border: "1px solid #e8e6dc", borderRadius: 8 };
const errorStyle = { padding: "16px", color: "#8b1a1a", background: "#fdecec", border: "1px solid #f5c7c7", borderRadius: 8, fontSize: 14 };
const listStyle = { listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 };
const itemStyle = { display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: "#fff", border: "1px solid #e8e6dc", borderRadius: 8 };
const fileNameStyle = { fontSize: 14, fontWeight: 500, color: "#1f2937", overflow: "hidden", textOverflow: "ellipsis" };
const fileMetaStyle = { fontSize: 11.5, color: "#6b6b6b", marginTop: 4 };
const viewButtonStyle = { background: "#1a4a2e", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap" };
