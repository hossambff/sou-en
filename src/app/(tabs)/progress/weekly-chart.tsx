/** 8-week bar chart of minutes spoken. Hand-rolled SVG, themed with the app's CSS variables. */
export function WeeklyChart({ weeks }: { weeks: { weekStart: string; minutes: number; label: string }[] }) {
  const width = 320;
  const height = 168;
  const pad = { top: 18, right: 4, bottom: 22, left: 26 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(10, ...weeks.map((w) => w.minutes));
  // A round top value for the axis (10, 20, 30, 50, 60, 90, 120…)
  const step = max <= 30 ? 10 : max <= 90 ? 30 : 60;
  const top = Math.ceil(max / step) * step;
  const slot = plotW / weeks.length;
  const barW = Math.min(26, slot * 0.62);
  const y = (minutes: number) => pad.top + plotH - (minutes / top) * plotH;
  const total = weeks.reduce((sum, w) => sum + w.minutes, 0);
  const best = weeks.reduce((a, b) => (b.minutes > a.minutes ? b : a), weeks[0]);
  const summary = `Minutes spoken per week, last ${weeks.length} weeks: ${weeks
    .map((w) => `${w.label} ${w.minutes}`)
    .join(", ")}. Total ${total} minutes.`;

  return (
    <figure>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={summary}>
        <title>{summary}</title>
        {/* Gridlines + y-axis labels */}
        {[0, top / 2, top].map((value) => (
          <g key={value}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={y(value)}
              y2={y(value)}
              stroke="var(--line)"
              strokeWidth="1"
              strokeDasharray={value === 0 ? undefined : "3 4"}
            />
            <text x={pad.left - 6} y={y(value)} textAnchor="end" dominantBaseline="central" fontSize="9" fill="var(--ink-soft)">
              {value}
            </text>
          </g>
        ))}
        <text x={2} y={8} fontSize="9" fill="var(--ink-soft)">
          min
        </text>
        {weeks.map((week, i) => {
          const current = i === weeks.length - 1;
          const cx = pad.left + slot * i + slot / 2;
          const h = Math.max(week.minutes > 0 ? 3 : 0, plotH - (y(week.minutes) - pad.top));
          return (
            <g key={week.weekStart}>
              {h > 0 && (
                <rect
                  x={cx - barW / 2}
                  y={pad.top + plotH - h}
                  width={barW}
                  height={h}
                  rx={Math.min(6, barW / 2)}
                  fill={current ? "var(--terra)" : "var(--saffron)"}
                  opacity={current ? 1 : 0.75}
                />
              )}
              {week.minutes > 0 && (
                <text x={cx} y={pad.top + plotH - h - 5} textAnchor="middle" fontSize="9" fontWeight="600" fill="var(--ink)">
                  {week.minutes}
                </text>
              )}
              <text
                x={cx}
                y={height - 6}
                textAnchor="middle"
                fontSize="8.5"
                fill={current ? "var(--terra)" : "var(--ink-soft)"}
                fontWeight={current ? 600 : 400}
              >
                {week.label}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex justify-between text-xs text-ink-soft">
        <span>{total} min in {weeks.length} weeks</span>
        {best && best.minutes > 0 && (
          <span>
            Best week: {best.minutes} min ({best.label === "This wk" ? "this week!" : best.label})
          </span>
        )}
      </figcaption>
    </figure>
  );
}
