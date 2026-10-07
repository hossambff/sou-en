import { TabBar } from "@/components/tab-bar";

/** Sou's main screens share the bottom tab bar. Full-screen flows (session, drills, check-up) live outside. */
export default function TabsLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <div className="flex flex-1 flex-col pb-[calc(5.5rem+env(safe-area-inset-bottom))]">{children}</div>
      <TabBar />
    </>
  );
}
