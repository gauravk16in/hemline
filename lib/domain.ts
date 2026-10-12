import { randomUUID } from "node:crypto";
import { z } from "zod";
export const roles = ["nurse", "porter", "receiving", "coordinator"] as const;
export type Role = (typeof roles)[number];
export type Phase =
  | "DRAFT"
  | "CONFIRMED"
  | "READY"
  | "OFFERING"
  | "ASSIGNED"
  | "COLLECTED"
  | "ARRIVED"
  | "COMPLETED";
export type Control =
  "ACTIVE" | "PAUSED" | "CANCELLING" | "CANCELLED" | "ESCALATED";
export type Actor = Role | "agent";
export interface Patient {
  id: string;
  name: string;
  bed: number;
  previousBed: number | null;
}
export interface Staff {
  id: string;
  name: string;
  available: boolean;
  capabilities: string[];
}
export interface Event {
  id: string;
  at: number;
  realAt: string;
  transferId: string | null;
  actor: string;
  source: string;
  text: string;
  revision: number;
}
export interface Offer {
  id: string;
  porterId: string;
  revision: number;
  expires: number;
  status: "pending" | "accepted" | "rejected" | "expired" | "cancelled";
}
export type DestinationName = "Radiology" | "CT";
export interface Replacement {
  id: string;
  messageId: string;
  actor: Role;
  oldTransferId: string;
  patientId: string;
  destinationName: DestinationName;
  appointment: number;
  revision: number;
  status: "pending" | "confirmed";
  newTransferId: string | null;
}
export interface Transfer {
  id: string;
  patientId: string;
  destinationName?: DestinationName;
  revision: number;
  destinationRevision: number;
  phase: Phase;
  control: Control;
  requirements: string[];
  confirmations: Record<string, boolean>;
  readinessEvidence?: Record<
    string,
    { actor: Actor; source: string; at: number; revision: number }
  >;
  handoffEvidence?: {
    actor: Actor;
    source: string;
    at: number;
    revision: number;
  };
  appointment: number;
  offer: Offer | null;
  offers: Offer[];
  owner: Role;
  nextAction: string;
  modelCalls: number;
  pickupDue: number | null;
  safeResolution?: { actor: Actor; note: string; at: number; revision: number };
}
export const updateSchema = z
  .object({
    kind: z.enum([
      "readiness",
      "equipment",
      "availability",
      "destination_delay",
      "offer_response",
      "clarification",
      "reschedule",
    ]),
    targetId: z.string(),
    requirement: z.string().nullable(),
    decision: z.boolean().nullable(),
    delayMinutes: z.number().min(0).max(240).nullable(),
    excerpt: z.string().min(1).max(500),
    uncertain: z.boolean(),
    question: z.string().nullable(),
  })
  .strict();
