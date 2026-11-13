import type { UIMessage } from "ai";
import { getMessageText } from "@/shared/plan-data";

// Keep geometry once per request. The full projects remain in local history.
export function compactDesignMessages(messages: UIMessage[]): UIMessage[] {
  let geometryKept = false;
  return messages.slice(-32).reverse().map(message => {
    if (message.role !== "assistant") return message;
    const text = getMessageText(message.parts);
    if (!text.includes('"floorPlan"')) return message;
    try {
      const parsed = JSON.parse(text);
      if (!parsed.floorPlan) return message;
      if (!geometryKept) { geometryKept = true; return message; }
      delete parsed.floorPlan;
      return { ...message, parts: [{ type: "text" as const, text: JSON.stringify(parsed) }] };
    } catch { return message; }
  }).reverse();
}
