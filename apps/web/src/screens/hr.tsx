"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import EmployeeProfile from "./employee-profile";
import { useERP, useResource, decimal } from "../core/erp-context";
import { PageHeader, Panel, Resource, Table, SearchField, Fields, type FieldSpec, Button, AddButton, Dialog, ErrorNotice, Status, Pagination, useUnsaved } from "../components/ui";

const sections = [
  ["overview", "HR Overview", "hr.employee.view"],
  ["employees", "Employees", "hr.employee.view"],
  ["departments", "Departments", "hr.department.view"],
  ["attendance", "Attendance", "hr.attendance.view"],
  ["leave", "Leave Requests", "hr.leave.view"],
  ["payroll", "Monthly Payroll", "hr.payroll.view"],
];
const descriptions: Record<string, string> = {
  overview: "Start with departments and employees, then record attendance, request leave and prepare monthly salaries.",
  employees: "Add employees, assign their departments and branches, and keep their details up to date.",
  departments: "Organize your team into departments before adding employees.",
  attendance: "Record each employee’s attendance and arrival and departure times for a day.",
  leave: "Request leave for scheduled working days. Another authorized colleague reviews it, and annual leave updates the balance.",
  payroll: "Prepare base salary plus allowances minus deductions. Approval does not pay salaries or create accounting entries.",
};
export default function HR({ section }: { section: string }) {
  const { tr, allowed, name, money, date, request, notify, refs, field, user } = useERP();
  const employees = useResource(allowed("hr.employee.view") ? "/hr/employees?status=ALL" : null);
  const departments = useResource(allowed("hr.employee.view") || allowed("hr.department.view") ? "/hr/departments" : null);
  const records = useResource(["attendance", "leave", "payroll"].includes(section) ? `/hr/records/${section}` : null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const profileId = section === "employees" ? searchParams.get("employee") : null;
  const [profileVersion, setProfileVersion] = useState(0);
  const [reason, setReason] = useState("");
  const [query, setQuery] = useState(searchParams.get("search") || "");
  const [filter, setFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<any>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [review, setReview] = useState<any>(null);
  const title = sections.find(([id]) => id === section)?.[1] || "Human Resources";
  const source = section === "employees" ? employees : section === "departments" ? departments : records;
  const rows = (source.data || []).filter((row: any) => {
    const text = [row.code, row.name, row.jobTitle, row.department?.name, row.employee?.name, row.employee?.code, row.recordKey].join(" ").toLowerCase();
    return text.includes(query.toLowerCase()) && (filter === "ALL" || (section === "employees" || section === "departments" ? (row.active ? "ACTIVE" : "INACTIVE") : row.status) === filter);
  });
  const permission = section === "employees" ? "hr.employee.create" : section === "departments" ? "hr.department.create" : `hr.${section}.create`;
  const reload = () => { employees.reload(); departments.reload(); records.reload(); };
  const reviewRecord = async () => {
    setBusy(review.row.id); setError("");
    try { await request(review.status === "CANCELLED" ? `/hr/leave/${review.row.id}/cancel` : `/hr/records/${review.row.id}/review`, { method: review.status === "CANCELLED" ? "POST" : "PATCH", body: JSON.stringify({ status: review.status, reason }) }); records.reload(); notify("Saved successfully"); setReview(null); setProfileVersion((v) => v + 1); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(""); }
  };
  const columns: any[] = section === "employees" ? [
    { key: "code", label: "Employee code" },
    { key: "name", label: "Name", render: (r: any) => <button className="link" onClick={() => router.push(`/hr/employees?employee=${r.id}`)}>{name(r)}</button> },
    { key: "department", label: "Department", render: (r: any) => name(r.department) },
    { key: "jobTitle", label: "Job title" },
    { key: "branchIds", label: "Branches", render: (r: any) => (r.branchIds || []).map((id: string) => name(refs.branches.find((b: any) => b.id === id))).join("، ") },
    ...(field("employee", "salaryMinor") !== "HIDDEN" ? [{ key: "salaryMinor", label: "Base salary", render: (r: any) => money(r.salaryMinor) }] : []),
    { key: "active", label: "Status", render: (r: any) => <Status value={r.active ? "ACTIVE" : "INACTIVE"} /> },
    { key: "actions", label: "Actions", render: (r: any) => <div className="actions"><Button onClick={() => router.push(`/hr/employees?employee=${r.id}`)}>{tr("View profile")}</Button>{allowed("hr.employee.edit") ? <Button onClick={() => setEditing(r)}>{tr("Edit")}</Button> : null}</div> },
  ] : section === "departments" ? [
    { key: "code", label: "Code" }, { key: "name", label: "Department" },
    { key: "active", label: "Status", render: (r: any) => <Status value={r.active ? "ACTIVE" : "INACTIVE"} /> },
    { key: "actions", label: "Actions", render: (r: any) => allowed("hr.department.edit") ? <Button onClick={() => setEditing(r)}>{tr("Edit")}</Button> : null },
  ] : [
    { key: "employee", label: "Employee", render: (r: any) => name(r.employee) },
    ...(section === "attendance" ? [
      { key: "date", label: "Date", render: (r: any) => date(r.data.date) },
      { key: "attendanceStatus", label: "Attendance status", render: (r: any) => tr(r.data.attendanceStatus) },
      { key: "checkIn", label: "Check-in time", render: (r: any) => <bdi>{r.data.checkIn || "—"}</bdi> },
      { key: "checkOut", label: "Check-out time", render: (r: any) => <bdi>{r.data.checkOut || "—"}</bdi> },
    ] : section === "leave" ? [
      { key: "leaveType", label: "Leave type", render: (r: any) => tr(r.data.leaveType) },
      { key: "startDate", label: "From date", render: (r: any) => date(r.data.startDate) },
      { key: "endDate", label: "To date", render: (r: any) => date(r.data.endDate) },
      { key: "days", label: "Working days", render: (r: any) => r.data.days },
    ] : [
      { key: "month", label: "Salary month", render: (r: any) => <bdi>{r.data.month}</bdi> },
      ...[ ["salaryMinor", "Base salary"], ["allowanceMinor", "Allowances"], ["deductionMinor", "Deductions"], ["netMinor", "Net salary"] ].map(([key, label]) => ({ key, label, numeric: true, render: (r: any) => money(r.data[key]) })),
    ]),
    { key: "notes", label: "Notes", render: (r: any) => r.data.cancellationReason || r.data.reviewReason || r.data.notes || "—" },
    { key: "status", label: "Status", render: (r: any) => <Status value={r.status} /> },
    ...([{ key: "edit", label: "Edit", render: (r: any) => allowed(`hr.${section}.edit`) && !["APPROVED", "CANCELLED"].includes(r.status) && (section === "attendance" || String(r.createdBy) === String(user.userId || user.id)) ? <Button onClick={() => setEditing(r)}>{tr("Edit")}</Button> : null }]),
    ...(section === "attendance" ? [] : [{ key: "actions", label: "Actions", render: (r: any) => ["DRAFT", "SUBMITTED"].includes(r.status) ? String(r.createdBy) === String(user.userId || user.id) ? <small>{tr("Awaiting another colleague’s review")}</small> : <div className="actions">{["approve", "reject"].filter((action) => allowed(`hr.${section}.${action}`)).map((action) => <Button key={action} disabled={!!busy} onClick={() => { setError(""); setReason(""); setReview({ row: r, status: action === "approve" ? "APPROVED" : "REJECTED" }); }}>{tr(action === "approve" ? "Approve" : "Reject")}</Button>)}</div> : null }]),
    ...(section === "leave" ? [{ key: "cancel", label: "Actions", render: (r: any) => allowed("hr.leave.cancel") && ["SUBMITTED", "APPROVED"].includes(r.status) ? <Button onClick={() => { setReason(""); setError(""); setReview({ row: r, status: "CANCELLED" }); }}>{tr("Cancel leave")}</Button> : null }] : []),
  ];
  const editor = editing ? <HREditor key={`${editing.section || section}-${editing.id || "new"}`} section={editing.section || section} initial={editing} employees={employees.data || []} departments={departments.data || []} close={() => setEditing(null)} saved={(search: string) => { setEditing(null); setQuery(search); setFilter("ALL"); setPage(1); setProfileVersion((v) => v + 1); reload(); }}/> : null;
  const reviewDialog = review ? <Dialog title={review.status === "APPROVED" ? "Approve request" : review.status === "CANCELLED" ? "Cancel leave" : "Reject request"} close={() => { if (!busy) setReview(null); }}><p>{tr("Employee")}: {name(review.row.employee)} · <bdi>{review.row.kind === "leave" ? `${review.row.data.startDate} – ${review.row.data.endDate}` : review.row.recordKey}</bdi></p><p>{tr("Confirm this action to continue.")}</p>{review.status !== "APPROVED" ? <Fields specs={[{ key: "reason", label: "Reason", type: "textarea", required: true }]} values={{ reason }} set={(_, value) => setReason(value)}/> : null}{error ? <ErrorNotice message={error}/> : null}<div className="form-actions"><Button disabled={!!busy} onClick={() => setReview(null)}>{tr("Cancel")}</Button><Button primary busy={!!busy} disabled={review.status !== "APPROVED" && !reason.trim()} onClick={reviewRecord}>{tr("Confirm")}</Button></div></Dialog> : null;
  if (profileId) return <><EmployeeProfile key={`${profileId}-${profileVersion}`} id={profileId} back={() => router.push("/hr/employees")} edit={setEditing} action={(kind, employee) => setEditing({ section: kind, employeeId: employee.id })} reviewRequest={(row, status) => { setReason(""); setError(""); setReview({ row, status }); }}/>{editor}{reviewDialog}</>;
  return <>
    <nav className="tabs" aria-label={tr("Human Resources")}>{sections.filter(([, , p]) => allowed(p)).map(([id, label]) => <Link key={id} href={`/hr/${id}`} aria-current={section === id ? "page" : undefined}>{tr(label)}</Link>)}</nav>
    <PageHeader title={title} subtitle={descriptions[section]}>{section !== "overview" && allowed(permission) ? <AddButton onClick={() => setEditing({})}>{tr(section === "employees" ? "New Employee" : section === "departments" ? "New Department" : section === "attendance" ? "Record Attendance" : section === "leave" ? "Request Leave" : "Prepare Salary")}</AddButton> : null}</PageHeader>
    {section === "overview" ? <Resource state={{ loading: employees.loading || departments.loading, error: employees.error || departments.error, reload }}><Panel title="Your team"><div className="hr-summary"><div><strong>{(employees.data || []).filter((e: any) => e.active).length}</strong><span>{tr("Active employees")}</span></div><div><strong>{(departments.data || []).filter((d: any) => d.active).length}</strong><span>{tr("Active departments")}</span></div></div><div className="hr-start">{sections.slice(1).filter(([, , p]) => allowed(p)).map(([id, label]) => <Link key={id} href={`/hr/${id}`}><strong>{tr(label)}</strong><span>{tr(descriptions[id])}</span></Link>)}</div></Panel></Resource> : <Panel><div className="table-toolbar"><SearchField value={query} onChange={(v) => { setQuery(v); setPage(1); }} label="Search records"/><label className="field"><span>{tr("Status")}</span><select value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }}>{(section === "employees" || section === "departments" ? ["ALL", "ACTIVE", "INACTIVE"] : section === "attendance" ? ["ALL", "RECORDED"] : ["ALL", "DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "CANCELLED"]).map((v) => <option key={v} value={v}>{tr(v)}</option>)}</select></label></div><Resource state={source}><><Table columns={columns} rows={rows.slice((page - 1) * 15, page * 15)} filtered={!!query || filter !== "ALL"}/><Pagination page={page} total={rows.length} onPage={setPage}/></></Resource></Panel>}
    {editor}
    {reviewDialog}
  </>;
}
function HREditor({ section, initial, employees, departments, close, saved }: { section: string; initial: any; employees: any[]; departments: any[]; close: () => void; saved: (search: string) => void }) {
  const { tr, refs, request, notify, field, money, user } = useERP();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [values, setValues] = useState<any>({ active: true, date: today, startDate: today, endDate: today, month: today.slice(0,7), attendanceStatus: "PRESENT", leaveType: "ANNUAL", annualLeaveDays: "", employmentType: "FULL_TIME", ...initial, hireDate: initial.hireDate?.slice(0,10) || "", ...initial.data, allowance: initial.data?.allowanceMinor ? decimal(initial.data.allowanceMinor, 2) : "0", deduction: initial.data?.deductionMinor ? decimal(initial.data.deductionMinor, 2) : "0", salary: initial.salaryMinor == null ? "" : decimal(initial.salaryMinor, 2) });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const guard = useUnsaved(dirty);
  const set = (key: string, value: any) => { setDirty(true); setValues((v: any) => ({ ...v, [key]: value })); };
  const specs: FieldSpec[] = section === "employees" ? [
    { key: "code", label: "Employee code", required: true }, { key: "name", label: "Employee name", required: true, hint: "Enter the name in Arabic or English as your team uses it." },
    { key: "nameAr", label: "Arabic name" }, { key: "email", label: "Email", type: "email" }, { key: "phone", label: "Phone", type: "tel" }, { key: "hireDate", label: "Hire date", type: "date" }, { key: "employmentType", label: "Employment type", options: ["FULL_TIME", "PART_TIME", "CONTRACT"] },
    { key: "annualLeaveDays", label: "Annual leave allowance", type: "number", min: "0", max: "366", step: "1", hint: "Set the annual allowance in working days. Leave blank until your company policy is configured." },
    ...["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day, index) => ({ key: `workday-${index}`, label: day, type: "checkbox" })),
    { key: "departmentId", label: "Department", required: true, options: [{ value: "", label: "Select department" }, ...departments.filter((d) => (d.active || d.id === initial.departmentId) && (!user.dataScopes?.some((scope: any) => scope.resource === "employee" && scope.scope === "DEPARTMENT") || d.id === user.departmentId))] },
    { key: "jobTitle", label: "Job title" },
    ...refs.branches.map((b: any) => ({ key: `branch-${b.id}`, label: b.name, type: "checkbox" })),
    ...(field("employee", "salaryMinor") === "EDIT" ? [{ key: "salary", label: "Base salary", type: "decimal", hint: "Monthly salary in the company’s base currency." }] : []),
    { key: "salesEligible", label: "Can be assigned sales documents", type: "checkbox" }, { key: "active", label: "Active", type: "checkbox" },
  ] : section === "departments" ? [{ key: "code", label: "Code", required: true }, { key: "name", label: "Department name", required: true }, { key: "active", label: "Active", type: "checkbox" }] : [
    { key: "employeeId", label: "Employee", required: true, options: [{ value: "", label: "Select employee" }, ...employees.filter((e) => e.active)] },
    ...(section === "attendance" ? [
      { key: "date", label: "Date", type: "date", required: true },
      { key: "attendanceStatus", label: "Attendance status", options: ["PRESENT", "ABSENT", "REMOTE"] },
      { key: "checkIn", label: "Check-in time", type: "time" }, { key: "checkOut", label: "Check-out time", type: "time", hint: "Use local time. Check-out must be later on the same day." },
    ] : section === "leave" ? [
      { key: "leaveType", label: "Leave type", options: ["ANNUAL", "SICK", "UNPAID"] },
      { key: "startDate", label: "From date", type: "date", required: true }, { key: "endDate", label: "To date", type: "date", required: true },
    ] : [
      { key: "month", label: "Salary month", type: "month", required: true }, { key: "allowance", label: "Allowances", type: "decimal", required: true }, { key: "deduction", label: "Deductions", type: "decimal", required: true },
    ]), { key: "notes", label: "Notes", type: "textarea", wide: true },
  ];
  const fieldValues = { ...values, ...Object.fromEntries([0,1,2,3,4,5,6].map((day) => [`workday-${day}`, values[`workday-${day}`] ?? (initial.workDays || [0,1,2,3,4]).includes(day)])), ...Object.fromEntries(refs.branches.map((b: any) => [`branch-${b.id}`, values[`branch-${b.id}`] ?? (initial.branchIds || []).includes(b.id)])) };
  const selectedEmployee = employees.find((e) => e.id === values.employeeId);
  return <Dialog title={initial.id ? "Edit" : section === "employees" ? "New Employee" : section === "departments" ? "New Department" : section === "attendance" ? "Record Attendance" : section === "leave" ? "Request Leave" : "Prepare Salary"} close={() => { if (!busy) guard(close); }}><form onSubmit={async (e) => {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const body = { ...values };
      if (section === "employees") {
        body.workDays = [0,1,2,3,4,5,6].filter((day) => fieldValues[`workday-${day}`]);
        body.branchIds = refs.branches.filter((b: any) => fieldValues[`branch-${b.id}`]).map((b: any) => b.id);
        if (field("employee", "salaryMinor") !== "EDIT") delete body.salary;
      }
      const path = ["employees", "departments"].includes(section) ? `/hr/${section}${initial.id ? `/${initial.id}` : ""}` : `/hr/records/${section}${initial.id ? `/${initial.id}` : ""}`;
      await request(path, { method: initial.id ? "PATCH" : "POST", body: JSON.stringify(body) }); setDirty(false); notify("Saved successfully"); saved(["employees", "departments"].includes(section) ? values.name : (employees.find((e) => e.id === values.employeeId)?.name || ""));
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }}><p>{tr(descriptions[section])}</p>{section === "employees" ? <p>{tr("Branches")}: {tr("Select at least one branch.")}</p> : null}<Fields specs={specs} values={fieldValues} set={set}/>{section === "payroll" && selectedEmployee ? <p>{tr("Base salary")}: {money(selectedEmployee.salaryMinor)}</p> : null}{error ? <ErrorNotice message={error}/> : null}<div className="form-actions"><Button disabled={busy} onClick={() => guard(close)}>{tr("Cancel")}</Button><Button type="submit" primary busy={busy}>{tr("Save")}</Button></div></form></Dialog>;
}
