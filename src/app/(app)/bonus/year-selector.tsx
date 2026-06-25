"use client";

import { useRouter, useSearchParams } from "next/navigation";

export function YearSelector({ available, selected }: { available: number[]; selected: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const years = available.length > 0 ? available : [new Date().getFullYear()];

  return (
    <select
      value={selected}
      onChange={(e) => {
        const next = new URLSearchParams(params.toString());
        next.set("year", e.target.value);
        router.push(`/bonus?${next.toString()}`);
      }}
      className="input-field text-sm"
      style={{ paddingTop: 8, paddingBottom: 8 }}
    >
      {years.map((y) => <option key={y} value={y}>{y}</option>)}
    </select>
  );
}
