"use client";
import type { Ward, Transfer } from "@/lib/domain";
// Geometry follows the user's previous ward scene; encounters remain Hemline data.
const bays = [
  { bed: 21, x: 18.9, y: 68, w: 8.1, h: 6.9 },
  { bed: 4, x: 14.55, y: 10.8, w: 3.2, h: 14.2 },
  { bed: 8, x: 49.9, y: 10.45, w: 3.65, h: 14.5 },
  { bed: 12, x: 68.16, y: 10.6, w: 3.45, h: 14.5 },
  { bed: 18, x: 86.72, y: 10.6, w: 3.45, h: 14.5 },
];
export default function WardCanvas({
  ward,
  transfer,
  onSelect,
  onAttention,
}: {
  ward: Ward;
  transfer: Transfer | null;
  onSelect: (id: string) => void;
  onAttention: (attention: boolean) => void;
}) {
  const patient = ward.patients.find((p) => p.id === transfer?.patientId);
  const porter = ward.staff.find((s) => s.id === transfer?.offer?.porterId);
  const active = ward.transfers.filter(
    (t) => t.phase !== "COMPLETED" && t.control !== "CANCELLED",
  );
  const bay = bays.find((b) => b.bed === patient?.bed);
  const route =
    transfer &&
    bay &&
    ["OFFERING", "ASSIGNED", "COLLECTED", "ARRIVED", "COMPLETED"].includes(
      transfer.phase,
    );
  return (
    <section className="ward-scene" aria-label="Interactive hospital map">
      <div className="ward-art">
        <svg
          className="floorplan"
          viewBox="0 0 2750 1536"
          role="img"
          aria-label="Hospital floor plan with interactive patient beds"
        >
          <image
            href="/images/hemline-ward-room.png"
            width="2750"
            height="1536"
          />
          {route && (
            <g className={`transport-route ${ward.paused ? "paused" : ""}`}>
              <path
                d={`M${(bay.x + bay.w / 2) * 27.5} ${(bay.y + bay.h) * 15.36}V805H260`}
                fill="none"
                stroke="#65d8cb"
                strokeWidth="3"
                strokeDasharray="9 14"
              />
              <circle
                cx={transfer.phase === "ASSIGNED" ? 1650 : 750}
                cy="805"
                r="20"
                fill="#183d40"
                stroke="#77dfd3"
                strokeWidth="3"
              />
              <text
                x={transfer.phase === "ASSIGNED" ? 1685 : 785}
                y="793"
                fill="#b4ece3"
                fontSize="20"
              >
                {porter?.name || "Offer pending"}
              </text>
              <text
                x={transfer.phase === "ASSIGNED" ? 1685 : 785}
                y="820"
                fill="#bcc7d0"
                fontSize="15"
              >
                {transfer.phase.toLowerCase()} · recorded stage
              </text>
              <text x="170" y="780" fill="#c2dedb" fontSize="21">
                {transfer.destinationName || "Radiology"}
              </text>
            </g>
          )}
        </svg>
        {bays.map((b) => {
          const p = ward.patients.find((p) => p.bed === b.bed);
          const tr = ward.transfers.find(
            (t) =>
              t.patientId === p?.id &&
              t.control !== "CANCELLED" &&
              t.phase !== "COMPLETED",
          );
          return (
            <button
              key={b.bed}
              className={`bed-overlay ${patient?.bed === b.bed ? "selected" : ""} ${tr && tr.control !== "ACTIVE" ? "blocked" : ""}`}
              style={{
                left: `${b.x}%`,
                top: `${b.y}%`,
                width: `${b.w}%`,
                height: `${b.h}%`,
              }}
              aria-label={`Bed ${b.bed}, ${p?.name}${tr ? `, ${tr.phase.toLowerCase()}` : ""}`}
              aria-pressed={patient?.bed === b.bed}
              onClick={() => p && onSelect(p.id)}
            >
              <span className="bed-label">
                <b>Bed {b.bed}</b>
                <small>{p?.name}</small>
                <em>
                  {tr
                    ? tr.control !== "ACTIVE"
                      ? tr.control.toLowerCase()
                      : tr.phase.toLowerCase()
                    : "No active transfer"}
                </em>
              </span>
            </button>
          );
        })}
      </div>
      <div className="scene-stats">
        <button onClick={() => onAttention(false)}>
          {active.length} active transfers
        </button>
        <i />
        <button onClick={() => onAttention(true)}>
          {
            active.filter(
              (t) =>
                t.control !== "ACTIVE" ||
                t.phase === "DRAFT" ||
                (t.phase === "ASSIGNED" &&
                  t.pickupDue !== null &&
                  t.pickupDue < ward.now),
            ).length
          }{" "}
          need attention
        </button>
      </div>
      <div className="scene-caption">
        Workflow visualization · positions illustrate recorded stages
      </div>
    </section>
  );
}
