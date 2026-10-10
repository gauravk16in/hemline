import { it, expect } from "vitest";
import { chatMessages } from "../lib/agent";
it("keeps multiple tool calls in one assistant turn with matched results", () => {
  const messages = chatMessages([
    { role: "user", content: "Coordinate" },
    {
      type: "function_call",
      call_id: "a",
      name: "get_transfer",
      arguments: "{}",
    },
    {
      type: "function_call",
      call_id: "b",
      name: "get_destination",
      arguments: "{}",
    },
    { type: "function_call_output", call_id: "a", output: "{}" },
    { type: "function_call_output", call_id: "b", output: "{}" },
  ]);
  expect(messages.map((m) => m.role)).toEqual([
    "system",
    "user",
    "assistant",
    "tool",
    "tool",
  ]);
  const assistant = messages[2];
  expect(
    assistant.role === "assistant" && assistant.tool_calls?.map((t) => t.id),
  ).toEqual(["a", "b"]);
});
