"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";
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
  ChevronRight,
  ShieldCheck,
  Users,
  AlertCircle,
  RefreshCw,
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
  nurse: "Ward nurse",
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
    [realNow, setRealNow] = useState(0);
  const recognition = useRef<Recognition | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/ward", { cache: "no-store" });
      if (r.ok) {
        setWard(await r.json());
        setStarted(true);
        setRealNow(Date.now());
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
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
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
      if (!r.ok) throw new Error(result.message || "Action failed");
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
            <p className="eyebrow">HOSPITAL COORDINATION · SYNTHETIC SANDBOX</p>
            <h1>
              Every request.
              <br />
              Every dependency.
              <br />
              <span>Every handoff.</span>
            </h1>
            <p className="intro">
              One shared picture of the work between a ward request and a
              verified arrival. Explore a complete transfer, including the
              moments when plans change.
            </p>
            <button
              className="primary"
              disabled={busy || (!!sitekey && !captcha)}
              onClick={() =>
                void post("sandbox", { captchaToken: captcha || null })
              }
            >
              Open your demo ward <ArrowRight size={18} />
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
              Your own isolated ward · No real patient information
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
              WARD 03 <span>13:40 IST</span>
            </div>
            <h2>From request to handoff</h2>
            {[
              ["01", "Understand", "Resolve patient, destination, and intent."],
              [
                "02",
                "Coordinate",
                "Confirm readiness. Find an eligible porter.",
              ],
              ["03", "Recover", "Handle rejection and destination delays."],
              ["04", "Verify", "Record arrival and receiving-team handoff."],
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
              <ShieldCheck size={18} /> Human confirmations. Evidence-backed
              outcomes.
            </div>
          </section>
        </div>
      </main>
    );
  const patient = t ? ward.patients.find((p) => p.id === t.patientId) : null;
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="wordmark">
          <span className="brand-icon">
            <Activity size={20} />
          </span>
          Hemline
        </div>
        <span className="separator" />
        <span className="header-label">Ward 03 / Radiology</span>
        <div className="header-right">
          <span className="simulation">
            <span className="live-dot" />
            Synthetic ward
          </span>
          <span className="clock">
            <Clock3 size={15} />
            {clock(ward.now)} IST
          </span>
        </div>
      </header>
      <div className="mode-banner">
        <span>
          <ShieldCheck size={15} />
          {ward.adapter === "fixture"
            ? "Local fixture adapter — scripted interpretation, not a live LLM"
            : "Live model adapter"}{" "}
          ·{" "}
          {ward.tracingConfigured
            ? "neatlogs configured"
            : "neatlogs not configured"}
        </span>
        <span>Simulation time {ward.paused ? "paused" : "running"}</span>
      </div>
      <main className="workspace">
        <div className="page-heading">
          <div>
            <p className="eyebrow">SHARED OPERATIONAL PICTURE</p>
            <h1>Keep the ward moving.</h1>
            <p>See what is waiting, who owns it, and what happens next.</p>
          </div>
          <div className="playback">
            <select
              aria-label="Demo mode"
              value={ward.mode}
              disabled={busy}
              onChange={(e) =>
                void post("sandbox/playback", { mode: e.target.value })
              }
            >
              <option value="manual">Manual exploration</option>
              <option value="guided">Guided staff playback</option>
            </select>
            <button
              className="icon-button"
              aria-label={
                ward.paused ? "Resume simulation" : "Pause simulation"
              }
              onClick={() =>
                void post("sandbox/playback", { paused: !ward.paused })
              }
            >
              {ward.paused ? <Play size={18} /> : <Pause size={18} />}
            </button>
            {ward.paused && (
              <button
                className="secondary small"
                onClick={() => void post("sandbox/playback", { advance: 30 })}
              >
                +30 sec
              </button>
            )}
          </div>
        </div>
        {error && (
          <div className="error" role="alert">
            <AlertCircle size={17} />
            {error}
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              ×
            </button>
          </div>
        )}
        <div className="metrics">
          <div>
            <span>Active transfers</span>
            <strong>
              {ward.transfers
                .filter(
                  (t) => t.phase !== "COMPLETED" && t.control !== "CANCELLED",
                )
                .length.toString()
                .padStart(2, "0")}
            </strong>
          </div>
          <div>
            <span>Needs attention</span>
            <strong>
              {ward.transfers
                .filter((t) => t.control !== "ACTIVE" || t.phase === "DRAFT")
                .length.toString()
                .padStart(2, "0")}
            </strong>
          </div>
          <div>
            <span>Verified handoffs</span>
            <strong>
              {ward.transfers
                .filter((t) => t.phase === "COMPLETED")
                .length.toString()
                .padStart(2, "0")}
            </strong>
          </div>
          <div>
            <span>Receiving window</span>
            <strong className="time-value">
              {clock(ward.destination.availableAfter)}{" "}
              <span>– {clock(ward.destination.windowEnd)}</span>
            </strong>
          </div>
        </div>
        <section className="bed-strip" aria-label="Ward beds">
          <div className="section-caption">
            WARD BEDS{" "}
            <span>Patient context stays attached to the encounter.</span>
          </div>
          <div className="beds">
            {Array.from({ length: 18 }, (_, i) => i + 1).map((bed) => {
              const p = ward.patients.find((p) => p.bed === bed);
              return (
                <button
                  className={`bed ${p ? "occupied" : ""} ${patient?.bed === bed ? "selected" : ""}`}
                  key={bed}
                  title={p?.name || "Unoccupied"}
                  onClick={() => {
                    const transfer = ward.transfers.find(
                      (t) => t.patientId === p?.id,
                    );
                    if (transfer) setSelected(transfer.id);
                    else if (p)
                      setText(
                        `Arrange an approved transfer for ${p.name}, encounter ${p.id}, Bed ${bed}, to radiology.`,
                      );
                  }}
                >
                  <span>{bed.toString().padStart(2, "0")}</span>
                  <span className="bed-dot" />
                </button>
              );
            })}
          </div>
        </section>
        <div className="content-grid">
          <section className="board">
            <div className="section-head">
              <h2>
                Transfer board <span>{ward.transfers.length}</span>
              </h2>
              <button
                className="text-button"
                onClick={() => {
                  setSelected("new");
                  setText(
                    "Arrange an approved transfer from Bed 18 to radiology.",
                  );
                }}
              >
                New request <ArrowRight size={15} />
              </button>
            </div>
            {!ward.transfers.length ? (
              <div className="empty">
                <Activity size={28} />
                <h3>The ward is ready.</h3>
                <p>
                  Start with Bed 18. Try guided mode to watch simulated staff
                  respond, or keep manual mode to act as each role.
                </p>
                <button
                  className="secondary"
                  onClick={() =>
                    setText(
                      "Arrange an approved transfer from Bed 18 to radiology.",
                    )
                  }
                >
                  Prepare a transfer request <ArrowRight size={16} />
                </button>
              </div>
            ) : (
              <div className="transfer-list">
                {ward.transfers.map((transfer) => {
                  const p = ward.patients.find(
                    (p) => p.id === transfer.patientId,
                  )!;
                  return (
                    <button
                      key={transfer.id}
                      className={`transfer-row ${t?.id === transfer.id ? "active" : ""}`}
                      onClick={() => setSelected(transfer.id)}
                    >
                      <div className="patient-cell">
                        <span className="bed-number">{p.bed}</span>
                        <div>
                          <strong>{p.name}</strong>
                          <small>{p.id} · Radiology</small>
                        </div>
                      </div>
                      <span
                        className={`badge ${transfer.phase === "COMPLETED" ? "success" : transfer.control !== "ACTIVE" ? "warning" : ""}`}
                      >
                        {transfer.control !== "ACTIVE"
                          ? transfer.control
                          : transfer.phase.replaceAll("_", " ")}
                      </span>
                      <div className="next-cell">
                        <strong>{transfer.nextAction}</strong>
                        <small>
                          {roleNames[transfer.owner]} · Revision{" "}
                          {transfer.revision}
                        </small>
                      </div>
                      <span className="row-time">
                        {clock(transfer.appointment)}
                      </span>
                      <ChevronRight size={17} />
                    </button>
                  );
                })}
              </div>
            )}
            {t && (
              <section className="transfer-detail">
                <div className="detail-head">
                  <h3>
                    {patient?.name} <span>· Bed {patient?.bed}</span>
                  </h3>
                  <span className="fine">Revision {t.revision}</span>
                </div>
                <div className="progress">
                  {phases.map((phase, i) => (
                    <div
                      key={phase}
                      className={i <= phases.indexOf(t.phase) ? "reached" : ""}
                    >
                      <span>
                        {i < phases.indexOf(t.phase) ? (
                          <Check size={10} />
                        ) : (
                          i + 1
                        )}
                      </span>
                      <small>
                        {phase === "CONFIRMED"
                          ? "Approved"
                          : phase.charAt(0) + phase.slice(1).toLowerCase()}
                      </small>
                    </div>
                  ))}
                </div>
                <div className="requirements">
                  {t.requirements.map((r) => (
                    <span
                      key={r}
                      className={
                        t.confirmations[r] ? "confirmed" : "unconfirmed"
                      }
                    >
                      {t.confirmations[r] ? (
                        <Check size={13} />
                      ) : (
                        <Clock3 size={13} />
                      )}{" "}
                      {r === "oxygen" ? "Oxygen equipment" : r}{" "}
                      {t.confirmations[r] ? "confirmed" : "pending"}
                    </span>
                  ))}
                </div>
                <div className="next-action">
                  <span className="eyebrow">NEXT ACTION</span>
                  <strong>{t.nextAction}</strong>
                  <span>{roleNames[t.owner]}</span>
                </div>
              </section>
            )}
            <section className="timeline">
              <div className="section-head">
                <h2>Recorded activity</h2>
                <span className="fine">Authoritative events</span>
              </div>
              {ward.events.length ? (
                ward.events
                  .slice(-10)
                  .reverse()
                  .map((e) => (
                    <div className="timeline-event" key={e.id}>
                      <span className="event-dot" />
                      <div>
                        <p>{e.text}</p>
                        <small>
                          {e.actor} · {e.source} · {clock(e.at)} · r{e.revision}
                        </small>
                      </div>
                    </div>
                  ))
              ) : (
                <p className="muted">
                  Requests and confirmations will appear here.
                </p>
              )}
            </section>
          </section>
          <aside className="agent-panel">
            <div className="section-head">
              <h2>
                <span className="agent-mark">
                  <Activity size={16} />
                </span>
                Coordination desk
              </h2>
            </div>
            <label className="field-label" htmlFor="role">
              Acting as
            </label>
            <select
              id="role"
              value={ward.role}
              onChange={(e) =>
                void post("sandbox/role", {
                  role: e.target.value,
                  takeover: ward.mode === "guided",
                })
              }
            >
              {Object.entries(roleNames).map(([role, label]) => (
                <option key={role} value={role}>
                  {label}
                </option>
              ))}
            </select>
            <p className="fine">
              Switching roles in guided mode takes that role over from simulated
              staff.
            </p>
            <div className="agent-conversation">
              {ward.runs.slice(-4).map((run) => (
                <div
                  className={`run ${run.status === "error" ? "failed" : ""}`}
                  key={run.id}
                >
                  <span className="run-status">
                    {run.status === "pending" || run.status === "running" ? (
                      <RefreshCw size={12} className="spin" />
                    ) : (
                      <Activity size={12} />
                    )}
                    Hemline · {run.status}
                  </span>
                  <p>
                    {run.status === "done" || run.status === "error"
                      ? run.summary
                      : run.text}
                  </p>
                </div>
              ))}
              {!ward.runs.length && (
                <div className="run">
                  <span className="run-status">
                    <Activity size={12} />
                    Hemline
                  </span>
                  <p>
                    Give me a transfer goal. I’ll resolve the patient, surface
                    dependencies, and keep each handoff accountable.
                  </p>
                </div>
              )}
            </div>
            <label className="field-label" htmlFor="message">
              {t ? "Staff reply or coordination question" : "Transfer request"}
            </label>
            <textarea
              id="message"
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                t
                  ? "“Scanner delayed 15 minutes…”"
                  : "“Arrange Bed 18’s radiology transfer…”"
              }
            />
            <div className="composer-actions">
              <button
                className={`icon-button ${listening ? "recording" : ""}`}
                aria-label={listening ? "Stop microphone" : "Dictate message"}
                onClick={microphone}
              >
                {listening ? <Square size={16} /> : <Mic size={17} />}
              </button>
              <span className="fine">Review before sending</span>
              <button
                className="primary small"
                disabled={busy || !text.trim()}
                onClick={() => void send()}
              >
                Send <Send size={14} />
              </button>
            </div>
            <label className="voice-option">
              <input
                type="checkbox"
                checked={voice}
                onChange={(e) => setVoice(e.target.checked)}
              />
              Speak recorded status summaries
            </label>
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
                      t.destinationRevision !== ward.destination.revision && (
                        <button
                          className="secondary"
                          onClick={() =>
                            void act("CONFIRM_RESCHEDULE", {
                              appointment: Math.max(
                                ward.destination.availableAfter,
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
                        Record collection
                      </button>
                    )}
                    {t.phase === "COLLECTED" && (
                      <button
                        className="primary"
                        onClick={() => void act("ARRIVE")}
                      >
                        Record arrival
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
            <div className="scenario">
              <h3>Explore a setback</h3>
              <select
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
              <p className="fine">
                Events remain labelled as simulation. Change scenarios before
                dispatch when possible.
              </p>
            </div>
            <div className="desk-footer">
              <Users size={15} />
              Human confirmations remain authoritative.
            </div>
          </aside>
        </div>
      </main>
      <footer className="app-footer">
        <span>Hemline · Synthetic hospital coordination</span>
        <span>
          Sandbox expires in{" "}
          {Math.max(0, Math.ceil((ward.expiresAt - realNow) / 60000))} min ·
          Model reserve ${ward.cost.toFixed(3)}
        </span>
      </footer>
    </div>
  );
}
