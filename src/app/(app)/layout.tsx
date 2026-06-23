import { requireUser } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex min-h-screen">
      <Sidebar userName={user.full_name} role={user.role} />
      <main className="flex-1 min-w-0 px-8 py-8 max-w-[1400px] mx-auto">{children}</main>
    </div>
  );
}
