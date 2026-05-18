"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ArrowDownLeft, ArrowUpRight, Loader2 } from "lucide-react";
import { useAccount, useSendTransaction, useWaitForTransactionReceipt, useChainId, useSwitchChain } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { toast } from "sonner";
import { useChat } from "@/context/ChatProvider";
import { parseEthAmount, shareTransactionReference } from "@/lib/payment";
import { shortAddress } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Spinner } from "@/components/ui/Spinner";

const QUICK_AMOUNTS = ["0.001", "0.005", "0.01", "0.05"];

export function PaymentModal({
  open,
  onClose,
  toAddress,
  peerLabel,
  initialAmount,
}: {
  open: boolean;
  onClose: () => void;
  toAddress: string | null;
  peerLabel?: string;
  initialAmount?: string;
}) {
  const { activeConversation } = useChat();
  const { address: from } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();

  const [amount, setAmount] = useState("0.001");
  const [step, setStep] = useState<"input" | "switching" | "signing" | "mining" | "shared" | "error">(
    "input",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { sendTransactionAsync, data: txHash, reset: resetTx } = useSendTransaction();
  const { isLoading: isMining, isSuccess: isMined } = useWaitForTransactionReceipt({
    hash: txHash,
    chainId: baseSepolia.id,
    query: { enabled: !!txHash },
  });

  useEffect(() => {
    if (open) {
      setAmount(initialAmount ?? "0.001");
      setStep("input");
      setErrorMsg(null);
      resetTx();
    }
  }, [open, initialAmount, resetTx]);

  const parsed = parseEthAmount(amount);
  const canSend = !!parsed && parsed > 0n && !!from && !!toAddress;
  const wrongChain = chainId !== baseSepolia.id;

  async function send() {
    if (!canSend || !from || !toAddress || !parsed) return;
    setErrorMsg(null);
    try {
      if (wrongChain) {
        setStep("switching");
        await switchChainAsync({ chainId: baseSepolia.id });
      }
      setStep("signing");
      await sendTransactionAsync({
        to: toAddress as `0x${string}`,
        value: parsed,
        chainId: baseSepolia.id,
      });
      setStep("mining");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(msg);
      setStep("error");
    }
  }

  // When tx is mined, publish a TransactionReference message to the chat
  useEffect(() => {
    if (!isMined || !txHash || !activeConversation || !from || !toAddress || !parsed)
      return;
    if (step !== "mining") return;
    let cancelled = false;
    (async () => {
      try {
        await shareTransactionReference(activeConversation, {
          txHash,
          fromAddress: from,
          toAddress: toAddress as `0x${string}`,
          amountWei: parsed,
        });
        if (!cancelled) {
          setStep("shared");
          toast.success("Payment sent");
          setTimeout(() => onClose(), 900);
        }
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        // Tx succeeded but we couldn't post the receipt. Still a success.
        toast.success("Payment sent", {
          description: "Couldn't post the in-chat receipt: " + msg,
        });
        setStep("shared");
        setTimeout(() => onClose(), 900);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isMined, txHash, activeConversation, from, toAddress, parsed, step, onClose]);

  const sending =
    step === "switching" ||
    step === "signing" ||
    step === "mining" ||
    isMining;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6 }}
            transition={{ duration: 0.16 }}
            className="w-full max-w-sm card-raised rounded-lg p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-[15px] font-semibold text-white flex items-center gap-1.5">
                  <ArrowUpRight className="size-3.5 text-[var(--accent)]" />
                  Send ETH
                </h2>
                <p className="text-xs text-white/50 mt-0.5">
                  To {peerLabel ?? (toAddress ? shortAddress(toAddress) : "—")} on Base Sepolia
                </p>
              </div>
              <button
                onClick={onClose}
                className="text-white/45 hover:text-white p-1 -mr-1 -mt-1"
                aria-label="Close"
                disabled={sending}
              >
                <X className="size-4" />
              </button>
            </div>

            <label className="text-[10px] uppercase tracking-wider text-white/45 mb-1.5 block">
              Amount
            </label>
            <div className="relative">
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.0"
                disabled={sending}
                className="w-full rounded-md bg-white/[0.04] border border-white/[0.1] px-3 py-2 pr-14 text-[15px] font-mono text-white outline-none focus:border-white/25 transition-colors disabled:opacity-60"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/40 font-medium">
                ETH
              </span>
            </div>
            <div className="flex gap-1 mt-2">
              {QUICK_AMOUNTS.map((q) => (
                <button
                  key={q}
                  onClick={() => setAmount(q)}
                  disabled={sending}
                  className={cn(
                    "flex-1 text-[11px] rounded-md px-2 py-1 transition-colors",
                    amount === q
                      ? "bg-white/[0.1] text-white border border-white/[0.15]"
                      : "border border-white/[0.08] text-white/55 hover:text-white hover:bg-white/[0.04]",
                  )}
                >
                  {q}
                </button>
              ))}
            </div>

            <div className="mt-4 text-[11px] text-white/40 leading-relaxed">
              You&apos;ll sign in your wallet and the recipient sees a payment card
              in chat once the tx is mined.
            </div>

            {errorMsg && (
              <div className="mt-3 text-[11px] text-[var(--error)] break-words">
                {errorMsg}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={onClose}
                disabled={sending}
                className="text-xs text-white/55 hover:text-white px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={send}
                disabled={!canSend || sending}
                className="bg-white text-black text-xs font-medium rounded-md px-4 py-1.5 hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
              >
                {sending && <Spinner size={11} className="text-black" />}
                {step === "switching" && "Switching chain…"}
                {step === "signing" && "Sign in wallet…"}
                {step === "mining" && "Mining…"}
                {step === "shared" && (
                  <>
                    <ArrowDownLeft className="size-3" />
                    Sent
                  </>
                )}
                {step === "input" && "Send"}
                {step === "error" && "Try again"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
