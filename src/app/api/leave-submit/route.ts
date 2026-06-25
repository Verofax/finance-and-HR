import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendLeaveRequestToManager } from "@/lib/email";

interface SubmitBody {
  employee_id: string;
  employee_email: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  days_count: number;
  reason: string | null;
}

const VALID_TYPES = new Set(["annual", "sick", "maternity", "paternity", "mourning", "haj", "unpaid", "other"]);

export async function POST(request: Request) {
  let body: SubmitBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Validate
  if (!body.employee_id) return NextResponse.json({ error: "Missing employee_id" }, { status: 400 });
  if (!body.employee_email || !body.employee_email.includes("@"))
    return NextResponse.json({ error: "Invalid employee_email" }, { status: 400 });
  if (!VALID_TYPES.has(body.leave_type))
    return NextResponse.json({ error: "Invalid leave_type" }, { status: 400 });
  if (!body.start_date || !body.end_date)
    return NextResponse.json({ error: "Missing dates" }, { status: 400 });
  if (!body.days_count || body.days_count < 1 || body.days_count > 90)
    return NextResponse.json({ error: "Invalid days_count" }, { status: 400 });

  const supabase = createServiceClient();

  // Look up the employee + their manager
  const { data: employee, error: empErr } = await supabase
    .from("employees")
    .select("id, full_name, email, manager_email, status")
    .eq("id", body.employee_id)
    .maybeSingle();

  if (empErr || !employee) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }
  if (employee.status !== "active" && employee.status !== "on_leave") {
    return NextResponse.json({ error: "Employee is not active" }, { status: 400 });
  }
  if (!employee.manager_email) {
    return NextResponse.json({ error: "No approval manager assigned. Contact HR." }, { status: 400 });
  }

  // Capture employee email if not already on file (so future approval emails go to the right place)
  if (!employee.email) {
    await supabase.from("employees").update({ email: body.employee_email }).eq("id", employee.id);
  }

  // Current balance — for the email
  const year = new Date(body.start_date).getFullYear();
  const { data: balance } = await supabase
    .from("leave_balances")
    .select("accrued_days, carry_forward_days, taken_days, encashed_days")
    .eq("employee_id", employee.id)
    .eq("year", year)
    .eq("leave_type", body.leave_type)
    .maybeSingle();

  const remaining = balance
    ? Number(balance.accrued_days || 0) + Number(balance.carry_forward_days || 0)
        - Number(balance.taken_days || 0) - Number(balance.encashed_days || 0)
    : 0;
  const remainingAfter = remaining - body.days_count;

  // Insert the leave request — DB defaults a unique approval_token
  const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || null;
  const ua = request.headers.get("user-agent") || null;

  const { data: leaveReq, error: insErr } = await supabase
    .from("leave_requests")
    .insert({
      employee_id: employee.id,
      leave_type: body.leave_type,
      start_date: body.start_date,
      end_date: body.end_date,
      days_count: body.days_count,
      reason: body.reason || null,
      status: "pending",
      manager_email: employee.manager_email,
      submitted_via: "public_form",
      submitter_ip: ip,
      submitter_user_agent: ua,
    })
    .select("id, approval_token")
    .single();

  if (insErr || !leaveReq) {
    console.error("[leave-submit] insert failed", insErr);
    return NextResponse.json({ error: "Could not save your request. Please try again." }, { status: 500 });
  }

  // Send the email to the manager
  const emailResult = await sendLeaveRequestToManager({
    managerEmail: employee.manager_email,
    employeeName: employee.full_name,
    leaveType: body.leave_type,
    startDate: body.start_date,
    endDate: body.end_date,
    daysCount: body.days_count,
    reason: body.reason,
    approvalToken: leaveReq.approval_token,
    remainingDays: remainingAfter,
  });

  if (!emailResult.ok) {
    // Don't fail the submission if email fails — the request is in the DB
    // and admins can see it in /leave. But log it loudly.
    console.error("[leave-submit] email send failed but request was saved:", emailResult.error);
  }

  return NextResponse.json({
    ok: true,
    leave_request_id: leaveReq.id,
    manager_emailed: emailResult.ok,
  });
}
