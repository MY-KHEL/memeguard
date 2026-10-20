import { SettingsClient } from "@/components/settings/settings-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings · Meme Guard" };

export default function SettingsPage() {
  return (
    <section className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Wallet sign-in, discipline limits, and in-app alert preferences. Meme Guard never asks for a seed phrase or private key.
        </p>
      </header>
      <SettingsClient />
    </section>
  );
}
