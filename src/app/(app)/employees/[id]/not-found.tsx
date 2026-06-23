import Link from "next/link";

export default function EmployeeNotFound() {
  return (
    <div className="text-center py-20">
      <div className="text-5xl mb-4 text-slate-300">◉</div>
      <h2 className="font-display text-2xl font-extrabold text-navy-700 mb-2">Employee not found</h2>
      <p className="text-slate-500 mb-6 text-sm">This employee record doesn't exist or you don't have access.</p>
      <Link href="/employees" className="btn-ghost">← Back to all employees</Link>
    </div>
  );
}
