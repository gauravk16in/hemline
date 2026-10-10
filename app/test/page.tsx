import { isLocalDemo } from "@/lib/security";
export const dynamic = "force-dynamic";
export default function TestWard() {
  if (!isLocalDemo() || process.env.DATABASE_URL || process.env.POSTGRES_URL)
    return <p>Local development/test only</p>;
  return (
    <main
      style={{
        padding: 80,
        color: "white",
        background: "#101719",
        minHeight: "100vh",
      }}
    >
      <h1>Hemline · isolated development test</h1>
      <p>
        Synthetic patients only. Resets only this named test ward. Other wards
        and global spending remain intact.
      </p>
      <p>neatlogs session: hemline-stale-acceptance-test-001</p>
      <form method="POST" action="/api/sandbox/test">
        <input
          type="hidden"
          name="sessionId"
          value="hemline-stale-acceptance-test-001"
        />
        <button type="submit">Start clean test ward</button>
      </form>
    </main>
  );
}
