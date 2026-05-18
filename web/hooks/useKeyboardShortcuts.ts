"use client";

import { useEffect } from "react";

type Handlers = {
  onNewChat?: () => void;
  onSearch?: () => void;
  onSettings?: () => void;
  onHelp?: () => void;
  onEscape?: () => void;
};

const isMac =
  typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

export function useKeyboardShortcuts(handlers: Handlers) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = isMac ? e.metaKey : e.ctrlKey;

      // Don't intercept while typing in an input (except Escape)
      const target = e.target as HTMLElement | null;
      const isTyping =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if (e.key === "Escape" && handlers.onEscape) {
        handlers.onEscape();
        return;
      }

      if (isTyping) return;

      if (mod && e.key.toLowerCase() === "k" && handlers.onNewChat) {
        e.preventDefault();
        handlers.onNewChat();
      } else if (mod && e.key === "/" && handlers.onSearch) {
        e.preventDefault();
        handlers.onSearch();
      } else if (mod && e.key === "," && handlers.onSettings) {
        e.preventDefault();
        handlers.onSettings();
      } else if (e.key === "?" && handlers.onHelp) {
        // No modifier — '?' is a single key (shift+/ produces it)
        e.preventDefault();
        handlers.onHelp();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handlers]);
}

export function shortcutLabel(key: string): string {
  return isMac ? `⌘${key.toUpperCase()}` : `Ctrl+${key.toUpperCase()}`;
}
