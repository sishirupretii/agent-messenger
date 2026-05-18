"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy, Check, RefreshCw, AlertTriangle, ArrowLeft } from "lucide-react";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { toast } from "sonner";
import { AppHeader } from "@/components/shell/AppHeader";
import { Footer } from "@/components/shell/Footer";

type Wallet = {
  privateKey: string;
  address: string;
  dbEncryptionKey: string;
};

function generateDbKey(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function gen(): Wallet {
  const pk = generatePrivateKey();
  const account = privateKeyToAccount(pk);
  return {
    privateKey: pk,
    address: account.address,
    dbEncryptionKey: generateDbKey(),
  };
}

export default function GenerateWalletPage() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  function start() {
    setWallet(gen());
  }

  function regenerate() {
    setWallet(gen());
    setCopied(null);
    toast.success("New wallet generated");
  }

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Couldn't copy");
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="flex-1">
        <section className="border-b border-white/[0.06]">
          <div className="max-w-3xl mx-auto px-6 lg:px-10 pt-12 pb-10">
            <Link
              href="/"
              className="text-xs text-white/45 hover:text-white inline-flex items-center gap-1 mb-8"
            >
              <ArrowLeft className="size-3" />
              Back
            </Link>
            <div className="text-xs uppercase tracking-wider text-white/40 mb-3">
              Setup utility
            </div>
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-[-0.03em] leading-tight">
              Generate an agent wallet
            </h1>
            <p className="text-white/55 max-w-xl mt-4 text-[15px] leading-relaxed">
              Creates a fresh wallet + XMTP database encryption key for an
              agent service. Everything is generated locally in your browser —
              nothing is sent anywhere. Use these values when setting up the
              agent on Railway.
            </p>
          </div>
        </section>

        <section className="border-b border-white/[0.06]">
          <div className="max-w-3xl mx-auto px-6 lg:px-10 py-10">
            {!wallet ? (
              <div className="flex flex-col items-start gap-4">
                <p className="text-sm text-white/65">
                  Click below to generate. The values will appear once and
                  won&apos;t be saved anywhere — copy them into your password
                  manager + Railway env vars immediately.
                </p>
                <button
                  onClick={start}
                  className="bg-white text-black font-medium rounded-md px-4 py-2 text-sm hover:bg-white/90 transition-colors"
                >
                  Generate wallet
                </button>
              </div>
            ) : (
              <>
                <div className="rounded-md p-3 mb-5 flex items-start gap-2.5 border border-amber-300/20 bg-amber-300/[0.04]">
                  <AlertTriangle className="size-3.5 text-amber-300 mt-0.5 flex-shrink-0" />
                  <div className="text-[12px] text-amber-100/80 leading-relaxed">
                    <strong className="text-amber-200 font-semibold">
                      Save these now.
                    </strong>{" "}
                    Refreshing this page or clicking Generate again replaces
                    them. The private key is the agent&apos;s identity forever
                    — losing it makes the agent unreachable.
                  </div>
                </div>

                <div className="space-y-3">
                  <Field
                    label="Public address"
                    value={wallet.address}
                    hint="Share this. Others use it to message your agent."
                    copied={copied === "Public address"}
                    onCopy={() => copy("Public address", wallet.address)}
                  />
                  <Field
                    label="XMTP_WALLET_KEY"
                    value={wallet.privateKey}
                    hint="Set as a Railway env var. Never share. Never commit."
                    copied={copied === "XMTP_WALLET_KEY"}
                    onCopy={() => copy("XMTP_WALLET_KEY", wallet.privateKey)}
                    masked
                  />
                  <Field
                    label="XMTP_DB_ENCRYPTION_KEY"
                    value={wallet.dbEncryptionKey}
                    hint="Set as a Railway env var. Encrypts the local DB."
                    copied={copied === "XMTP_DB_ENCRYPTION_KEY"}
                    onCopy={() =>
                      copy("XMTP_DB_ENCRYPTION_KEY", wallet.dbEncryptionKey)
                    }
                    masked
                  />
                </div>

                <div className="mt-6">
                  <button
                    onClick={regenerate}
                    className="text-xs text-white/55 hover:text-white inline-flex items-center gap-1.5 px-3 py-1.5 border border-white/[0.1] rounded-md hover:bg-white/[0.04] transition-colors"
                  >
                    <RefreshCw className="size-3" />
                    Generate a different one
                  </button>
                </div>
              </>
            )}
          </div>
        </section>

        <section className="border-b border-white/[0.06]">
          <div className="max-w-3xl mx-auto px-6 lg:px-10 py-10">
            <div className="text-xs uppercase tracking-wider text-white/40 mb-4">
              What to do next
            </div>
            <ol className="text-sm text-white/75 space-y-3 list-decimal pl-5">
              <li>Copy all three values into a password manager.</li>
              <li>
                Open your Railway agent service → <strong>Variables</strong>{" "}
                tab. Add:
                <ul className="mt-2 space-y-1 text-[13px] text-white/60 list-disc pl-5">
                  <li>
                    <code className="font-mono bg-white/[0.05] rounded px-1 py-0.5">
                      XMTP_WALLET_KEY
                    </code>{" "}
                    = the private key above
                  </li>
                  <li>
                    <code className="font-mono bg-white/[0.05] rounded px-1 py-0.5">
                      XMTP_DB_ENCRYPTION_KEY
                    </code>{" "}
                    = the DB key above
                  </li>
                </ul>
              </li>
              <li>
                Add the other required vars too:{" "}
                <code className="font-mono bg-white/[0.05] rounded px-1 py-0.5 text-[12px]">
                  GROQ_API_KEY
                </code>
                ,{" "}
                <code className="font-mono bg-white/[0.05] rounded px-1 py-0.5 text-[12px]">
                  XMTP_ENV=dev
                </code>
                ,{" "}
                <code className="font-mono bg-white/[0.05] rounded px-1 py-0.5 text-[12px]">
                  XMTP_DB_DIRECTORY=/data
                </code>
                ,{" "}
                <code className="font-mono bg-white/[0.05] rounded px-1 py-0.5 text-[12px]">
                  AGENT_NAME
                </code>
                .
              </li>
              <li>
                Railway redeploys automatically. Watch Logs for{" "}
                <em>&ldquo;Agent online&rdquo;</em>.
              </li>
              <li>
                Back on{" "}
                <Link
                  href="/"
                  className="text-[var(--accent)] underline underline-offset-2 hover:opacity-80"
                >
                  the chat app
                </Link>
                : New chat → paste the public address → send a message.
              </li>
            </ol>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function Field({
  label,
  value,
  hint,
  copied,
  onCopy,
  masked = false,
}: {
  label: string;
  value: string;
  hint: string;
  copied: boolean;
  onCopy: () => void;
  masked?: boolean;
}) {
  const [revealed, setRevealed] = useState(!masked);
  return (
    <div className="card rounded-md p-3">
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[10px] uppercase tracking-wider text-white/45 font-medium">
          {label}
        </label>
        <div className="flex items-center gap-1">
          {masked && (
            <button
              onClick={() => setRevealed((v) => !v)}
              className="text-[10px] text-white/55 hover:text-white px-2 py-1 rounded-sm transition-colors"
            >
              {revealed ? "Hide" : "Reveal"}
            </button>
          )}
          <button
            onClick={onCopy}
            className="text-[10px] text-white/55 hover:text-white px-2 py-1 rounded-sm inline-flex items-center gap-1 transition-colors"
          >
            {copied ? (
              <Check className="size-3 text-[var(--accent)]" />
            ) : (
              <Copy className="size-3" />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <div className="font-mono text-[12px] text-white break-all leading-relaxed select-all">
        {revealed ? value : "•".repeat(Math.min(64, value.length))}
      </div>
      <div className="text-[11px] text-white/40 mt-1.5">{hint}</div>
    </div>
  );
}
