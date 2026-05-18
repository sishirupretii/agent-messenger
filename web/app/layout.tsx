import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "sonner";
import "./globals.css";
import "@rainbow-me/rainbowkit/styles.css";
import { Providers } from "./providers";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const siteUrl = "https://agent-messenger.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "SIGNA",
    template: "%s · SIGNA",
  },
  description:
    "Wallet-native messaging on Base. Encrypted chats, payments, and agents — all from one wallet identity.",
  applicationName: "SIGNA",
  authors: [{ name: "SIGNA" }],
  keywords: [
    "SIGNA",
    "XMTP",
    "Base",
    "Basenames",
    "wallet messaging",
    "AI agent",
    "Groq",
    "web3 chat",
  ],
  openGraph: {
    title: "SIGNA",
    description:
      "Wallet-native messaging. Encrypted chats, payments, and agents on Base.",
    url: siteUrl,
    siteName: "SIGNA",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "SIGNA",
    description:
      "Wallet-native messaging. Encrypted chats, payments, and agents on Base.",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0f",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${spaceGrotesk.variable} ${GeistMono.variable}`}
    >
      <body>
        <Providers>{children}</Providers>
        <Toaster
          theme="dark"
          position="top-center"
          closeButton
          toastOptions={{
            style: {
              background: "#14141d",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "white",
              fontSize: 13,
            },
          }}
        />
      </body>
    </html>
  );
}
