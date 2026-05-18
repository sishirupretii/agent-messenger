"use client";

import { useState } from "react";
import Link from "next/link";
import { MessageCircle, MoreHorizontal, Trash2 } from "lucide-react";
import { useAccount, useSignMessage } from "wagmi";
import { toast } from "sonner";
import type { FeedPost } from "@/lib/feed-types";
import { buildMessageToSign } from "@/lib/feed-types";
import { PeerAvatar } from "@/components/ui/Avatar";
import { PeerName } from "@/components/ui/PeerName";
import { formatRelative, shortAddress } from "@/lib/format";
import { PostBody } from "./PostBody";
import { LikeButton } from "./LikeButton";
import { Composer } from "./Composer";

export function PostCard({
  post,
  onChanged,
  isThreadHead,
}: {
  post: FeedPost;
  onChanged?: () => void;
  isThreadHead?: boolean;
}) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [liked, setLiked] = useState(!!post.liked_by_me);
  const [likeCount, setLikeCount] = useState(post.like_count ?? 0);
  const [showReply, setShowReply] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  if (deleted) return null;

  const authorAddr = post.author_address;
  const author = post.author ?? null;
  const displayName = author?.basename ?? author?.ens_name ?? null;
  const isMine = address?.toLowerCase() === authorAddr.toLowerCase();
  const createdAt = new Date(post.created_at);

  async function softDelete() {
    if (!address) return;
    if (!confirm("Delete this post?")) return;
    try {
      const ts = Date.now();
      const message = buildMessageToSign({ kind: "delete", post_id: post.id, ts });
      const signature = await signMessageAsync({ message });
      const res = await fetch(`/api/posts/${post.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ts, signature, address: address.toLowerCase() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error ?? "Delete failed");
        return;
      }
      setDeleted(true);
      onChanged?.();
      toast.success("Deleted");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Delete failed", { description: msg });
    }
  }

  return (
    <article
      className={`card rounded-md p-3 ${isThreadHead ? "border-l-2 border-l-[var(--accent)]/40" : ""}`}
    >
      <header className="flex items-start gap-2.5">
        <Link href={`/u/${authorAddr}`} className="flex-shrink-0">
          <PeerAvatar address={authorAddr} size={32} />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <Link
                href={`/u/${authorAddr}`}
                className="text-[13px] font-medium text-white truncate hover:underline"
              >
                {displayName ?? <PeerName address={authorAddr} />}
              </Link>
              {displayName && (
                <span className="text-[11px] font-mono text-white/35 truncate">
                  {shortAddress(authorAddr)}
                </span>
              )}
              <span className="text-white/20 text-xs">·</span>
              <Link
                href={`/feed/${authorAddr}/post/${post.id}`}
                className="text-[11px] text-white/40 hover:text-white whitespace-nowrap"
                title={createdAt.toLocaleString()}
              >
                {formatRelative(createdAt)}
              </Link>
            </div>
            {isMine && (
              <div className="relative flex-shrink-0">
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  className="text-white/35 hover:text-white p-1 rounded-md"
                  aria-label="More"
                >
                  <MoreHorizontal className="size-3.5" />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 top-full mt-1 card-raised rounded-md py-1 z-10 min-w-[120px]">
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        void softDelete();
                      }}
                      className="w-full text-left text-[12px] text-[var(--error)] hover:bg-white/[0.04] px-3 py-1.5 flex items-center gap-2"
                    >
                      <Trash2 className="size-3" />
                      Delete
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="mt-1 text-[14px] text-white/95 leading-relaxed">
            <PostBody text={post.content} />
          </div>
          <div className="mt-2 flex items-center gap-5">
            <LikeButton
              postId={post.id}
              liked={liked}
              count={likeCount}
              onChange={(n) => {
                setLiked(n.liked);
                setLikeCount(n.count);
              }}
            />
            <button
              onClick={() => setShowReply((v) => !v)}
              className="inline-flex items-center gap-1 text-[12px] text-white/45 hover:text-[var(--accent)] transition-colors"
              aria-label="Reply"
            >
              <MessageCircle className="size-3.5" />
              <span className="tabular-nums">
                {post.reply_count && post.reply_count > 0 ? post.reply_count : ""}
              </span>
            </button>
          </div>
          {showReply && (
            <div className="mt-3">
              <Composer
                parentId={post.id}
                autoFocus
                onPosted={() => {
                  setShowReply(false);
                  onChanged?.();
                }}
              />
            </div>
          )}
        </div>
      </header>
    </article>
  );
}
