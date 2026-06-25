"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  token: string;
  initialAction: "approve" | "reject";
  employeeName: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  daysCount: number;
  reason: string | null;
}

export function DecisionUI(props: Props) {
  const router = useRouter();
  const [action, setAction] = useState<"approve" | "reject">(props.initialAction);
  const [submitting, setSubmitting] = useState(false);

  function confirm() {
    setSubmitting(true);
    router.push(`/leave-decision/${props.token}?action=${action}&confirmed=1`);
  }

  return (
    <div className="section-card space-y-5">
      {/* Request details */}
      <div>
        <div className="text-xs uppercase tracking-wider text-slate-400 mb-3 font-semibold">Request from</div>
        <div className="text-xl font-display font-extrabold text-navy-700 mb-3">{props.employeeName}</div>
        <table className="w-full text-sm">
          <tbody>
            <tr><td className="py-1.5 text-slate-500 w-28">Type</td><td className="py-1.5 capitalize font-medium">{props.leaveType}</td></tr>
            <tr><td className="py-1.5 text-slate-500">From</td><td className="py-1.5">{props.startDate}</td></tr>
            <tr><td className="py-1.5 text-slate-500">To</td><td className="py-1.5">{props.endDate}</td></tr>
            <tr><td className="py-1.5 text-slate-500">Days</td><td className="py-1.5 font-semibold">{props.daysCount}</td></tr>
            {props.reason && <tr><td className="py-1.5 text-slate-500 align-top">Reason</td><td className="py-1.5 italic text-slate-700">"{props.reason}"</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Decision toggle */}
      <div className="grid grid-cols-2 gap-3 pt-2">
        <button
          type="button"
          onClick={() => setAction("approve")}
          disabled={submitting}
          className={`py-3 rounded-lg font-semibold text-sm border-2 transition-colors ${
            action === "approve" ? "bg-emerald-500 text-white border-emerald-500" : "bg-white text-slate-500 border-slate-200 hover:border-emerald-500"
          }`}
        >
          ✓ Approve
        </button>
        <button
          type="button"
          onClick={() => setAction("reject")}
          disabled={submitting}
          className={`py-3 rounded-lg font-semibold text-sm border-2 transition-colors ${
            action === "reject" ? "bg-red-500 text-white border-red-500" : "bg-white text-slate-500 border-slate-200 hover:border-red-500"
          }`}
        >
          ✕ Reject
        </button>
      </div>

      <button
        type="button"
        onClick={confirm}
        disabled={submitting}
        className="btn-primary w-full justify-center"
      >
        {submitting ? "Processing…" : `Confirm — ${action === "approve" ? "approve and deduct balance" : "reject this request"}`}
      </button>
      <p className="text-xs text-slate-400 text-center">
        This is a one-time link. Once confirmed, the decision is final and the employee is notified.
      </p>
    </div>
  );
}
