import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { UIMessage } from "ai";

type ChatStore = {
  messages: UIMessage[];
  setMessages: (m: UIMessage[]) => void;
  clear: () => void;
};

function isMessage(value: unknown): value is UIMessage {
  if (!value || typeof value !== "object") return false;
  if (!("id" in value) || typeof value.id !== "string") return false;
  if (!("role" in value) || !["user", "assistant", "system"].includes(String(value.role))) return false;
  if (!("parts" in value) || !Array.isArray(value.parts)) return false;
  return value.parts.every((part: unknown) => {
    if (!part || typeof part !== "object" || !("type" in part) || typeof part.type !== "string") return false;
    return part.type !== "text" || ("text" in part && typeof part.text === "string");
  });
}

export function restoreMessages(value: unknown): UIMessage[] {
  if (!value || typeof value !== "object" || !("messages" in value) || !Array.isArray(value.messages)) return [];
  return value.messages.filter(isMessage);
}

// 持久化聊天历史到 localStorage，刷新后可从 store 恢复
export const useChatStore = create<ChatStore>()(
  persist(
    (set) => ({
      messages: [],
      setMessages: (m) => set({ messages: m }),
      clear: () => set({ messages: [] }),
    }),
    {
      name: "ai-decor-chat",
      merge: (persisted: unknown, current) => ({ ...current, messages: restoreMessages(persisted) }),
    },
  ),
);
