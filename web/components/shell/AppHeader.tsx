"use client";

import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Settings } from "lucide-react";
import { LogoMark } from "@/components/ui/LogoMark";

export function AppHeader({ onOpenSettings }: { onOpenSettings?: () => void }) {
  return (
    <header className="h-14 flex items-center justify-between px-5 border-b border-white/[0.06] bg-[var(--background)] flex-shrink-0">
      <Link href="/" className="flex items-center gap-2.5 group">
        <LogoMark size={22} className="text-white" />
        <div className="flex flex-col leading-none">
          <span className="text-[15px] font-semibold tracking-tight font-display">
            SIGNA
          </span>
          <span className="text-[9px] uppercase tracking-[0.18em] text-white/40 font-medium mt-0.5 hidden sm:block">
            wallet-native messaging
          </span>
        </div>
      </Link>
      <div className="flex items-center gap-1.5">
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            className="size-9 rounded-md flex items-center justify-center text-white/55 hover:text-white hover:bg-white/[0.05] transition-colors"
            aria-label="Settings"
            title="Settings (Ctrl/Cmd + ,)"
          >
            <Settings className="size-4" />
          </button>
        )}
        <ConnectButton
          accountStatus={{ smallScreen: "avatar", largeScreen: "full" }}
          chainStatus={{ smallScreen: "icon", largeScreen: "icon" }}
          showBalance={false}
        />
      </div>
    </header>
  );
}
