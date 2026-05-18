"use client";

import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";

export function AppHeader() {
  return (
    <header className="h-14 flex items-center justify-between px-4 border-b border-white/[0.06] bg-black/30 backdrop-blur-xl flex-shrink-0">
      <Link href="/" className="flex items-center gap-2.5 group">
        <div className="size-7 rounded-lg brand-gradient shadow-md group-hover:scale-105 transition-transform" />
        <span className="text-sm font-semibold tracking-tight">
          Agent <span className="brand-text">Messenger</span>
        </span>
      </Link>
      <div className="flex items-center gap-2">
        <ConnectButton
          accountStatus={{ smallScreen: "avatar", largeScreen: "full" }}
          chainStatus={{ smallScreen: "icon", largeScreen: "icon" }}
          showBalance={false}
        />
      </div>
    </header>
  );
}
