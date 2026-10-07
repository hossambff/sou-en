export function WeekRing({ done, goal }: { done: number; goal: number }) {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  // A goal of 0 (e.g. joined on the last day of the week) would divide by zero: treat it as reached
  const progress = goal > 0 ? Math.min(1, done / goal) : 1;
  return (
    <svg
      viewBox="0 0 44 44"
      className="size-12 -rotate-90 shrink-0"
      role="img"
      aria-label={`${done} of ${goal} practice days this week${progress >= 1 ? ", goal reached" : ""}`}
    >
      <circle cx="22" cy="22" r={radius} fill="none" stroke="var(--bg-deep)" strokeWidth="5" />
      <circle
        cx="22"
        cy="22"
        r={radius}
        fill="none"
        stroke={progress >= 1 ? "var(--mint)" : "var(--saffron)"}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - progress)}
      />
      <text x="22" y="22" className="rotate-90 origin-center fill-[var(--ink)] text-[13px] font-semibold" textAnchor="middle" dominantBaseline="central">
        {done}
      </text>
    </svg>
  );
}
