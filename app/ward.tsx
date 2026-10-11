"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";
import Link from "next/link";
import WardCanvas from "./ward-canvas";
import {
  ArrowRight,
  Activity,
  Clock3,
  Pause,
  Play,
  Send,
  Mic,
  Square,
  Check,
  ShieldCheck,
  Users,
  AlertCircle,
} from "lucide-react";
import type { Ward as State, Role, Command } from "@/lib/domain";
type Snapshot = State & {
  adapter: "fixture" | "live";
  tracingConfigured: boolean;
};
type SpeechResult = { results: ArrayLike<ArrayLike<{ transcript: string }>> };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechResult) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};
declare global {
  interface Window {
    webkitSpeechRecognition?: new () => Recognition;
    SpeechRecognition?: new () => Recognition;
    turnstile?: {
      render: (
        el: string,
        opts: { sitekey: string; callback: (token: string) => void },
      ) => void;
    };
  }
}
const clock = (at: number) =>
  new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  }).format(at);
const roleNames: Record<Role, string> = {
  nurse: "Nurse",
  porter: "Porter",
  receiving: "Receiving team",
  coordinator: "Coordinator",
};
const phases = [
  "DRAFT",
  "CONFIRMED",
  "READY",
  "OFFERING",
  "ASSIGNED",
  "COLLECTED",
  "ARRIVED",
  "COMPLETED",
];
export default function Ward() {
  const [ward, setWard] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [text, setText] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [started, setStarted] = useState(false),
    [captcha, setCaptcha] = useState(""),
    [listening, setListening] = useState(false),
    [voice, setVoice] = useState(false),
    [realNow, setRealNow] = useState(0),
    [view, setView] = useState<"map" | "list">("map"),
    [panelOpen, setPanelOpen] = useState(false),
    [voiceOpen, setVoiceOpen] = useState(false),
    [lastSynced, setLastSynced] = useState(0),
    [queueFilter, setQueueFilter] = useState<"all" | "attention">("all");
  const recognition = useRef<Recognition | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/ward", { cache: "no-store" });
      if (r.ok) {
        setWard(await r.json());
        setStarted(true);
        setRealNow(Date.now());
        setLastSynced(Date.now());
      } else if (r.status === 410 || r.status === 401) {
        setStarted(false);
        setWard(null);
      }
    } catch {
      setError("Connection lost. Your last confirmed state is retained.");
    }
  }, []);
  useEffect(() => {
    const initial = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), 2000);
    const freshness = setInterval(() => setRealNow(Date.now()), 1000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
      clearInterval(freshness);
    };
  }, [load]);
  async function post(path: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      });
      const result = await r.json();
      if (!r.ok || result.rejected)
        throw new Error(result.message || "Action rejected");
      await load();
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      return null;
    } finally {
      setBusy(false);
    }
  }
  const t =
    selected === "new"
      ? null
      : ward?.transfers.find((t) => t.id === selected) ||
        ward?.transfers.at(-1) ||
        null;
  async function act(
    type: Command["type"],
    payload: Record<string, unknown> = {},
  ) {
    if (t)
      await post(`transfers/${t.id}/commands`, {
        type,
        expectedRevision: t.revision,
        payload,
      });
  }
  async function send() {
    if (!text.trim()) return;
    const result = await post(t ? "staff-messages" : "messages", {
      text: text.trim(),
      transferId: t?.id || null,
    });
    if (result) {
      setText("");
      setPanelOpen(true);
      if (selected === "new") setSelected(null);
    }
  }
  function microphone() {
    const Constructor =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Constructor) {
      setError(
        "Speech recognition is unavailable in this browser. Text works fully.",
      );
      return;
    }
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const rec = new Constructor();
    rec.lang = "en-IN";
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (e) => setText(e.results[0][0].transcript);
    rec.onend = () => setListening(false);
    rec.onerror = () => {
      setListening(false);
      setError("Microphone unavailable. Type your request instead.");
    };
    recognition.current = rec;
    setListening(true);
    rec.start();
  }
  const lastSummary = ward?.runs
    .filter((r) => r.status === "done")
    .at(-1)?.summary;
  useEffect(() => {
    if (voice && lastSummary && "speechSynthesis" in window) {
      speechSynthesis.cancel();
      speechSynthesis.speak(new SpeechSynthesisUtterance(lastSummary));
    }
    return () => {
      if ("speechSynthesis" in window) speechSynthesis.cancel();
    };
  }, [voice, lastSummary]);
  const sitekey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  if (!started || !ward)
    return (
      <main className="welcome">
        <div className="wordmark">
          <span className="brand-icon">
            <Activity size={22} />
          </span>
          Hemline
        </div>
        <div className="welcome-grid">
          <section>
            <p className="eyebrow">PATIENT TRANSPORT, COORDINATED</p>
            <h1>
              Patient transport.
              <br />
              Less chasing.
              <br />
              <span>Clear next steps.</span>
            </h1>
            <p className="intro">
              Hemline helps nurses, porters, and receiving teams arrange patient
              transport. Ask for a transfer, confirm readiness, and see who is
              responsible at each step—from pickup to confirmed arrival.
            </p>
            <button
              className="primary"
              disabled={busy || (!!sitekey && !captcha)}
              onClick={() =>
                void post("sandbox", { captchaToken: captcha || null })
              }
            >
              Open Hemline <ArrowRight size={18} />
            </button>
            {sitekey && (
              <>
                <Script
                  src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
                  onLoad={() =>
                    window.turnstile?.render("#captcha", {
                      sitekey,
                      callback: setCaptcha,
                    })
                  }
                />
                <div id="captcha" />
              </>
            )}
            <p className="fine">
              Try “Arrange transport for Bed 18 to Radiology.” Patient records
              are fictional; do not enter real patient information.
            </p>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
          </section>
          <section className="preview">
            <div className="preview-top">
              <span className="live-dot" />
              HOW HEMLINE WORKS
            </div>
            <h2>Ask. Confirm. Track.</h2>
            {[
              [
                "01",
                "Understand",
                "Tell Hemline who needs transport and where they need to go.",
              ],
              [
                "02",
                "Coordinate",
                "Confirm the patient and destination are ready. Hemline offers the request to an available porter.",
              ],
              [
                "03",
                "Recover",
                "If a porter declines or a destination is delayed, Hemline helps arrange the next step.",
              ],
              [
                "04",
                "Verify",
                "Track pickup and arrival. The receiving team confirms receipt before the transfer is complete.",
              ],
            ].map(([n, title, description]) => (
              <div className="preview-step" key={n}>
                <span>{n}</span>
                <div>
                  <strong>{title}</strong>
                  <p>{description}</p>
                </div>
              </div>
            ))}
            <div className="preview-footer">
              <ShieldCheck size={18} /> Staff confirm the decisions. Hemline
              keeps everyone informed.
            </div>
          </section>
        </div>
      </main>
    );
  const patient = t ? ward.patients.find((p) => p.id === t.patientId) : null;
  const destinationName = t?.destinationName || "Radiology";
  const destination =
    destinationName === "CT" ? ward?.ctDestination : ward?.destination;
  return (
    <div className="hemline-live" data-view={view}>
      <WardCanvas
        onAttention={(attention) => {
          setQueueFilter(attention ? "attention" : "all");
          setView("list");
        }}
        ward={ward}
        transfer={t}
        onSelect={(id) => {
          const p = ward.patients.find((p) => p.id === id)!;
          const tr = ward.transfers.find(
            (t) =>
              t.patientId === id &&
              t.control !== "CANCELLED" &&
              t.phase !== "COMPLETED",
          );
          if (tr) setSelected(tr.id);
          else {
            setSelected("new");
            setVoiceOpen(true);
            setText(
              `Arrange an approved transfer for ${p.name}, encounter ${p.id}, Bed ${p.bed}, to radiology.`,
            );
          }
          setPanelOpen(true);
        }}
      />
      <header className="live-header">
        <Link className="live-brand" href="/" aria-label="Hemline home">
          <Activity size={22} /> Hemline
        </Link>
        <div className="ward-title">Patient transport</div>
        <div className="header-controls">
          <span className="live-pill">
            <i /> {ward.paused ? "CLOCK PAUSED" : "LIVE"}
          </span>
          <span
            className={`sync-age ${realNow - lastSynced > 10000 ? "stale" : ""}`}
            role="status"
          >
            {realNow - lastSynced > 10000 ? "Data stale" : "Synced"}{" "}
            {Math.max(0, Math.floor((realNow - lastSynced) / 1000))}s ago
          </span>
          <span className="header-time">{clock(ward.now)} IST</span>
          <label className="sr-only" htmlFor="role">
            Acting as
          </label>
          <select
            id="role"
            value={ward.role}
            disabled={busy}
            onChange={(e) =>
              void post("sandbox/role", {
                role: e.target.value,
                takeover: ward.mode === "guided",
              })
            }
          >
            {Object.entries(roleNames).map(([r, n]) => (
              <option value={r} key={r}>
                {n}
              </option>
            ))}
          </select>
          <details className="settings-popover">
            <summary aria-label="Session controls">
              <Clock3 size={18} />
            </summary>
            <div className="settings-body">
              <h2>Session controls</h2>
              <label htmlFor="mode">Staff playback</label>
              <select
                id="mode"
                aria-label="Session mode"
                value={ward.mode}
                onChange={(e) =>
                  void post("sandbox/playback", { mode: e.target.value })
                }
              >
                <option value="manual">Manual exploration</option>
                <option value="guided">Guided staff playback</option>
              </select>
              <button
                className="secondary"
                aria-label={
                  ward.paused ? "Resume simulation" : "Pause simulation"
                }
                onClick={() =>
                  void post("sandbox/playback", { paused: !ward.paused })
                }
              >
                {ward.paused ? <Play size={15} /> : <Pause size={15} />}{" "}
                {ward.paused ? "Resume simulation" : "Pause simulation"}
              </button>
              <div className="clock-steps">
                {[15, 30, 60].map((n) => (
                  <button
                    className="secondary"
                    key={n}
                    onClick={() =>
                      void post("sandbox/playback", { advance: n })
                    }
                  >
                    +{n} sec
                  </button>
                ))}
              </div>
              <label htmlFor="scenario">Explore a setback</label>
              <select
                id="scenario"
                aria-label="Failure scenario"
                value={ward.scenario}
                onChange={(e) =>
                  void post("scenarios", { scenario: e.target.value })
                }
              >
                <option value="standard">Standard transfer</option>
                <option value="rejection">First porter rejects</option>
                <option value="missing_readiness">Missing equipment</option>
                <option value="destination_delay">Destination delayed</option>
                <option value="timeout">Porter does not respond</option>
                <option value="stale_availability">
                  Porter availability changed
                </option>
                <option value="ambiguous_patient">
                  Ambiguous patient reference
                </option>
              </select>
              <p>
                Switching roles in guided mode takes that role over from
                simulated staff.
              </p>
              <p>
                {ward.adapter === "live" ? "Live model" : "Scripted fixture"} ·{" "}
                {ward.tracingConfigured
                  ? "neatlogs configured"
                  : "Tracing unavailable"}
              </p>
              <p>
                Usage ${ward.cost.toFixed(3)} · expires in{" "}
                {Math.max(0, Math.ceil((ward.expiresAt - realNow) / 60000))} min
              </p>
            </div>
          </details>
        </div>
      </header>
      <h1 className="sr-only">Hemline patient transport</h1>
      <nav className="live-rail" aria-label="Hemline navigation">
        <button
          aria-label="Map"
          aria-pressed={view === "map"}
          onClick={() => setView("map")}
        >
          <Activity size={19} />
          <span>Map</span>
        </button>
        <button
          aria-label="Transfers"
          aria-pressed={view === "list"}
          onClick={() => (
            setQueueFilter("all"),
            setView(view === "list" ? "map" : "list")
          )}
        >
          <Users size={19} />
          <span>Transfers</span>
        </button>
        <button
          aria-label="New request"
          onClick={() => {
            setSelected("new");
            setVoiceOpen(true);
            setPanelOpen(true);
            setText("Arrange an approved transfer from Bed 18 to radiology.");
          }}
        >
          <Send size={19} />
          <span>Request</span>
        </button>
      </nav>
      {error && (
        <div className="live-error" role="alert">
          <AlertCircle size={17} />
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      {view === "list" && (
        <section className="transfer-drawer" aria-label="Transfer history">
          <div className="panel-heading">
            <h2>
              {queueFilter === "attention"
                ? "Attention queue"
                : "Transfers & history"}
            </h2>
            <button
              aria-label="Close transfer history"
              onClick={() => setView("map")}
            >
              ×
            </button>
          </div>
          {ward.transfers.length ? (
            ward.transfers
              .filter(
                (tr) =>
                  queueFilter === "all" ||
                  (tr.control !== "CANCELLED" &&
                    tr.phase !== "COMPLETED" &&
                    (tr.control !== "ACTIVE" ||
                      tr.phase === "DRAFT" ||
                      (tr.pickupDue !== null &&
                        tr.pickupDue < ward.now &&
                        tr.phase === "ASSIGNED"))),
              )
              .map((tr) => (
                <button
                  className="history-transfer"
                  key={tr.id}
                  onClick={() => {
                    setSelected(tr.id);
                    setPanelOpen(true);
                    setView("map");
                  }}
                >
                  <b>
                    Bed {ward.patients.find((p) => p.id === tr.patientId)?.bed}{" "}
                    · {tr.id.slice(0, 8)}
                  </b>
                  <span>
                    {tr.phase} · {tr.control}
                  </span>
                  <small>{tr.nextAction}</small>
                  <small>
                    Owner: {roleNames[tr.owner]} · Pickup{" "}
                    {tr.pickupDue
                      ? `due ${clock(tr.pickupDue)} (simulation)`
                      : "not scheduled"}
                  </small>
                </button>
              ))
          ) : (
            <p>No transfers yet. Select a bed to start.</p>
          )}
          <h3>Recorded activity</h3>
          {ward.events
            .slice(-15)
            .reverse()
            .map((e) => (
              <div className="history-event" key={e.id}>
                <time>{clock(e.at)}</time>
                <p>
                  {e.text}
                  <small>
                    {e.actor} · {e.source} · r{e.revision}
                  </small>
                </p>
              </div>
            ))}
        </section>
      )}
      {panelOpen && (
        <aside
          className="patient-panel"
          aria-label="Selected patient and staff actions"
        >
          <div className="panel-heading">
            <span className="eyebrow">
              {t
                ? `BED ${patient?.bed} / ${destinationName.toUpperCase()} · r${t.revision}`
                : "NEW TRANSFER"}
            </span>
            <button
              aria-label="Close patient panel"
              onClick={() => setPanelOpen(false)}
            >
              ×
            </button>
          </div>
          {t ? (
            <>
              <div className="patient-title">
                <h2>{patient?.name}</h2>
                <span
                  className={`badge ${t.control !== "ACTIVE" ? "warning" : ""}`}
                >
                  {t.control !== "ACTIVE" ? t.control : t.phase}
                </span>
              </div>
              <div className="focus-progress">
                {["READY", "ASSIGNED", "COLLECTED", "COMPLETED"].map((p) => (
                  <span
                    key={p}
                    className={
                      phases.indexOf(t.phase) >= phases.indexOf(p)
                        ? "reached"
                        : ""
                    }
                  >
                    <i />
                    {p === "COMPLETED"
                      ? "Handoff"
                      : p.charAt(0) + p.slice(1).toLowerCase()}
                  </span>
                ))}
              </div>
              <p className="focus-next">{t.nextAction}</p>
              <p className="fine">
                Transfer {t.id.slice(0, 8)} ·{" "}
                {t.pickupDue
                  ? `Pickup due ${clock(t.pickupDue)} simulation time`
                  : "Pickup not scheduled"}{" "}
                · ETA unavailable
              </p>
              <p className="fine">Next action owner · {roleNames[t.owner]}</p>
              <div className="requirements">
                {t.requirements.map((r) => (
                  <span
                    className={t.confirmations[r] ? "confirmed" : "unconfirmed"}
                    key={r}
                  >
                    {t.confirmations[r] ? (
                      <Check size={12} />
                    ) : (
                      <Clock3 size={12} />
                    )}{" "}
                    {r === "nurse" ? "Patient" : r}
                  </span>
                ))}
              </div>
              <details className="readiness-audit">
                <summary>Readiness evidence</summary>
                {t.requirements.map((r) => {
                  const ev = t.readinessEvidence?.[r];
                  return (
                    <p key={r}>
                      <b>
                        {r === "nurse" ? "Patient readiness" : r} —{" "}
                        {t.confirmations[r] ? "confirmed" : "not confirmed"}
                      </b>
                      <small>
                        {ev
                          ? `${roleNames[ev.actor as Role] || ev.actor} · ${ev.source} · ${clock(ev.at)} simulation · r${ev.revision}`
                          : "Source timestamp unavailable in this older record"}
                      </small>
                    </p>
                  );
                })}
              </details>
              {t.phase === "ARRIVED" && (
                <p className="handoff-receipt">
                  Arrived at {destinationName}. Receiving team acknowledgement
                  still required. Transport is not complete.
                </p>
              )}
              {t.phase === "COMPLETED" && (
                <p className="handoff-receipt">
                  Handoff accepted by receiving team
                  {t.handoffEvidence
                    ? ` at ${clock(t.handoffEvidence.at)} simulation · ${t.handoffEvidence.source}`
                    : " · see recorded activity"}
                  .
                </p>
              )}
              {t.control === "ESCALATED" && (
                <p className="recovery-hint">
                  Pause the clock. Coordinator resumes this transfer before
                  staff can update readiness.
                </p>
              )}
            </>
          ) : (
            <>
              <h2>Start with Bed 18.</h2>
              <p className="fine">
                Describe a transfer in the voice dock. Hemline resolves the
                patient and asks you to confirm.
              </p>
              <button
                className="secondary"
                onClick={() =>
                  setText(
                    "Arrange an approved transfer from Bed 18 to radiology.",
                  )
                }
              >
                Prepare a transfer request
              </button>
            </>
          )}
          {t && t.phase !== "COMPLETED" && t.control !== "CANCELLED" && (
            <div className="staff-actions">
              <h3>Your actions</h3>
              {ward.role === "nurse" && (
                <>
                  {t.phase === "DRAFT" && (
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => void act("CONFIRM_REQUEST")}
                    >
                      Confirm patient & request <Check size={16} />
                    </button>
                  )}
                  {t.phase !== "DRAFT" &&
                    t.requirements
                      .filter((r) => r !== "receiving" && !t.confirmations[r])
                      .map((r) => (
                        <button
                          className="secondary"
                          key={r}
                          disabled={busy}
                          onClick={() =>
                            void act("CONFIRM_READINESS", { requirement: r })
                          }
                        >
                          Confirm {r === "nurse" ? "patient readiness" : r}
                        </button>
                      ))}
                  {t.control === "PAUSED" &&
                    destination &&
                    t.destinationRevision !== destination.revision && (
                      <button
                        className="secondary"
                        onClick={() =>
                          void act("CONFIRM_RESCHEDULE", {
                            appointment: Math.max(
                              destination!.availableAfter,
                              ward.now + 600000,
                            ),
                          })
                        }
                      >
                        Approve revised receiving window
                      </button>
                    )}
                  <button
                    className="text-button danger"
                    onClick={() => {
                      if (
                        confirm(
                          "Request cancellation? Accepted transport requires acknowledgement.",
                        )
                      )
                        void act("CANCEL");
                    }}
                  >
                    Request cancellation
                  </button>
                </>
              )}
              {ward.role === "porter" && (
                <>
                  {t.offer?.status === "pending" && (
                    <>
                      <button
                        className="primary"
                        onClick={() =>
                          void act("ACCEPT", { offerId: t.offer?.id })
                        }
                      >
                        Accept offer
                      </button>
                      <button
                        className="secondary"
                        onClick={() =>
                          void act("REJECT", { offerId: t.offer?.id })
                        }
                      >
                        Decline offer
                      </button>
                    </>
                  )}
                  {t.phase === "ASSIGNED" && t.control === "ACTIVE" && (
                    <button
                      className="primary"
                      onClick={() => void act("COLLECT")}
                    >
                      Confirm patient collected
                    </button>
                  )}
                  {t.phase === "COLLECTED" && (
                    <button
                      className="primary"
                      onClick={() => void act("ARRIVE")}
                    >
                      Confirm arrival at destination
                    </button>
                  )}
                  {t.control === "CANCELLING" && (
                    <button
                      className="primary"
                      onClick={() => void act("ACK_CANCEL")}
                    >
                      Acknowledge cancellation
                    </button>
                  )}
                </>
              )}
              {ward.role === "receiving" && (
                <>
                  {!t.confirmations.receiving && t.phase !== "DRAFT" && (
                    <button
                      className="secondary"
                      onClick={() =>
                        void act("CONFIRM_READINESS", {
                          requirement: "receiving",
                        })
                      }
                    >
                      Confirm destination readiness
                    </button>
                  )}
                  {t.phase === "ARRIVED" && (
                    <button
                      className="primary"
                      onClick={() => void act("HANDOFF")}
                    >
                      Confirm receiving handoff
                    </button>
                  )}
                  <button
                    className="secondary"
                    onClick={() =>
                      setText(
                        "Scanner delayed 15 minutes. We can receive the patient afterward.",
                      )
                    }
                  >
                    Report destination delay
                  </button>
                </>
              )}
              {ward.role === "coordinator" && (
                <>
                  <button
                    className="secondary"
                    onClick={() => void act("TAKEOVER")}
                  >
                    Take ownership
                  </button>
                  {["PAUSED", "ESCALATED"].includes(t.control) && (
                    <button
                      className="secondary"
                      onClick={() => void act("RESUME")}
                    >
                      Resume coordination
                    </button>
                  )}
                </>
              )}
            </div>
          )}
          {ward.proposals
            .filter((p) => p.status === "pending" && p.actor === ward.role)
            .map((p) => (
              <div className="proposal" key={p.id}>
                <span className="eyebrow">REVIEW INTERPRETATION</span>
                <strong>{p.update.kind.replaceAll("_", " ")}</strong>
                <p>“{p.update.excerpt}”</p>
                {p.update.uncertain ? (
                  <p className="warning-text">{p.update.question}</p>
                ) : (
                  <button
                    className="secondary"
                    onClick={() => void post(`proposals/${p.id}/confirm`, {})}
                  >
                    Confirm this interpretation <Check size={14} />
                  </button>
                )}
              </div>
            ))}

          {ward.replacements
            ?.filter((p) => p.status === "pending" && p.oldTransferId === t?.id)
            .map((p) => (
              <div className="proposal" key={p.id}>
                <span className="eyebrow">REVIEW REPLACEMENT</span>
                <p>
                  Cancel Bed {patient?.bed}; replace with{" "}
                  {ward.patients.find((x) => x.id === p.patientId)?.name}, Bed{" "}
                  {ward.patients.find((x) => x.id === p.patientId)?.bed} →{" "}
                  {p.destinationName}.
                </p>
                <p className="fine">
                  Original readiness will not carry over. Accepted transport
                  requires porter cancellation acknowledgement.
                </p>
                {ward.role === "nurse" && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={async () => {
                      const result = await post(
                        `replacements/${p.id}/confirm`,
                        {},
                      );
                      if (result?.newTransferId)
                        setSelected(result.newTransferId);
                    }}
                  >
                    Confirm cancellation & replacement
                  </button>
                )}
              </div>
            ))}
          {ward.role === "porter" &&
            ward.porterNotifications
              ?.filter((n) => n.transferId === t?.id)
              .slice(-2)
              .map((n) => (
                <p className="handoff-receipt" key={`${n.offerId}-${n.at}`}>
                  Staff inbox: {n.reason}. Do not collect this patient.
                </p>
              ))}
          <div className="live-activity" aria-live="polite">
            <span className="eyebrow">RECORDED ACTIVITY</span>
            {ward.events
              .filter((e) => !t || e.transferId === t.id)
              .slice(-3)
              .reverse()
              .map((e) => (
                <p key={e.id}>
                  <time>{clock(e.at)}</time>
                  <span>
                    {e.text}
                    <small>
                      {e.actor} · {e.source}
                    </small>
                  </span>
                </p>
              ))}
          </div>
          <details className="agent-details">
            <summary>Agent messages & run status</summary>
            {ward.runs.slice(-4).map((r) => (
              <p key={r.id}>
                <b>{r.status}</b> {r.traceId && <code>Trace {r.traceId}</code>}{" "}
                ·{" "}
                {r.status === "done" || r.status === "error"
                  ? r.summary
                  : r.text}
              </p>
            ))}
          </details>
        </aside>
      )}
      <details
        className="live-voice"
        open={voiceOpen}
        onToggle={(e) => setVoiceOpen(e.currentTarget.open)}
      >
        <summary className="voice-toggle">
          Voice · {listening ? "Listening" : "Ready"}
        </summary>
        <div className="voice-status" aria-live="polite">
          <span className={listening ? "listening-dot" : "live-dot"} />
          {listening
            ? "Listening · review before sending"
            : ward.runs.some((r) => ["pending", "running"].includes(r.status))
              ? "Hemline is coordinating…"
              : lastSummary ||
                "Voice ready · select a bed or describe a transfer"}
        </div>
        <div className="voice-composer">
          <button
            className={`mic-button ${listening ? "recording" : ""}`}
            aria-label={listening ? "Stop microphone" : "Dictate message"}
            onClick={microphone}
          >
            {listening ? <Square size={18} /> : <Mic size={20} />}
          </button>
          <label className="sr-only" htmlFor="message">
            {t ? "Staff reply or coordination question" : "Transfer request"}
          </label>
          <textarea
            id="message"
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ask Hemline or give a ward update…"
          />
          <button
            className="voice-send"
            disabled={busy || !text.trim()}
            onClick={() => void send()}
          >
            Send <Send size={16} />
          </button>
        </div>
        <label className="voice-option">
          <input
            type="checkbox"
            checked={voice}
            onChange={(e) => setVoice(e.target.checked)}
          />{" "}
          Speak recorded status summaries
        </label>
      </details>
    </div>
  );
}
