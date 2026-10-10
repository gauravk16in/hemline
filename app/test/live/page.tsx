import { backend } from "@/lib/store";
import { hash, isLocalDemo } from "@/lib/security";
import type { Ward } from "@/lib/domain";
export const dynamic = "force-dynamic";
export default async function LiveTest() {
  if (!isLocalDemo() || process.env.DATABASE_URL || process.env.POSTGRES_URL)
    return <p>Local development test only</p>;
  const b = await backend();
  const { rows } = await b.db.query<{ state: Ward }>(
    "select state from hemline_sandboxes where owner=$1",
    [`test-${hash("hemline-stale-acceptance-test-001")}`],
  );
  const w = rows[0]?.state;
  return (
    <main
      style={{
        padding: "40px 6vw",
        background: "#10191d",
        color: "#edf5f4",
        minHeight: "100vh",
        fontFamily: "sans-serif",
      }}
    >
      <meta httpEquiv="refresh" content="3" />
      <h1>Hemline · Live interruption test</h1>
      <p>
        DEVELOPMENT · Real LLM + HTTP backend · Synthetic staff and patients ·
        Simulation paused
      </p>
      <p>
        neatlogs session: <strong>hemline-stale-acceptance-test-001</strong>
      </p>
      <p>
        This view updates live. Commands are exercised through the real HTTP
        API.
      </p>
      <div style={{ display: "flex", gap: 24 }}>
        {w?.transfers.map((t, i) => (
          <section
            key={t.id}
            style={{
              background: "#203036",
              padding: 24,
              borderRadius: 18,
              flex: 1,
            }}
          >
            <h2>
              T-00{i + 1} · Bed{" "}
              {w.patients.find((p) => p.id === t.patientId)?.bed} →{" "}
              {t.destinationName}
            </h2>
            <h3>{t.control === "ACTIVE" ? t.phase : t.control}</h3>
            <p>
              Porter:{" "}
              {t.offer?.status === "accepted"
                ? w.staff.find((s) => s.id === t.offer?.porterId)?.name
                : "Not assigned"}
            </p>
            <p>{t.nextAction}</p>
            <p>
              Revision {t.revision} · Offer {t.offer?.status || "none"}
            </p>
            <small>{t.id}</small>
          </section>
        ))}
      </div>
      <h2>Live event stream</h2>
      {w?.events
        .slice()
        .reverse()
        .map((e) => (
          <p
            key={e.id}
            style={{ padding: 12, borderBottom: "1px solid #32434a" }}
          >
            <small>
              {e.actor} · {e.source} · simulation{" "}
              {new Date(e.at).toISOString().slice(11, 19)}
            </small>
            <br />
            {e.text}
          </p>
        ))}
      <h2>Agent activations</h2>
      {w?.runs.map((r) => (
        <p key={r.id}>
          {r.status}: {r.summary || "Agent working…"}
        </p>
      ))}
    </main>
  );
}
