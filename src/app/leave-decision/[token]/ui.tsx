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
  notifyEmail: string | null;
}

export function DecisionUI(props: Props) {
  const router = useRouter();
  const [action, setAction] = useState<"approve" | "reject">(props.initialAction);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function confirm() {
    setSubmitting(true);
    const params = new URLSearchParams({
      action,
      confirmed: "1",
    });
    if (notes.trim()) params.set("notes", notes.trim());
    router.push(`/leave-decision/${props.token}?${params.toString()}`);
  }

  const isApprove = action === "approve";

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
            {props.notifyEmail && (
              <tr><td className="py-1.5 text-slate-500">Notify</td><td className="py-1.5 text-xs text-slate-600">{props.notifyEmail}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Decision toggle — using inline styles so state changes are 100% reliable */}
      <div className="grid grid-cols-2 gap-3 pt-2">
        <button
          type="button"
          onClick={() => setAction("approve")}
          disabled={submitting}
          style={{
            padding: "12px 0",
            borderRadius: 10,
            fontWeight: 600,
            fontSize: 14,
            border: "2px solid",
            cursor: submitting ? "not-allowed" : "pointer",
            background: isApprove ? "#10b981" : "#ffffff",
            color: isApprove ? "#ffffff" : "#64748b",
            borderColor: isApprove ? "#10b981" : "#e2e8f0",
            transition: "all 0.15s ease",
          }}
        >
          ✓ Approve
        </button>
        <button
          type="button"
          onClick={() => setAction("reject")}
          disabled={submitting}
          style={{
            padding: "12px 0",
            borderRadius: 10,
            fontWeight: 600,
            fontSize: 14,
            border: "2px solid",
            cursor: submitting ? "not-allowed" : "pointer",
            background: !isApprove ? "#ef4444" : "#ffffff",
            color: !isApprove ? "#ffffff" : "#64748b",
            borderColor: !isApprove ? "#ef4444" : "#e2e8f0",
            transition: "all 0.15s ease",
          }}
        >
          ✕ Reject
        </button>
      </div>

      {/* Optional notes — especially useful for rejections */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
          {isApprove ? "Notes (optional)" : "Reason for rejection (optional but helpful)"}
        </label>
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={submitting}
          placeholder={isApprove ? "Any context to share" : "e.g. Conflicts with project deadline — please reschedule"}
          className="input-field resize-none"
        />
      </div>

      <button
        type="button"
        onClick={confirm}
        disabled={submitting}
        className="btn-primary w-full justify-center"
        style={{
          background: isApprove
            ? "linear-gradient(135deg, #10b981 0%, #059669 100%)"
            : "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
        }}
      >
        {submitting
          ? "Processing…"
          : isApprove
            ? "Confirm — approve and deduct balance"
            : "Confirm — reject this request"}
      </button>
      <p className="text-xs text-slate-400 text-center">
        This is a one-time link. Once confirmed, the decision is final and the employee is notified by email.
      </p>
    </div>
  );
}
