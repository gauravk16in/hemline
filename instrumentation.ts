export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.OPENAI_API_KEY &&
    process.env.NEATLOGS_API_KEY
  ) {
    const { client } = await import("./lib/agent");
    await client();
  }
}
