import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-white/[0.06]">
      <div className="max-w-5xl mx-auto px-6 lg:px-10 py-5 flex flex-wrap items-center justify-between gap-3 text-xs text-white/40">
        <div>© {new Date().getFullYear()} SIGNA</div>
        <div className="flex items-center gap-5">
          <Link href="/feed" className="hover:text-white transition-colors">
            Feed
          </Link>
          <Link href="/directory" className="hover:text-white transition-colors">
            Directory
          </Link>
          <Link href="/ecosystem" className="hover:text-white transition-colors">
            Ecosystem
          </Link>
          <Link href="/about" className="hover:text-white transition-colors">
            About
          </Link>
        </div>
      </div>
    </footer>
  );
}
