/**
 * Weekly digest email HTML template.
 * Returns a self-contained HTML string suitable for Resend / any email provider.
 * Uses table-based layout for email client compatibility.
 */

interface DigestData {
  watchlistCount: number;
  weeklyRuns: number;
  etlJobs: number;
  topCompanies: { ticker: string; name: string; latestRevenue: number | null }[];
  recentRuns: { ticker: string; strategy: string; score: number | null; verdict: string | null }[];
}

function fmtRevenue(v: number | null): string {
  if (v === null) return "—";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v.toFixed(0)}`;
}

function verdictColor(verdict: string | null): string {
  if (verdict === "Strong") return "#1F9D55";
  if (verdict === "Weak") return "#C0392B";
  return "#C99A2E";
}

export function buildDigestHtml(data: DigestData): string {
  const date = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const companiesRows = data.topCompanies.map(c => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e5e5;font-family:monospace;font-weight:600;">${c.ticker}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e5e5;color:#666;">${c.name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e5e5;font-family:monospace;text-align:right;">${fmtRevenue(c.latestRevenue)}</td>
    </tr>`).join("");

  const runsRows = data.recentRuns.map(r => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e5e5;font-family:monospace;font-weight:600;">${r.ticker}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e5e5;color:#666;font-size:12px;">${r.strategy}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e5e5;font-family:monospace;text-align:center;">${r.score ?? "—"}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e5e5;text-align:center;">
        <span style="color:${verdictColor(r.verdict)};font-weight:600;font-size:12px;">${r.verdict ?? "—"}</span>
      </td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F7F5F0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F5F0;padding:32px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e5e5e5;border-radius:8px;overflow:hidden;">

      <!-- Header -->
      <tr><td style="background:#0B0E14;padding:28px 32px;">
        <table width="100%"><tr>
          <td><span style="color:#1F9D55;font-size:18px;font-weight:700;">●</span><span style="color:#F7F5F0;font-size:18px;font-weight:600;margin-left:8px;font-family:Georgia,serif;">MarketLens</span></td>
          <td align="right"><span style="color:#5B6472;font-size:12px;">Weekly Digest</span></td>
        </tr></table>
      </td></tr>

      <!-- Date bar -->
      <tr><td style="background:#F7F5F0;padding:12px 32px;border-bottom:1px solid #e5e5e5;">
        <span style="font-size:13px;color:#5B6472;">${date}</span>
      </td></tr>

      <!-- Stats -->
      <tr><td style="padding:28px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            ${[
              { label: "Companies tracked", value: data.watchlistCount },
              { label: "Strategy runs this week", value: data.weeklyRuns },
              { label: "ETL jobs run", value: data.etlJobs },
            ].map(s => `
            <td align="center" style="width:33%;padding:16px;background:#F7F5F0;border-radius:6px;margin:0 4px;">
              <div style="font-size:28px;font-weight:700;font-family:monospace;color:#0B0E14;">${s.value}</div>
              <div style="font-size:11px;color:#5B6472;margin-top:4px;text-transform:uppercase;letter-spacing:0.08em;">${s.label}</div>
            </td>`).join("<td width='12'></td>")}
          </tr>
        </table>
      </td></tr>

      ${data.topCompanies.length > 0 ? `
      <!-- Watchlist -->
      <tr><td style="padding:0 32px 28px;">
        <div style="font-size:13px;font-weight:600;color:#0B0E14;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px;">Watchlist</div>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e5e5;border-radius:6px;overflow:hidden;">
          <tr style="background:#F7F5F0;">
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#5B6472;font-weight:500;">TICKER</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#5B6472;font-weight:500;">COMPANY</th>
            <th style="padding:8px 12px;text-align:right;font-size:11px;color:#5B6472;font-weight:500;">REVENUE (LATEST Q)</th>
          </tr>
          ${companiesRows}
        </table>
      </td></tr>` : ""}

      ${data.recentRuns.length > 0 ? `
      <!-- Recent runs -->
      <tr><td style="padding:0 32px 28px;">
        <div style="font-size:13px;font-weight:600;color:#0B0E14;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px;">Strategy Runs This Week</div>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e5e5;border-radius:6px;overflow:hidden;">
          <tr style="background:#F7F5F0;">
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#5B6472;font-weight:500;">TICKER</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#5B6472;font-weight:500;">STRATEGY</th>
            <th style="padding:8px 12px;text-align:center;font-size:11px;color:#5B6472;font-weight:500;">SCORE</th>
            <th style="padding:8px 12px;text-align:center;font-size:11px;color:#5B6472;font-weight:500;">VERDICT</th>
          </tr>
          ${runsRows}
        </table>
      </td></tr>` : ""}

      <!-- CTA -->
      <tr><td style="padding:0 32px 32px;" align="center">
        <a href="${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/dashboard" style="display:inline-block;background:#0B0E14;color:#F7F5F0;text-decoration:none;padding:12px 28px;border-radius:6px;font-size:14px;font-weight:500;">Open Dashboard →</a>
      </td></tr>

      <!-- Footer -->
      <tr><td style="background:#F7F5F0;padding:16px 32px;border-top:1px solid #e5e5e5;">
        <p style="margin:0;font-size:11px;color:#5B6472;">You received this because you're a MarketLens member. <a href="${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/dashboard/settings" style="color:#5B6472;">Unsubscribe</a></p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;
}
