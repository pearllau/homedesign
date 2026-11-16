import { create } from "zustand";
import type { UIMessage } from "ai";

type ChatStore = {
  messages: UIMessage[];
  setMessages: (m: UIMessage[]) => void;
  clear: () => void;
};

// 对话只存在内存里：新会话从空白开始，不做跨会话恢复。
export const useChatStore = create<ChatStore>()((set) => ({
  messages: [],
  setMessages: (m) => set({ messages: m }),
  clear: () => set({ messages: [] }),
}));
