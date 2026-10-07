"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Home", icon: HomeIcon },
  { href: "/practice", label: "Practice", icon: SparkIcon },
  { href: "/words", label: "Garden", icon: LeafIcon },
  { href: "/progress", label: "Progress", icon: ChartIcon },
  { href: "/settings", label: "Me", icon: UserIcon },
] as const;

export function TabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card/90 backdrop-blur-md"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-0.5 pb-2 pt-2.5 text-[11px] font-medium transition ${
                  active ? "text-terra" : "text-ink-soft"
                }`}
              >
                <Icon active={active} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

type IconProps = { active: boolean };
const base = "size-6";

function HomeIcon({ active }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={base} fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" />
    </svg>
  );
}
function SparkIcon({ active }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={base} fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z" />
    </svg>
  );
}
function LeafIcon({ active }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={base} fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z" />
      <path d="M5 19l7-7" fill="none" />
    </svg>
  );
}
function ChartIcon({ active }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={base} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M5 20V12M12 20V5M19 20v-9" strokeWidth={active ? 3 : 1.8} />
    </svg>
  );
}
function UserIcon({ active }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={base} fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5c1.2-4 4-6 7.5-6s6.3 2 7.5 6" fill="none" />
    </svg>
  );
}
