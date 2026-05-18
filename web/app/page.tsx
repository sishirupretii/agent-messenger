"use client";

import { useAccount } from "wagmi";
import { AppHeader } from "@/components/shell/AppHeader";
import { Landing } from "@/components/shell/Landing";
import { AppShell } from "@/components/shell/AppShell";

export default function Home() {
  const { isConnected } = useAccount();

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      {isConnected ? <AppShell /> : <Landing />}
    </div>
  );
}
