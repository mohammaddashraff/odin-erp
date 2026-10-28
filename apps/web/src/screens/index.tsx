"use client";
import AccountingNavigation from "../components/accounting-navigation";
import { routeEntry } from "../core/navigation";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useERP } from "../core/erp-context";
import { Loading } from "../components/ui";
const AV8 = dynamic(() => import("./av8"), { loading: () => <Loading /> });
const loading = () => <Loading />;
const Dashboard = dynamic(() => import("./overview").then((m) => m.Dashboard), {
  loading,
});
const Overview = dynamic(() => import("./overview").then((m) => m.Overview), {
  loading,
});
const Health = dynamic(() => import("./overview").then((m) => m.Health), {
  loading,
});
const HR = dynamic(() => import("./hr"), { loading });
const Masters = dynamic(() => import("./masters"), { loading });
const Documents = dynamic(() => import("./documents"), { loading });
const Approvals = dynamic(
  () => import("./documents").then((m) => m.Approvals),
  { loading },
);
const ChartOfAccounts = dynamic(() => import("./chart-of-accounts"), {
  loading,
});
const AccountingOverview = dynamic(() => import("./accounting-overview"), {
  loading,
});
const Journals = dynamic(() => import("./accounting-journals"), { loading });
const FiscalPeriods = dynamic(() => import("./accounting-periods"), {
  loading,
});
const GeneralLedger = dynamic(
  () => import("./accounting-reports").then((m) => m.GeneralLedger),
  { loading },
);
const AccountingReports = dynamic(() => import("./accounting-reports"), {
  loading,
});
const Payments = dynamic(() => import("./finance").then((m) => m.Payments), {
  loading,
});
const Banking = dynamic(() => import("./finance").then((m) => m.Banking), {
  loading,
});
const Reports = dynamic(() => import("./reports"), { loading });
const Audit = dynamic(() => import("./reports").then((m) => m.Audit), {
  loading,
});
const Pos = dynamic(() => import("./pos"), { loading });
const Administration = dynamic(() => import("./administration"), { loading });
const Access = dynamic(() => import("./access"), { loading });
export default function Screens({ route }: { route: string }) {
  const { allowed } = useERP();
  const daily = useSearchParams().get('view') === 'daily';
  const { child, module } = routeEntry(route);
  if (route === '/dashboard' && allowed('dashboard.overview.view')) return daily ? <AV8 section="dashboard"/> : <Dashboard/>;
  if (module.id === "accounting") {
    const content =
      child.id === "accounting-overview" ? (
        <AccountingOverview />
      ) : child.id === "chart-of-accounts" ? (
        <ChartOfAccounts />
      ) : child.id === "journals" ? (
        <Journals />
      ) : child.id === "periods" ? (
        <FiscalPeriods />
      ) : child.id === "general-ledger" ? (
        <GeneralLedger />
      ) : (
        <AccountingReports
          initialReport={child.initialReport}
          title={child.label}
        />
      );
    return (
      <>
        <AccountingNavigation route={route} />
        {content}
      </>
    );
  }
  switch (child.screen) {
    case "administration": return <Administration route={route} />;
    case "av8": return <AV8 section={route === "/dashboard" ? "dashboard" : route.split("/")[2]} />;
    case "hr":
      return <HR key={child.id} section={child.id === "hr-overview" ? "overview" : child.id} />;
    case "dashboard":
      return <Dashboard />;
    case "domain-overview":
      return <Overview moduleId={module.id} />;
    case "master-data":
      return <Masters kind={child.masterKind!} title={child.label} />;
    case "documents":
      return <Documents type={child.documentType!} title={child.label} />;
    case "accounting":
      return <Journals />;
    case "payments":
      return <Payments />;
    case "banking":
      return <Banking title={child.label} screenId={child.id} />;
    case "pos":
      return <Pos />;
    case "reports":
      return (
        <Reports
          title={child.label}
          category={child.reportCategory}
          initialReport={child.initialReport}
        />
      );
    case "audit":
      return <Audit />;
    case "approvals":
      return <Approvals />;
    case "system-health":
      return <Health />;
    case "access":
      return <Access page={child.id.replace("access-", "")} />;
  }
}
