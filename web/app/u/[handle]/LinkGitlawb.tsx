"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useSignMessage } from "wagmi";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/Spinner";
import { buildMessageToSign } from "@/lib/feed-types";

/**
 * Inline form for binding a gitlawb DID to your SIGNA profile.
 *
 * Renders ONLY when the connected wallet matches the profile-owner
 * address. Otherwise returns null — visitors don't see edit UI on
 * profiles that aren't theirs.
 */
export function LinkGitlawb({
  profileAddress,
  currentDid,
}: {
  profileAddress: string;
  currentDid: string | null;
}) {
  const { address: connectedAddress } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draftDid, setDraftDid] = useState(currentDid ?? "");
  const [busy, setBusy] = useState(false);

  const isOwner =
    !!connectedAddress &&
    connectedAddress.toLowerCase() === profileAddress.toLowerCase();
  if (!isOwner) return null;

  async function submit(unlink: boolean) {
    if (busy || !connectedAddress) return;
    setBusy(true);
    try {
      const gitlawb_did = unlink ? "" : draftDid.trim();
      if (
        gitlawb_did &&
        !/^did:(key|gitlawb):[a-zA-Z0-9_-]+$/.test(gitlawb_did)
      ) {
        throw new Error(
          "DID must look like did:key:z6Mk… or did:gitlawb:<slug>",
        );
      }
      const ts = Date.now();
      const message = buildMessageToSign({
        kind: "link_gitlawb",
        address: connectedAddress.toLowerCase(),
        gitlawb_did,
        ts,
      });
      const signature = await signMessageAsync({ message });
      const res = await fetch("/api/users/link-gitlawb", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: connectedAddress.toLowerCase(),
          gitlawb_did,
          ts,
          signature,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "link failed");
      toast.success(unlink ? "gitlawb DID unlinked" : "gitlawb DID linked");
      setEditing(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="mt-3">
        <button
          onClick={() => setEditing(true)}
          className="text-[11px] font-mono text-white/55 hover:text-white underline underline-offset-4"
        >
          {currentDid ? "$ signa edit gitlawb_did" : "$ signa link gitlawb"}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 border border-white/10 bg-black/30 p-3 max-w-md">
      <div className="font-mono text-[10px] uppercase tracking-wider text-white/45 mb-2">
        gitlawb_did
      </div>
      <input
        type="text"
        value={draftDid}
        onChange={(e) => setDraftDid(e.target.value)}
        placeholder="did:key:z6Mk… or did:gitlawb:<slug>"
        className="w-full rounded-md bg-white/[0.04] border border-white/10 px-3 py-2 text-[12px] font-mono text-white outline-none focus:border-white/25 transition-colors"
      />
      <p className="text-[11px] text-white/40 mt-1.5 leading-relaxed">
        attests this DID belongs to you. v1 trusts your signed claim;
        v2 will verify via UCAN. show your decentralized-git identity
        next to your wallet.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => submit(false)}
          disabled={busy || !draftDid.trim()}
          className="bg-[var(--accent)] text-black font-semibold text-[12px] uppercase tracking-wide rounded-md px-3 py-1.5 disabled:opacity-40 hover:brightness-110 transition inline-flex items-center gap-1.5"
        >
          {busy && <Spinner size={10} className="text-black" />}
          {busy ? "Signing…" : "Link"}
        </button>
        {currentDid && (
          <button
            onClick={() => submit(true)}
            disabled={busy}
            className="border border-rose-400/30 text-rose-300 text-[12px] rounded-md px-3 py-1.5 hover:bg-rose-400/[0.05] transition disabled:opacity-40"
          >
            Unlink
          </button>
        )}
        <button
          onClick={() => {
            setEditing(false);
            setDraftDid(currentDid ?? "");
          }}
          disabled={busy}
          className="text-[12px] text-white/55 hover:text-white px-2 py-1"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
