"use client";

import { useRouter, useSearchParams } from "next/navigation";

const MONTHS = [
  { v: "1", l: "Jan" }, { v: "2", l: "Feb" }, { v: "3", l: "Mar" },
  { v: "4", l: "Apr" }, { v: "5", l: "May" }, { v: "6", l: "Jun" },
  { v: "7", l: "Jul" }, { v: "8", l: "Aug" }, { v: "9", l: "Sep" },
  { v: "10", l: "Oct" }, { v: "11", l: "Nov" }, { v: "12", l: "Dec" },
];

export function MonthFilter({ availableYears, year, month }: { availableYears: number[]; year: number; month: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const years = availableYears.length > 0 ? availableYears : [year];

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    next.set(key, value);
    router.push(`/leave?${next.toString()}`);
  }

  return (
    <div className="flex items-center gap-2">
      <label className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Month:</label>
      <select
        value={month}
        onChange={(e) => update("month", e.target.value)}
        className="input-field text-sm"
        style={{ paddingTop: 8, paddingBottom: 8, minWidth: 90 }}
      >
        {MONTHS.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
      </select>
      <select
        value={year}
        onChange={(e) => update("year", e.target.value)}
        className="input-field text-sm"
        style={{ paddingTop: 8, paddingBottom: 8, minWidth: 90 }}
      >
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      <button
        type="button"
        onClick={() => router.push("/leave")}
        className="text-xs text-slate-500 hover:text-navy-700 ml-2"
        title="Clear filter, show all-time view"
      >
        Clear
      </button>
    </div>
  );
}
