// =========================================================================
// MyAttendance.jsx
//
// Teacher-facing attendance view for the rka-teacher PWA.
//
// Calls the Supabase Edge Function `get-my-attendance` with the current
// user's Firebase ID token, then renders:
//   - The employee's RESOLVED reporting time (custom → department → branch,
//     as configured in HRMS)
//   - A "Today" card (first IN, last OUT, status pill, late marker)
//   - A month picker (current + previous 2 months) with one row per date,
//     each showing arrival/leave and the day's expected time + late minutes
//     snapshotted by HRMS (attendance_daily).
// =========================================================================

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { auth } from "../firebase/config";
import "./MyAttendance.css";

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL;

// India is the only TZ this school operates in. We deliberately compute
// "today" and per-day grouping in IST regardless of the device's TZ.
const IST_TZ = "Asia/Kolkata";

const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: IST_TZ, year: "numeric", month: "2-digit", day: "2-digit",
}); // "YYYY-MM-DD"

const timeFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST_TZ, hour: "numeric", minute: "2-digit", hour12: true,
});

const dayLabelFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST_TZ, weekday: "short", day: "numeric", month: "short",
});

const monthLabelFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST_TZ, month: "short", year: "numeric",
});

function dayKey(date) { return dayKeyFmt.format(date); }
function todayKey() { return dayKey(new Date()); }

