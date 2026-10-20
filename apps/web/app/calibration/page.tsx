import { CalibrationClient } from "@/components/calibration/calibration-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Calibration · Meme Guard" };

export default function CalibrationPage() {
  return (
    <section className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Calibration</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Per-rule precision from 24h outcomes. Thresholds stay in risk-config.json; this page only reports evidence.
        </p>
      </header>
      <CalibrationClient />
    </section>
  );
}
