import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { EarningsCalendar } from "@/components/earnings/earnings-calendar";

export default async function EarningsCalendarPage() {
  const session = await getServerSession(authOptions);
  void session;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="font-display text-2xl">Earnings Calendar</h1>
        <p className="text-sm text-muted-foreground">
          Estimated reporting dates for watchlist companies. Refresh ETL after earnings to update data.
        </p>
      </div>
      <EarningsCalendar />
    </div>
  );
}
