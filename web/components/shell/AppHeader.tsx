"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Settings } from "lucide-react";
import { LogoMark } from "@/components/ui/LogoMark";
import { cn } from "@/lib/cn";

export function AppHeader({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const pathname = usePathname();
  return (
    <header className="h-14 flex items-center justify-between px-5 border-b border-white/[0.06] bg-[var(--background)] flex-shrink-0">
      <div className="flex items-center gap-6">
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
        <nav className="hidden sm:flex items-center gap-1 text-[13px]">
          <NavLink href="/me" active={pathname?.startsWith("/me") ?? false}>
            Me
          </NavLink>
          <NavLink href="/" active={pathname === "/"}>
            Chat
          </NavLink>
          <NavLink href="/tokens" active={pathname?.startsWith("/tokens") ?? false}>
            Tokens
          </NavLink>
          <NavLink href="/feed" active={pathname?.startsWith("/feed") ?? false}>
            Feed
          </NavLink>
          <NavLink href="/launchpad" active={pathname?.startsWith("/launchpad") ?? false}>
            Agents
          </NavLink>
          <NavLink href="/partners" active={pathname?.startsWith("/partners") ?? false}>
            Partners
          </NavLink>
          <NavLink href="/token" active={pathname?.startsWith("/token") ?? false}>
            Token
          </NavLink>
          <NavLink href="/try" active={pathname?.startsWith("/try") ?? false}>
            Try
          </NavLink>
        </nav>
      </div>
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

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "px-2.5 py-1 rounded-md font-medium transition-colors",
        active
          ? "text-white bg-white/[0.06]"
          : "text-white/55 hover:text-white hover:bg-white/[0.04]",
      )}
    >
      {children}
    </Link>
  );
}