// "07:45:00" (HRMS time column) → "7:45 am"
function fmtTimeStr(t) {
  if (!t) return null;
  const [h, m] = String(t).split(":").map(Number);
  if (Number.isNaN(h)) return null;
  const ampm = h >= 12 ? "pm" : "am";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m).padStart(2, "0")} ${ampm}`;
}

// The three selectable months: current + previous two, newest first.
function monthChoices() {
  const [y, m] = todayKey().split("-").map(Number);
  const out = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const yy = d.getUTCFullYear();
    const mm = d.getUTCMonth() + 1;
    out.push({
      key: `${yy}-${String(mm).padStart(2, "0")}`,
      label: monthLabelFmt.format(new Date(yy, mm - 1, 15)),
    });
  }
  return out;
}

// IST range for a "YYYY-MM" month; the current month is capped at today.
function monthRange(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const from = `${monthKey}-01T00:00:00+05:30`;
  const today = todayKey();
  const endDay = today.startsWith(monthKey) ? today : `${monthKey}-${String(lastDay).padStart(2, "0")}`;
  const to = `${endDay}T23:59:59+05:30`;
  return { from, to };
}

function groupEventsByDay(events) {
  const map = new Map();
  for (const evt of events) {
    const k = dayKey(new Date(evt.event_time));
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(evt);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => new Date(a.event_time) - new Date(b.event_time));
  }
  return map;
}

function buildDayList(fromIso, toIso) {
  const days = [];
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  while (cursor <= to) {
    days.push(dayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function summariseDay(events) {
  if (!events || events.length === 0) {
    return { status: "no-record", inAt: null, outAt: null, count: 0 };
  }
  if (events.length === 1) {
    return { status: "single-punch", inAt: events[0].event_time, outAt: null, count: 1 };
  }
  return {
    status: "present",
    inAt: events[0].event_time,
    outAt: events[events.length - 1].event_time,
    count: events.length,
  };
}

function StatusPill({ status }) {
  const label = {
    present: "Present",
    "single-punch": "One punch",
    "no-record": "No record",
  }[status];
  return <span className={`rka-pill rka-pill--${status}`}>{label}</span>;
}

function BackToHub() {
  return (
    <Link to="/hrms" className="rka-attendance__back">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
      Back to HRMS
    </Link>
  );
}

export default function MyAttendance() {
  const months = useMemo(monthChoices, []);
  const [month, setMonth] = useState(months[0].key);
  const [state, setState] = useState({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState((s) => (s.kind === "ready" ? { ...s, refreshing: true } : { kind: "loading" }));
      try {
        const user = auth.currentUser;
        if (!user) {
          if (!cancelled) setState({ kind: "signed-out" });
          return;
        }

        const { from, to } = monthRange(month);
        const qs = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

        async function callOnce() {
          const token = await user.getIdToken(/* forceRefresh */ true);
          return fetch(`${FUNCTIONS_URL}/get-my-attendance${qs}`, {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
          });
        }

        let res;
        try {
          res = await callOnce();
        } catch (err) {
          console.warn('get-my-attendance first attempt failed, retrying:', err?.message);
          await new Promise(r => setTimeout(r, 600));
          res = await callOnce();
        }

        const body = await res.json();

        if (!res.ok) {
          if (res.status === 404 && body.error === "no_linked_staff") {
            if (!cancelled) setState({ kind: "not-linked", email: body.email });
            return;
          }
          if (!cancelled) {
            setState({ kind: "error", message: body.message || `Request failed (${res.status}).` });
          }
          return;
        }

        if (!cancelled) setState({ kind: "ready", data: body });
      } catch (err) {
        console.error('get-my-attendance failed permanently:', err);
        if (!cancelled) {
          setState({
            kind: "error",
            message: err?.message ?? "Couldn't reach the server. Check your connection and try again.",
          });
        }
      }
    }

    const unsub = auth.onAuthStateChanged(() => load());
    return () => { cancelled = true; unsub(); };
  }, [month]);

  if (state.kind === "loading") {
    return (
      <main className="rka-attendance">
        <BackToHub />
        <div className="rka-attendance__skeleton" aria-hidden="true">
          <div className="rka-attendance__skeleton-card" />
          <div className="rka-attendance__skeleton-row" />
          <div className="rka-attendance__skeleton-row" />
          <div className="rka-attendance__skeleton-row" />
        </div>
        <p className="rka-attendance__loading-label">Loading your attendance…</p>
      </main>
    );
  }

  if (state.kind === "signed-out") {
    return (
      <main className="rka-attendance">
        <BackToHub />
        <EmptyState title="Please sign in"
          message="You need to sign in with your Google account to view attendance." />
      </main>
    );
  }

  if (state.kind === "not-linked") {
    return (
      <main className="rka-attendance">
        <BackToHub />
        <EmptyState title="Account not yet linked"
          message={<>Your sign-in email <strong>{state.email}</strong> isn't linked to a staff record yet.
            Please ask the school admin to link it in the HRMS, then refresh this page.</>} />
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="rka-attendance">
        <BackToHub />
        <EmptyState title="Couldn't load attendance" message={state.message} tone="error" />
      </main>
    );
  }

  return (
    <AttendanceView
      data={state.data}
      months={months}
      month={month}
      onMonth={setMonth}
      refreshing={Boolean(state.refreshing)}
    />
  );
}

function AttendanceView({ data, months, month, onMonth, refreshing }) {
  const { employee, range, events, daily, reporting } = data;

  const grouped = useMemo(() => groupEventsByDay(events), [events]);
  const dailyByDate = useMemo(() => {
    const m = new Map();
    for (const d of daily ?? []) m.set(d.date, d);
    return m;
  }, [daily]);
  const days = useMemo(() => buildDayList(range.from, range.to), [range.from, range.to]);

  const today = todayKey();
  const isCurrentMonth = today.startsWith(month);
  const todayEvents = grouped.get(today) ?? [];
  const todaySummary = summariseDay(todayEvents);
  const todayDaily = dailyByDate.get(today);

  const reversedDays = [...days].reverse();

  // Month roll-up: worked days + how many were late (per HRMS's own math).
  const monthStats = useMemo(() => {
    let worked = 0, late = 0;
    for (const k of days) {
      const evts = grouped.get(k) ?? [];
      const d = dailyByDate.get(k);
      if (evts.length > 0 || (d && d.in_time)) worked++;
      if (d && Number(d.late_minutes) > 0) late++;
    }
    return { worked, late };
  }, [days, grouped, dailyByDate]);

  return (
    <main className="rka-attendance">
      <BackToHub />
      <header className="rka-attendance__header">
        <p className="rka-attendance__eyebrow">My Attendance</p>
        <h1 className="rka-attendance__name">{employee.name}</h1>
        <p className="rka-attendance__staff-id">
          Biometric ID: <span>{employee.biometric_code ?? "—"}</span>
          {reporting?.in_time && (
            <>
              <br />
              Reporting time:{" "}
              <span>
                {fmtTimeStr(reporting.in_time)}
                {reporting.out_time ? ` – ${fmtTimeStr(reporting.out_time)}` : ""}
              </span>
              {Number(reporting.grace_minutes) > 0 && <> · grace {reporting.grace_minutes} min</>}
            </>
          )}
          <br />
          <small>If this isn't you, contact admin.</small>
        </p>
      </header>

      {isCurrentMonth && (
        <section className="rka-today" aria-labelledby="today-heading">
          <div className="rka-today__top">
            <h2 id="today-heading" className="rka-today__title">Today</h2>
            <StatusPill status={todaySummary.status} />
          </div>
          <p className="rka-today__date">{dayLabelFmt.format(new Date())}</p>
          <div className="rka-today__times">
            <div className="rka-today__time">
              <span className="rka-today__label">In</span>
              <span className="rka-today__value">
                {todaySummary.inAt ? timeFmt.format(new Date(todaySummary.inAt)) : "—"}
              </span>
            </div>
            <div className="rka-today__divider" aria-hidden="true" />
            <div className="rka-today__time">
              <span className="rka-today__label">Out</span>
              <span className="rka-today__value">
                {todaySummary.outAt ? timeFmt.format(new Date(todaySummary.outAt)) : "—"}
              </span>
            </div>
          </div>
          {todayDaily && Number(todayDaily.late_minutes) > 0 && (
            <p className="rka-today__extra" style={{ color: "#8b1a1a" }}>
              Late by {todayDaily.late_minutes} min (due {fmtTimeStr(todayDaily.expected_in_time)})
            </p>
          )}
          {todaySummary.count > 2 && (
            <p className="rka-today__extra">{todaySummary.count} punches recorded today</p>
          )}
        </section>
      )}

      <section className="rka-history" aria-labelledby="history-heading">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <h2 id="history-heading" className="rka-history__title" style={{ margin: 0 }}>Arrival times</h2>
          <div style={{ display: "flex", gap: 6 }}>
            {months.map((m) => (
              <button key={m.key} onClick={() => onMonth(m.key)}
                style={{
                  padding: "6px 12px", borderRadius: 16, fontSize: 12, fontWeight: 600,
                  cursor: "pointer", transition: "all .15s",
                  border: `1px solid ${month === m.key ? "var(--green,#1a4a2e)" : "#d7dcd8"}`,
                  background: month === m.key ? "var(--green,#1a4a2e)" : "#fff",
                  color: month === m.key ? "#fff" : "#556",
                }}>
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <p style={{ fontSize: 12, color: "#667", margin: "6px 0 10px" }}>
          {refreshing ? "Loading…" : `${monthStats.worked} day${monthStats.worked === 1 ? "" : "s"} recorded` +
            (monthStats.late ? ` · late on ${monthStats.late}` : "")}
        </p>
        <ol className="rka-history__list" style={{ opacity: refreshing ? 0.5 : 1 }}>
          {reversedDays.map((k) => {
            const dayEvents = grouped.get(k) ?? [];
            const summary = summariseDay(dayEvents);
            const d = dailyByDate.get(k);
            const isToday = k === today;
            const late = d && Number(d.late_minutes) > 0;
            return (
              <li key={k} className={`rka-day ${isToday ? "rka-day--today" : ""}`}>
                <div className="rka-day__date">
                  <span className="rka-day__date-main">
                    {dayLabelFmt.format(new Date(k + "T12:00:00"))}
                  </span>
                  {isToday && <span className="rka-day__today-tag">Today</span>}
                  {d?.is_holiday && <span className="rka-day__today-tag" style={{ background: "#eef2ee", color: "#556" }}>Holiday</span>}
                </div>
                <div className="rka-day__times">
                  {summary.status === "no-record" && !(d && d.in_time) ? (
                    <span className="rka-day__no-record">No record</span>
                  ) : (
                    <>
                      <span className="rka-day__time">
                        {summary.inAt ? timeFmt.format(new Date(summary.inAt))
                          : (d?.in_time ? fmtTimeStr(d.in_time) : "—")}
                      </span>
                      <span className="rka-day__arrow" aria-hidden="true">→</span>
                      <span className="rka-day__time">
                        {summary.outAt ? timeFmt.format(new Date(summary.outAt))
                          : (d?.out_time ? fmtTimeStr(d.out_time) : "—")}
                      </span>
                      {late && (
                        <span style={{
                          marginLeft: 8, fontSize: 11, fontWeight: 700, color: "#8b1a1a",
                          background: "#fdeaea", padding: "2px 8px", borderRadius: 10, whiteSpace: "nowrap",
                        }}>
                          Late {d.late_minutes}m
                        </span>
                      )}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <p className="rka-attendance__footer">
        Showing {dayLabelFmt.format(new Date(range.from))} – {dayLabelFmt.format(new Date(range.to))}.
        Records are based on biometric punches; the expected reporting time comes from HRMS.
        Talk to admin if anything looks wrong.
      </p>
    </main>
  );
}

function EmptyState({ title, message, tone = "neutral" }) {
  return (
    <div className={`rka-empty rka-empty--${tone}`}>
      <h2 className="rka-empty__title">{title}</h2>
      <p className="rka-empty__message">{message}</p>
    </div>
  );
}