export type Update = z.infer<typeof updateSchema>;
export interface Proposal {
  id: string;
  messageId: string;
  actor: Role;
  transferId: string | null;
  revision: number;
  update: Update;
  status: "pending" | "confirmed";
  source: string;
}
export interface Message {
  id: string;
  role: Role;
  text: string;
  offerId?: string;
  transferId: string | null;
  revision: number | null;
  source: "visitor" | "simulated staff";
}
export interface Run {
  id: string;
  status: "pending" | "running" | "done" | "error";
  text: string;
  offerId?: string;
  transferId: string | null;
  role: Role;
  messageId: string | null;
  summary: string;
  traceId: string | null;
}
export interface Scheduled {
  id: string;
  at: number;
  role: Role;
  transferId: string;
  type: string;
  text: string;
  payload: Record<string, unknown>;
  revision: number;
}
export interface Ward {
  testSessionId?: string;
  id: string;
  role: Role;
  mode: "guided" | "manual";
  paused: boolean;
  now: number;
  lastTick: number;
  expiresAt: number;
  patients: Patient[];
  staff: Staff[];
  ctDestination?: {
    revision: number;
    availableAfter: number;
    windowEnd: number;
  };
  replacements?: Replacement[];
  porterNotifications?: {
    porterId: string;
    transferId: string;
    offerId: string;
    reason: string;
    at: number;
  }[];
  destination: { revision: number; availableAfter: number; windowEnd: number };
  transfers: Transfer[];
  events: Event[];
  proposals: Proposal[];
  messages: Message[];
  runs: Run[];
  scheduled: Scheduled[];
  receipts: Record<string, { hash: string; result: unknown }>;
  messageCount: number;
  minutes: number[];
  cost: number;
  scenario: string;
  takenOver: Role[];
}
export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}
export const commandSchema = z
  .object({
    type: z.enum([
      "CONFIRM_REQUEST",
      "CONFIRM_READINESS",
      "WITHDRAW_READINESS",
      "ACCEPT",
      "REJECT",
      "COLLECT",
      "ARRIVE",
      "HANDOFF",
      "CANCEL",
      "ACK_CANCEL",
      "TAKEOVER",
      "RESUME",
      "SET_REQUIREMENT",
      "CONFIRM_RESCHEDULE",
    ]),
    expectedRevision: z.number().int().nonnegative(),
    payload: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export type Command = z.infer<typeof commandSchema>;
export function seed(id = randomUUID()): Ward {
  const now = Date.parse("2026-10-11T08:10:00Z");
  return {
    id,
    role: "nurse",
    mode: "manual",
    paused: true,
    now,
    lastTick: Date.now(),
    expiresAt: Date.now() + 7200000,
    patients: [
      { id: "enc-01", name: "Asha Patel", bed: 4, previousBed: null },
      { id: "enc-02", name: "Ashna Patel", bed: 8, previousBed: 4 },
      { id: "enc-03", name: "Dev Mehta", bed: 12, previousBed: null },
      { id: "enc-04", name: "Mira Rao", bed: 18, previousBed: null },
      { id: "enc-05", name: "Nikhil Shah", bed: 21, previousBed: null },
    ],
    staff: [
      {
        id: "porter-1",
        name: "Samir",
        available: true,
        capabilities: ["wheelchair", "oxygen"],
      },
      {
        id: "porter-2",
        name: "Leena",
        available: true,
        capabilities: ["wheelchair", "oxygen"],
      },
      {
        id: "porter-3",
        name: "Arun",
        available: true,
        capabilities: ["wheelchair"],
      },
    ],
    destination: { revision: 1, availableAfter: now, windowEnd: now + 7200000 },
    transfers: [],
    events: [],
    proposals: [],
    messages: [],
    runs: [],
    scheduled: [],
    receipts: {},
    messageCount: 0,
    minutes: [],
    cost: 0,
    scenario: "standard",
    takenOver: [],
  };
}
export function event(
  w: Ward,
  text: string,
  actor: string,
  transfer: Transfer | null = null,
  source = "visitor",
) {
  const e: Event = {
    id: randomUUID(),
    at: w.now,
    realAt: new Date().toISOString(),
    transferId: transfer?.id || null,
    actor,
    source,
    text,
    revision: transfer?.revision || w.destination.revision,
  };
  w.events.push(e);
  return e;
}
export function findTransfer(w: Ward, id: string) {
  const t = w.transfers.find((t) => t.id === id);
  if (!t) throw new DomainError("NOT_FOUND", "Transfer not found", 404);
  return t;
}
export function destinationFor(w: Ward, name: DestinationName = "Radiology") {
  if (name === "Radiology") return w.destination;
  return (w.ctDestination ||= {
    revision: 1,
    availableAfter: w.now,
    windowEnd: w.now + 7200000,
  });
}
export function ready(w: Ward, t: Transfer) {
  const destination = destinationFor(w, t.destinationName);
  return (
    t.phase !== "DRAFT" &&
    t.requirements.every((r) => t.confirmations[r]) &&
    t.destinationRevision === destination.revision &&
    t.appointment >= destination.availableAfter &&
    t.appointment <= destination.windowEnd
  );
}
export function eligible(w: Ward, t: Transfer) {
  return w.staff.filter(
    (s) =>
      s.available &&
      (!t.requirements.includes("oxygen") ||
        s.capabilities.includes("oxygen")) &&
      !w.transfers.some(
        (other) =>
          other.id !== t.id &&
          other.offer?.porterId === s.id &&
          ["pending", "accepted"].includes(other.offer.status) &&
          !["COMPLETED"].includes(other.phase) &&
          other.control !== "CANCELLED",
      ) &&
      !t.offers.some(
        (o) =>
          o.porterId === s.id && ["rejected", "expired"].includes(o.status),
      ),
  );
}
export function queueRun(
  w: Ward,
  text: string,
  role: Role,
  transferId: string | null = null,
  messageId: string | null = null,
) {
  const r: Run = {
    id: randomUUID(),
    status: "pending",
    text,
    role,
    transferId,
    messageId,
    summary: "Queued",
    traceId: null,
  };
  w.runs.push(r);
  return r;
}
export function createDraft(
  w: Ward,
  patientId: string,
  appointment: number,
  destinationName: DestinationName = "Radiology",
) {
  if (
    w.transfers.some(
      (t) =>
        t.patientId === patientId &&
        t.control !== "CANCELLED" &&
        t.phase !== "COMPLETED",
    )
  )
    throw new DomainError(
      "DUPLICATE_TRANSFER",
      "An active transfer already exists for this encounter",
    );
  if (w.transfers.length >= 5)
    throw new DomainError("QUOTA", "Five transfers per sandbox", 429);
  if (!w.patients.some((p) => p.id === patientId))
    throw new DomainError("NOT_FOUND", "Unknown encounter", 404);
  if (
    !Number.isFinite(appointment) ||
    appointment < w.now ||
    appointment > w.now + 7200000
  )
    throw new DomainError(
      "TIME",
      "Appointment must be within two simulation hours",
    );
  const t: Transfer = {
    id: randomUUID(),
    patientId,
    destinationName,
    revision: 1,
    destinationRevision: destinationFor(w, destinationName).revision,
    phase: "DRAFT",
    control: "ACTIVE",
    requirements: ["nurse", "receiving", "escort"],
    confirmations: {},
    appointment,
    offer: null,
    offers: [],
    owner: "nurse",
    nextAction: "Confirm the patient-bound request",
    modelCalls: 0,
    pickupDue: null,
  };
  w.transfers.push(t);
  event(w, "Draft created; nurse confirmation required", "agent", t, "agent");
  return t;
}
function requireRole(actual: Actor, allowed: Actor[]) {
  if (!allowed.includes(actual))
    throw new DomainError(
      "FORBIDDEN",
      "This role cannot perform that action",
      403,
    );
}
function schedule(
  w: Ward,
  t: Transfer,
  role: Role,
  type: string,
  text: string,
  payload: Record<string, unknown> = {},
  delay = 3,
) {
  if (
    w.mode !== "guided" ||
    w.takenOver.includes(role) ||
    w.scheduled.some(
      (s) => s.transferId === t.id && s.role === role && s.type === type,
    )
  )
    return;
  w.scheduled.push({
    id: randomUUID(),
    at: w.now + delay * 1000,
    role,
    type,
    text,
    payload,
    transferId: t.id,
    revision: t.revision,
  });
}
export function command(
  w: Ward,
  id: string,
  c: Command,
  actor: Actor,
  source = "visitor",
) {
  const t = findTransfer(w, id);
  if (t.phase === "COMPLETED")
    throw new DomainError("STATE", "A verified handoff is final");
  if (t.revision !== c.expectedRevision)
    throw new DomainError(
      "STALE_REVISION",
      "Request changed. Reload before acting.",
    );
  if (
    t.control === "CANCELLED" ||
    (t.control === "ESCALATED" && !["RESUME", "TAKEOVER"].includes(c.type))
  )
    throw new DomainError("CONTROL", "Transfer is not active");
  const o = t.offer;
  switch (c.type) {
    case "CONFIRM_REQUEST":
      requireRole(actor, ["nurse"]);
      if (t.phase !== "DRAFT")
        throw new DomainError("STATE", "Request already confirmed");
      t.phase = "CONFIRMED";
      t.nextAction = "Confirm nurse, escort, and receiving readiness";
      schedule(
        w,
        t,
        "nurse",
        "MESSAGE",
        "Patient is ready and escort is confirmed.",
      );
      schedule(
        w,
        t,
        "receiving",
        "MESSAGE",
        `${t.destinationName || "Radiology"} is ready to receive the patient.`,
        {},
        5,
      );
      w.scheduled.push(
        {
          id: randomUUID(),
          at: w.now + 60000,
          role: "coordinator",
          transferId: t.id,
          type: "REMINDER",
          text: "Readiness confirmation overdue",
          payload: {},
          revision: t.revision,
        },
        {
          id: randomUUID(),
          at: w.now + 120000,
          role: "coordinator",
          transferId: t.id,
          type: "ESCALATE_READINESS",
          text: "Readiness not confirmed within two simulation minutes",
          payload: {},
          revision: t.revision,
        },
      );
      break;
    case "CONFIRM_READINESS":
    case "WITHDRAW_READINESS": {
      const requirement = z
        .enum(["nurse", "receiving", "escort", "oxygen"])
        .parse(c.payload.requirement);
      const requiredRole = requirement === "receiving" ? "receiving" : "nurse";
      if (actor !== requiredRole)
        throw new DomainError(
          "FORBIDDEN",
          `${actor} cannot confirm ${requirement} readiness. ${requiredRole} is required; use the requirement supported by the source role.`,
          403,
        );
      t.confirmations[requirement] = c.type === "CONFIRM_READINESS";
      t.readinessEvidence ||= {};
      if (c.type === "CONFIRM_READINESS")
        t.readinessEvidence[requirement] = {
          actor,
          source,
          at: w.now,
          revision: t.revision,
        };
      else delete t.readinessEvidence[requirement];
      if (c.type === "WITHDRAW_READINESS") {
        t.control = ["COLLECTED", "ARRIVED"].includes(t.phase)
          ? "ESCALATED"
          : "PAUSED";
        t.nextAction = "Readiness withdrawn; reconcile transport";
        if (o?.status === "pending") {
          o.status = "cancelled";
          t.phase = "CONFIRMED";
        }
        if (
          o?.status === "accepted" &&
          !["COLLECTED", "ARRIVED"].includes(t.phase)
        ) {
          t.control = "CANCELLING";
          schedule(
            w,
            t,
            "porter",
            "ACK_CANCEL",
            "Previous assignment cancelled.",
          );
        }
      }
      break;
    }
    case "SET_REQUIREMENT":
      requireRole(actor, ["nurse"]);
      if (["COLLECTED", "ARRIVED", "COMPLETED"].includes(t.phase))
        throw new DomainError(
          "STATE",
          "Staff intervention required after collection",
        );
      if (c.payload.requirement !== "oxygen")
        throw new DomainError(
          "VALIDATION",
          "Supported resource is oxygen equipment",
          400,
        );
      if (!t.requirements.includes("oxygen")) t.requirements.push("oxygen");
      t.confirmations = { oxygen: false };
      t.revision++;
      t.control = o?.status === "accepted" ? "CANCELLING" : "PAUSED";
      if (o?.status === "pending") o.status = "cancelled";
      if (t.control === "CANCELLING")
        schedule(
          w,
          t,
          "porter",
          "ACK_CANCEL",
          "Previous assignment cancelled.",
        );
      else t.phase = "CONFIRMED";
      break;
    case "ACCEPT":
    case "REJECT":
      requireRole(actor, ["porter"]);
      if (o && c.payload.offerId !== o.id)
        throw new DomainError(
          "OFFER_TARGET",
          `Offer response must use offer ID ${o.id}, not transfer ID ${t.id}.`,
        );
      if (
        !o ||
        o.status !== "pending" ||
        o.revision !== t.revision ||
        w.now >= o.expires
      )
        throw new DomainError("EXPIRED_OFFER", "Offer is no longer active");
      if (c.type === "ACCEPT") {
        if (!ready(w, t) || !eligible(w, t).some((s) => s.id === o.porterId))
          throw new DomainError("INELIGIBLE", "Porter or readiness changed");
        o.status = "accepted";
        t.phase = "ASSIGNED";
        t.pickupDue = w.now + 90000;
        t.owner = "porter";
        t.nextAction = "Record patient collection";
        schedule(w, t, "porter", "COLLECT", "Patient collected.", {}, 4);
      } else {
        o.status = "rejected";
        t.phase = "READY";
        t.nextAction = "Find another eligible porter";
      }
      break;
    case "COLLECT":
      requireRole(actor, ["porter"]);
      if (
        t.phase !== "ASSIGNED" ||
        t.control !== "ACTIVE" ||
        o?.status !== "accepted" ||
        !ready(w, t)
      )
        throw new DomainError(
          "STATE",
          "Collection requires current accepted assignment and readiness",
        );
      t.phase = "COLLECTED";
      t.nextAction = `Record arrival at ${t.destinationName || "Radiology"}`;
      schedule(
        w,
        t,
        "porter",
        "ARRIVE",
        `Arrived at ${t.destinationName || "Radiology"}.`,
        {},
        5,
      );
      break;
    case "ARRIVE":
      requireRole(actor, ["porter"]);
      if (t.phase !== "COLLECTED")
        throw new DomainError("STATE", "Patient must be collected first");
      t.phase = "ARRIVED";
      t.owner = "receiving";
      t.nextAction = "Receiving team must confirm handoff";
      schedule(w, t, "receiving", "HANDOFF", "Handoff confirmed.", {}, 3);
      break;
    case "HANDOFF":
      requireRole(actor, ["receiving"]);
      if (t.phase !== "ARRIVED" || t.control !== "ACTIVE")
        throw new DomainError("STATE", "Arrival must be recorded first");
      t.handoffEvidence = { actor, source, at: w.now, revision: t.revision };
      t.phase = "COMPLETED";
      t.nextAction = "Verified handoff complete";
      break;
    case "CANCEL":
      requireRole(actor, ["nurse", "coordinator"]);
      if (["COLLECTED", "ARRIVED", "COMPLETED"].includes(t.phase)) {
        t.control = "ESCALATED";
        t.owner = "coordinator";
        t.nextAction = "Staff intervention required after collection";
      } else if (o?.status === "accepted") {
        t.control = "CANCELLING";
        t.nextAction = "Await porter cancellation acknowledgement";
        schedule(
          w,
          t,
          "porter",
          "ACK_CANCEL",
          "Previous assignment cancelled.",
        );
      } else {
        if (o) o.status = "cancelled";
        t.control = "CANCELLED";
        t.nextAction = "Cancelled before collection";
      }
      break;
    case "ACK_CANCEL":
      requireRole(actor, ["porter"]);
      if (t.control !== "CANCELLING")
        throw new DomainError("STATE", "No cancellation pending");
      if (o) o.status = "cancelled";
      t.offer = null;
      t.phase = "CONFIRMED";
      t.control = "PAUSED";
      t.nextAction = "Nurse must confirm revised request or cancel";
      break;
    case "CONFIRM_RESCHEDULE":
      requireRole(actor, ["nurse"]);
      if (t.control === "CANCELLING")
        throw new DomainError("STATE", "Wait for cancellation acknowledgement");
      if (["COLLECTED", "ARRIVED", "COMPLETED"].includes(t.phase))
        throw new DomainError("STATE", "Cannot reschedule after collection");
      {
        const time = z.number().finite().parse(c.payload.appointment);
        if (
          time <
            Math.max(
              destinationFor(w, t.destinationName).availableAfter,
              w.now + 600000,
            ) ||
          time > destinationFor(w, t.destinationName).windowEnd
        )
          throw new DomainError("WINDOW", "No feasible receiving window");
        t.appointment = time;
        t.destinationRevision = destinationFor(w, t.destinationName).revision;
        t.revision++;
        t.confirmations = {};
        t.readinessEvidence = {};
        t.offer = null;
        t.phase = "CONFIRMED";
        t.control = "ACTIVE";
        t.nextAction = "Reconfirm readiness for the revised request";
        w.scheduled.push(
          {
            id: randomUUID(),
            at: w.now + 60000,
            role: "coordinator",
            transferId: t.id,
            type: "REMINDER",
            text: "Readiness confirmation overdue",
            payload: {},
            revision: t.revision,
          },
          {
            id: randomUUID(),
            at: w.now + 120000,
            role: "coordinator",
            transferId: t.id,
            type: "ESCALATE_READINESS",
            text: "Readiness not confirmed within two simulation minutes",
            payload: {},
            revision: t.revision,
          },
        );

        schedule(
          w,
          t,
          "nurse",
          "MESSAGE",
          "Patient is ready and escort is confirmed.",
        );
        schedule(
          w,
          t,
          "receiving",
          "MESSAGE",
          `${t.destinationName || "Radiology"} is ready to receive the patient.`,
          {},
          5,
        );
      }
      break;
    case "TAKEOVER":
      requireRole(actor, ["coordinator"]);
      t.control = "PAUSED";
      t.owner = "coordinator";
      t.nextAction = "Coordinator owns this transfer";
      break;
    case "RESUME":
      requireRole(actor, ["coordinator"]);
      if (t.control === "CANCELLING")
        throw new DomainError("STATE", "Cannot bypass cancellation");
      if (["COLLECTED", "ARRIVED"].includes(t.phase)) {
        const note = z
          .string()
          .trim()
          .min(10)
          .max(500)
          .safeParse(c.payload.resolution);
        if (!note.success || c.payload.acknowledged !== true)
          throw new DomainError(
            "SAFE_RESOLUTION",
            "Record the staff-agreed safe resolution and acknowledge it before resuming transport",
          );
        t.safeResolution = {
          actor,
          note: note.data,
          at: w.now,
          revision: t.revision,
        };
        event(
          w,
          `Staff safe resolution acknowledged: ${note.data}`,
          actor,
          t,
          source,
        );
      }
      t.control = "ACTIVE";
      break;
  }
  event(w, c.type.replaceAll("_", " ").toLowerCase(), actor, t, source);
  if (
    ready(w, t) &&
    ["CONFIRMED", "READY"].includes(t.phase) &&
    t.control === "ACTIVE"
  ) {
    t.phase = "READY";
    t.nextAction = "Offer transport to an eligible porter";
  }
  return t;
}
export function offer(w: Ward, id: string, revision: number, porterId: string) {
  const t = findTransfer(w, id);
  if (revision !== t.revision)
    throw new DomainError("STALE_REVISION", "Transfer revision changed");
  if (t.offer && ["pending", "accepted"].includes(t.offer.status))
    throw new DomainError(
      "UNRESOLVED_OFFER",
      `Offer ${t.offer.id} is ${t.offer.status}; reconcile it before offering another porter. Readiness has not been withdrawn.`,
    );
  if (
    t.control !== "ACTIVE" ||
    !ready(w, t) ||
    !["CONFIRMED", "READY"].includes(t.phase)
  )
    throw new DomainError(
      "NOT_READY",
      "Dispatch requires approved current readiness",
    );
  if (!eligible(w, t).some((s) => s.id === porterId))
    throw new DomainError("INELIGIBLE", "Candidate availability changed");
  const o: Offer = {
    id: randomUUID(),
    porterId,
    revision,
    expires: w.now + 45000,
    status: "pending",
  };
  t.offer = o;
  t.offers.push(o);
  t.phase = "OFFERING";
  t.owner = "porter";
  t.nextAction = "Await explicit porter acceptance";
  event(
    w,
    `Transport offered to ${w.staff.find((s) => s.id === porterId)?.name}`,
    "agent",
    t,
    "agent",
  );
  const reject = w.scenario === "rejection" && t.offers.length === 1;
  schedule(
    w,
    t,
    "porter",
    "MESSAGE",
    reject
      ? "Cannot take this one. I am tied up for twenty minutes."
      : "I accept this transport request.",
    { offerId: o.id },
  );
  return o;
}
export function destinationDelay(
  w: Ward,
  minutes: number,
  actor: Actor,
  source = "visitor",
  destinationName: DestinationName = "Radiology",
) {
  requireRole(actor, ["receiving"]);
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 240)
    throw new DomainError("VALIDATION", "Delay must be 0–240 minutes", 400);
  const destination = destinationFor(w, destinationName);
  destination.revision++;
  destination.availableAfter = w.now + minutes * 60000;
  for (const t of w.transfers.filter(
    (t) =>
      (t.destinationName || "Radiology") === destinationName &&
      t.phase !== "COMPLETED" &&
      t.control !== "CANCELLED",
  )) {
    if (["COLLECTED", "ARRIVED"].includes(t.phase)) {
      t.control = "ESCALATED";
      t.owner = "coordinator";
    } else if (t.offer?.status === "accepted") {
      t.control = "CANCELLING";
      schedule(w, t, "porter", "ACK_CANCEL", "Previous assignment cancelled.");
    } else {
      if (t.offer?.status === "pending") t.offer.status = "cancelled";
      t.control = "PAUSED";
      t.phase = t.phase === "DRAFT" ? "DRAFT" : "CONFIRMED";
    }
    t.nextAction = "Destination delayed; confirm a revised receiving window";
    queueRun(
      w,
      "Destination changed. Propose a feasible reschedule or escalate.",
      "receiving",
      t.id,
    );
  }
  event(
    w,
    `${destinationName} available after ${minutes} minutes`,
    "receiving",
    null,
    source,
  );
}
export function propose(w: Ward, messageId: string, u: Update) {
  const m = w.messages.find((m) => m.id === messageId);
  if (!m) throw new DomainError("NOT_FOUND", "Source message missing", 404);
  if (!m.text.toLowerCase().includes(u.excerpt.toLowerCase()))
    throw new DomainError(
      "EVIDENCE",
      "Excerpt is not present in source message",
    );
  const existing = w.proposals.find(
    (p) =>
      p.messageId === messageId &&
      p.update.kind === u.kind &&
      p.update.requirement === u.requirement,
  );
  if (existing) return existing;
  const p: Proposal = {
    id: randomUUID(),
    messageId,
    actor: m.role,
    transferId: m.transferId,
    revision: m.revision || 0,
    update: u,
    status: "pending",
    source: m.source,
  };
  w.proposals.push(p);
  event(
    w,
    `Interpretation: ${u.kind}${u.uncertain ? " — clarification required" : ""}`,
    "agent",
    m.transferId ? findTransfer(w, m.transferId) : null,
    "agent",
  );
  return p;
}
export function confirmProposal(w: Ward, id: string, actor: Role, wake = true) {
  const p = w.proposals.find((p) => p.id === id);
  if (!p) throw new DomainError("NOT_FOUND", "Proposal missing", 404);
  if (p.status === "confirmed") return p;
  if (p.actor !== actor)
    throw new DomainError("FORBIDDEN", "Only the source role may confirm", 403);
  if (p.update.uncertain || p.update.kind === "clarification")
    throw new DomainError(
      "UNCERTAIN",
      p.update.question || "Clarify this message first",
    );
  const t = p.transferId ? findTransfer(w, p.transferId) : null;
  if (t && p.revision !== t.revision)
    throw new DomainError(
      "STALE_REVISION",
      "Proposal concerns an old revision",
    );
  const u = p.update;
  if (u.kind === "destination_delay") {
    const name = (
      t && u.targetId === t.id ? t.destinationName || "Radiology" : u.targetId
    ).toLowerCase();
    if (name !== "radiology" && name !== "ct")
      throw new DomainError("DESTINATION", "Specify Radiology or CT");
    destinationDelay(
      w,
      u.delayMinutes ?? 0,
      actor,
      p.source,
      name === "ct" ? "CT" : "Radiology",
    );
  } else if (u.kind === "availability") {
    if (actor !== "porter")
      throw new DomainError(
        "FORBIDDEN",
        "Availability updates are for porters only. Receiving-team readiness must use kind=readiness, requirement=receiving, and the transfer ID.",
        403,
      );
    const s = w.staff.find((s) => s.id === u.targetId);
    if (!s) throw new DomainError("NOT_FOUND", "Porter missing", 404);
    s.available = u.decision === true;
  } else {
    if (!t) throw new DomainError("TARGET", "Transfer context required");
    if (u.kind === "readiness")
      command(
        w,
        t.id,
        {
          type: u.decision ? "CONFIRM_READINESS" : "WITHDRAW_READINESS",
          expectedRevision: p.revision,
          payload: { requirement: u.requirement },
        },
        actor,
        p.source,
      );
    if (u.kind === "equipment")
      command(
        w,
        t.id,
        {
          type: "SET_REQUIREMENT",
          expectedRevision: p.revision,
          payload: { requirement: "oxygen" },
        },
        actor,
        p.source,
      );
    if (u.kind === "offer_response")
      command(
        w,
        t.id,
        {
          type: u.decision ? "ACCEPT" : "REJECT",
          expectedRevision: p.revision,
          payload: { offerId: u.targetId },
        },
        actor,
        p.source,
      );
    if (u.kind === "reschedule")
      command(
        w,
        t.id,
        {
          type: "CONFIRM_RESCHEDULE",
          expectedRevision: p.revision,
          payload: {
            appointment: destinationFor(w, t.destinationName).availableAfter,
          },
        },
        actor,
        p.source,
      );
  }
  p.status = "confirmed";
  if (wake && t && t.phase === "READY" && t.control === "ACTIVE")
    queueRun(
      w,
      "Staff update confirmed; inspect state and choose next action.",
      actor,
      t.id,
    );
  return p;
}
export function addMessage(
  w: Ward,
  text: string,
  role: Role,
  transferId: string | null,
  source: "visitor" | "simulated staff" = "visitor",
  offerId?: string,
) {
  if (source === "visitor") {
    const now = Date.now();
    w.minutes = w.minutes.filter((n) => n > now - 60000);
    if (w.minutes.length >= 6 || w.messageCount >= 20)
      throw new DomainError("QUOTA", "Message limit reached", 429);
    w.minutes.push(now);
    w.messageCount++;
  }
  const t = transferId ? findTransfer(w, transferId) : null;
  const m: Message = {
    id: randomUUID(),
    role,
    text,
    transferId,
    revision: t?.revision || null,
    source,
    offerId,
  };
  w.messages.push(m);
  if (
    t &&
    role === "nurse" &&
    /\b(cancel|stop|wait)\b/i.test(text) &&
    !["COLLECTED", "ARRIVED", "COMPLETED"].includes(t.phase) &&
    t.control !== "CANCELLED"
  ) {
    t.control = "PAUSED";
    t.owner = "nurse";
    t.nextAction = "Nurse interruption under review; dispatch paused";
    event(w, t.nextAction, "nurse", t, source);
  }
  if (
    t &&
    role === "porter" &&
    /\baccept(?:ed)?\b/i.test(text) &&
    (t.control === "CANCELLED" || (t.offer && t.offer.status !== "pending"))
  ) {
    if (t.offer)
      reconcileAcceptance(w, t.id, t.offer.id, t.revision, role, source);
    return m;
  }
  queueRun(w, text, role, transferId, m.id);
  event(w, text, role, t, source);
  return m;
}
export function advance(w: Ward, seconds: number) {
  w.now += seconds * 1000;
  for (const t of w.transfers) {
    if (t.offer?.status === "pending" && w.now >= t.offer.expires) {
      t.offer.status = "expired";
      if (t.control === "ACTIVE") {
        t.phase = "READY";
        t.nextAction = "Offer expired; find another porter";
        queueRun(w, t.nextAction, "porter", t.id);
      }
      event(w, "Offer expired", "backend", t, "backend");
    }
    if (t.phase === "ASSIGNED" && t.pickupDue && w.now >= t.pickupDue) {
      t.pickupDue = null;
      t.control = "ESCALATED";
      t.owner = "coordinator";
      t.nextAction = "Pickup overdue; coordinator attention needed";
      event(w, t.nextAction, "backend", t, "backend");
    }
  }
  const due = w.scheduled.filter((s) => s.at <= w.now);
  w.scheduled = w.scheduled.filter((s) => s.at > w.now);
  for (const s of due) {
    if (w.takenOver.includes(s.role)) continue;
    const t = findTransfer(w, s.transferId);
    if (s.revision !== t.revision) {
      event(w, "Obsolete simulated action discarded", "backend", t, "backend");
      continue;
    }
    if (s.type === "REMINDER" || s.type === "ESCALATE_READINESS") {
      if (!ready(w, t) && t.control === "ACTIVE" && t.phase === "CONFIRMED") {
        event(w, s.text, "backend", t, "backend");
        if (s.type === "ESCALATE_READINESS") {
          t.control = "ESCALATED";
          t.owner = "coordinator";
          t.nextAction = s.text;
        }
      }
      continue;
    }
    try {
      if (s.type === "MESSAGE")
        addMessage(
          w,
          s.text,
          s.role,
          t.id,
          "simulated staff",
          typeof s.payload.offerId === "string" ? s.payload.offerId : undefined,
        );
      else {
        command(
          w,
          t.id,
          {
            type: s.type as Command["type"],
            expectedRevision: t.revision,
            payload: s.payload,
          },
          s.role,
          "simulated staff",
        );
        if (t.phase === "READY" && t.control === "ACTIVE")
          queueRun(w, "Readiness confirmed; dispatch transport.", s.role, t.id);
      }
    } catch (error) {
      event(
        w,
        error instanceof Error ? error.message : "Simulated action rejected",
        "backend",
        t,
        "backend",
      );
    }
  }
}

export function reconcileAcceptance(
  w: Ward,
  id: string,
  offerId: string,
  revision: number,
  actor: Role,
  source = "visitor",
) {
  requireRole(actor, ["porter"]);
  const t = findTransfer(w, id),
    o = t.offers.find((o) => o.id === offerId);
  const valid =
    t.control === "ACTIVE" &&
    t.offer?.id === offerId &&
    o?.status === "pending" &&
    o.revision === t.revision &&
    revision === t.revision &&
    w.now < o.expires;
  if (valid) {
    command(
      w,
      id,
      { type: "ACCEPT", expectedRevision: revision, payload: { offerId } },
      actor,
      source,
    );
    return { accepted: true, rejected: false, transferId: id };
  }
  const reason = `Offer is no longer active: transfer ${t.control.toLowerCase()}, offer ${o?.status || "unknown"}, revision ${t.revision}`;
  event(
    w,
    `Late acceptance received${o ? ` from ${w.staff.find((s) => s.id === o.porterId)?.name}` : ""}; discarded — ${reason}`,
    actor,
    t,
    source,
  );
  if (o) {
    w.porterNotifications ||= [];
    w.porterNotifications.push({
      porterId: o.porterId,
      transferId: id,
      offerId,
      reason,
      at: w.now,
    });
    event(
      w,
      `${w.staff.find((s) => s.id === o.porterId)?.name} notified in simulated staff inbox: assignment is no longer active`,
      "backend",
      t,
      "simulated notification",
    );
  }
  return { accepted: false, rejected: true, transferId: id, message: reason };
}
export function proposeReplacement(
  w: Ward,
  messageId: string,
  oldId: string,
  patientId: string,
  destinationName: DestinationName,
  appointment: number,
) {
  const m = w.messages.find((m) => m.id === messageId),
    t = findTransfer(w, oldId);
  if (!m || m.role !== "nurse" || m.transferId !== oldId)
    throw new DomainError(
      "SOURCE",
      "A source nurse message for the old transfer is required",
    );
  if (
    !w.patients.some((p) => p.id === patientId) ||
    !Number.isFinite(appointment) ||
    appointment < w.now ||
    appointment > w.now + 7200000
  )
    throw new DomainError("TARGET", "Replacement context is invalid");
  w.replacements ||= [];
  const prior = w.replacements.find((p) => p.messageId === messageId);
  if (prior) return prior;
  if (["COLLECTED", "ARRIVED", "COMPLETED"].includes(t.phase))
    throw new DomainError(
      "STATE",
      "After collection staff intervention is required; replacement transport cannot be automatic",
    );
  if (t.control !== "CANCELLED") {
    t.control = "PAUSED";
    t.owner = "nurse";
    t.nextAction = "Nurse: confirm cancellation and replacement request";
  }
  const p: Replacement = {
    id: randomUUID(),
    messageId,
    actor: "nurse",
    oldTransferId: oldId,
    patientId,
    destinationName,
    appointment,
    revision: t.revision,
    status: "pending",
    newTransferId: null,
  };
  w.replacements.push(p);
  event(
    w,
    "Request interrupted; replacement proposed. Nurse confirmation required",
    "agent",
    t,
    "agent",
  );
  return p;
}
export function confirmReplacement(w: Ward, id: string, actor: Role) {
  requireRole(actor, ["nurse"]);
  const p = w.replacements?.find((p) => p.id === id);
  if (!p) throw new DomainError("NOT_FOUND", "Replacement missing", 404);
  if (p.status === "confirmed") return p;
  const t = findTransfer(w, p.oldTransferId);
  if (t.revision !== p.revision)
    throw new DomainError(
      "STALE_REVISION",
      "Replacement concerns an obsolete revision",
    );
  if (["COLLECTED", "ARRIVED", "COMPLETED"].includes(t.phase))
    throw new DomainError(
      "STATE",
      "Staff intervention required after collection",
    );
  if (t.control === "CANCELLING")
    return {
      waiting: true,
      message: "Await porter cancellation acknowledgement",
    };
  if (t.control !== "CANCELLED")
    command(
      w,
      t.id,
      { type: "CANCEL", expectedRevision: t.revision, payload: {} },
      actor,
    );
  if (findTransfer(w, t.id).control === "CANCELLING")
    return {
      waiting: true,
      message:
        "Await porter cancellation acknowledgement, then confirm replacement again",
    };
  const replacement = createDraft(
    w,
    p.patientId,
    p.appointment,
    p.destinationName,
  );
  p.status = "confirmed";
  p.newTransferId = replacement.id;
  event(
    w,
    `Replacement created from cancelled transfer ${t.id}; readiness must be confirmed independently`,
    actor,
    replacement,
  );
  return p;
}
