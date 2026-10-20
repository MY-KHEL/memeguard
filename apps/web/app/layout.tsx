import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { DesktopNav, MobileNav } from "@/components/main-nav";
import { RiskDisclosure } from "@/components/risk-disclosure";
import { WalletProviders } from "@/components/wallet/wallet-providers";
import { WalletButton } from "@/components/wallet/wallet-button";
import { LiveStatus } from "@/lib/live";
import { NotificationBell } from "@/components/notifications/bell";
import { RegimeBanner } from "@/components/regime-banner";
import { ThemeToggle } from "@/components/theme-toggle";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Meme Guard",
  description:
    "Risk-reduced, non-custodial Solana meme coin app. Blocks avoidable losses and enforces discipline. No check removes all risk.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col font-sans" suppressHydrationWarning>
        <WalletProviders>
          <header className="sticky top-0 z-40 border-b border-border/80 bg-background/75 backdrop-blur-xl">
            <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:h-16 sm:px-6">
              <MobileNav />
              <Link href="/" className="shrink-0 text-[15px] font-semibold tracking-tight">
                Meme Guard
              </Link>
              <DesktopNav />
              <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
                <LiveStatus className="hidden lg:inline-flex" />
                <ThemeToggle />
                <NotificationBell />
                <WalletButton />
              </div>
            </div>
          </header>
          <RegimeBanner />
          <RiskDisclosure />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">{children}</main>
          <footer className="border-t border-border px-4 py-6 text-center text-xs leading-relaxed text-muted-foreground sm:px-6">
            Non-custodial. Meme Guard never holds funds, seed phrases or private keys. Risk-reduced, not risk-free.
          </footer>
        </WalletProviders>
      </body>
    </html>
  );
}
