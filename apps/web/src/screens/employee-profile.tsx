"use client";
import { useState } from "react";
import { useERP, useResource } from "../core/erp-context";
import { PageHeader, Panel, Resource, Table, Button, Status, Details, Tabs } from "../components/ui";

const week = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export default function EmployeeProfile({ id, back, edit, action, reviewRequest }: {
  id: string;
  back: () => void;
  edit: (employee: any) => void;
  action: (section: string, employee: any) => void;
  reviewRequest: (row: any, status: string) => void;
}) {
  const { tr, name, allowed, money, date, refs, field, user } = useERP();
  const currentYear = Number(new Intl.DateTimeFormat("en", { timeZone: "Africa/Cairo", year: "numeric" }).format(new Date()));
  const [year, setYear] = useState(currentYear);
  const [tab, setTab] = useState("Employee details");
  const state = useResource(`/hr/employees/${encodeURIComponent(id)}/profile?year=${year}`);
  const data = state.data;
  const employee = data?.employee;
  const records = data?.records || [];
  const balance = data?.leaveBalance;
  const tabs = ["Employee details", ...(data?.visibleSections.includes("leave") ? ["Leave history"] : []), ...(data?.visibleSections.includes("attendance") ? ["Attendance history"] : []), ...(data?.visibleSections.includes("payroll") ? ["Salary history"] : [])];
  const visibleTab = tabs.includes(tab) ? tab : "Employee details";
  const recordKind = visibleTab === "Leave history" ? "leave" : visibleTab === "Attendance history" ? "attendance" : "payroll";
  return <>
    <PageHeader title={employee ? name(employee) : "Employee profile"} subtitle="All employee details, leave balances, attendance and salary history in one place." back={back}>
      {employee && allowed("hr.employee.edit") ? <Button onClick={() => edit(employee)}>{tr("Edit employee")}</Button> : null}
    </PageHeader>
    <Resource state={state}>
      {employee ? <>
        <section className="employee-identity" aria-label={tr("Employee profile")}>
          <span className="employee-avatar" aria-hidden="true">{name(employee).trim().slice(0, 2)}</span>
          <div><strong>{name(employee)}</strong><p>{employee.jobTitle || tr("Job title not set")}</p><small><bdi>{employee.code}</bdi> · {name(employee.department)}</small></div>
          <Status value={employee.active ? "ACTIVE" : "INACTIVE"}/>
        </section>
        <div className="profile-year"><label className="field"><span>{tr("History year")}</span><input type="number" dir="ltr" min="1900" max="2200" value={year} onChange={(e) => { const value = Number(e.target.value); if (value >= 1900 && value <= 2200) setYear(value); }}/></label><span>{tr("Balances follow the employee’s configured working days and annual allowance.")}</span></div>
        {balance ? <div className="profile-stats">
          {[["Annual allowance", balance.allowance], ["Approved leave days", balance.used], ["Pending leave days", balance.pending], ["Available leave days", balance.available]].map(([label, value]) => <div key={label as string}><span>{tr(label as string)}</span><strong>{value == null ? tr("Not configured") : value}</strong><small>{value == null ? tr("Set the allowance in employee details.") : tr("Working days")}</small></div>)}
        </div> : null}
        {employee.active ? <div className="profile-actions">
          {allowed("hr.leave.create") ? <Button primary onClick={() => action("leave", employee)}>{tr("Request Leave")}</Button> : null}
          {allowed("hr.attendance.create") ? <Button onClick={() => action("attendance", employee)}>{tr("Record Attendance")}</Button> : null}
          {allowed("hr.payroll.create") && field("employee", "salaryMinor") === "EDIT" ? <Button onClick={() => action("payroll", employee)}>{tr("Prepare Salary")}</Button> : null}
        </div> : null}
        <Tabs tabs={tabs} value={visibleTab} set={setTab}/>
        {visibleTab === "Employee details" ? <div className="profile-columns">
          <Panel title="Contact and employment"><Details values={[
            ["Employee code", employee.code], ["Employee name", employee.name], ["Arabic name", employee.nameAr || "—"],
            ["Email", <bdi key="email">{employee.email || "—"}</bdi>], ["Phone", <bdi key="phone">{employee.phone || "—"}</bdi>],
            ["Department", name(employee.department)], ["Job title", employee.jobTitle || "—"], ["Hire date", employee.hireDate ? date(employee.hireDate) : "—"],
            ["Employment type", tr(employee.employmentType)], ["Branches", employee.branchIds.map((branchId: string) => name(refs.branches.find((branch: any) => branch.id === branchId))).join("، ")],
            ["Working days", employee.workDays.map((day: number) => tr(week[day])).join("، ")],
            ...(field("employee", "salaryMinor") !== "HIDDEN" ? [["Base salary", money(employee.salaryMinor)] as [string, any]] : []),
          ]}/></Panel>
          <Panel title="This year at a glance">
            {data.attendanceSummary ? <Details values={[["Days present", data.attendanceSummary.present], ["Days absent", data.attendanceSummary.absent], ["Remote work days", data.attendanceSummary.remote]]}/> : <p>{tr("Attendance details are not available with your permissions.")}</p>}
            <p className="profile-note">{tr("Attendance totals count recorded days only. Missing records are not counted as absence.")}</p>
            <p className="profile-note">{tr("Approved annual leave reduces the balance. Pending requests reserve days; rejected or cancelled requests do not.")}</p>
            <p className="profile-note">{tr("Sick and unpaid leave do not reduce the annual leave balance. Allowances do not carry over automatically.")}</p>
          </Panel>
        </div> : <Panel title={visibleTab}><Table caption={visibleTab} rows={records.filter((record: any) => record.kind === recordKind)} columns={[
          ...(recordKind === "leave" ? [
            { key: "leaveType", label: "Leave type", render: (row: any) => tr(row.data.leaveType) },
            { key: "startDate", label: "From date", render: (row: any) => date(row.data.startDate) },
            { key: "endDate", label: "To date", render: (row: any) => date(row.data.endDate) },
            { key: "days", label: "Working days", render: (row: any) => row.data.days },
          ] : recordKind === "attendance" ? [
            { key: "date", label: "Date", render: (row: any) => date(row.data.date) },
            { key: "attendanceStatus", label: "Attendance status", render: (row: any) => tr(row.data.attendanceStatus) },
            { key: "checkIn", label: "Check-in time", render: (row: any) => <bdi>{row.data.checkIn || "—"}</bdi> },
            { key: "checkOut", label: "Check-out time", render: (row: any) => <bdi>{row.data.checkOut || "—"}</bdi> },
          ] : [
            { key: "month", label: "Salary month", render: (row: any) => <bdi>{row.data.month}</bdi> },
            { key: "salary", label: "Base salary", numeric: true, render: (row: any) => money(row.data.salaryMinor) },
            { key: "allowance", label: "Allowances", numeric: true, render: (row: any) => money(row.data.allowanceMinor) },
            { key: "deduction", label: "Deductions", numeric: true, render: (row: any) => money(row.data.deductionMinor) },
            { key: "net", label: "Net salary", numeric: true, render: (row: any) => money(row.data.netMinor) },
          ]),
          { key: "status", label: "Status", render: (row: any) => <Status value={row.status}/> },
          ...(recordKind === "leave" ? [{ key: "actions", label: "Actions", render: (row: any) => <div className="actions">{row.status === "SUBMITTED" && String(row.createdBy) !== String(user.userId || user.id) ? ["approve", "reject"].filter((verb) => allowed(`hr.leave.${verb}`)).map((verb) => <Button key={verb} onClick={() => reviewRequest(row, verb === "approve" ? "APPROVED" : "REJECTED")}>{tr(verb === "approve" ? "Approve" : "Reject")}</Button>) : null}{["SUBMITTED", "APPROVED"].includes(row.status) && allowed("hr.leave.cancel") ? <Button onClick={() => reviewRequest(row, "CANCELLED")}>{tr("Cancel leave")}</Button> : null}</div> }] : []),
          { key: "notes", label: "Notes", render: (row: any) => row.data.cancellationReason || row.data.reviewReason || row.data.notes || "—" },
        ]}/></Panel>}
      </> : null}
    </Resource>
  </>;
}
