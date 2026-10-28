import { lazy, Suspense, useEffect } from "react";
import { Redirect, Route, Switch, useLocation, useSearch } from "wouter";
import { DeviceLayout } from "@/components/layout/device-layout";
import { loginPath, pageForPath, pageRoutes, returnPath } from "@/lib/routes";
import { LoginPage } from "@/pages/login-page";
import { NotFoundPage } from "@/pages/not-found-page";
import { DeviceLoading } from "@/components/status/device-loading";
import { Button } from "@/components/ui/button";
import { ErrorAlert } from "@/components/status/error-alert";
import { useRouter } from "@/stores/router";

const OverviewPage = lazy(() =>
  import("@/pages/overview-page").then((page) => ({ default: page.OverviewPage })),
);
const NetworkPage = lazy(() =>
  import("@/pages/network-page").then((page) => ({ default: page.NetworkPage })),
);
const ClientsPage = lazy(() =>
  import("@/pages/clients-page").then((page) => ({ default: page.ClientsPage })),
);
const LanPage = lazy(() => import("@/pages/lan-page").then((page) => ({ default: page.LanPage })));
const WanPage = lazy(() => import("@/pages/wan-page").then((page) => ({ default: page.WanPage })));
const Ipv6Page = lazy(() =>
  import("@/pages/ipv6-page").then((page) => ({ default: page.Ipv6Page })),
);
const DhcpPage = lazy(() =>
  import("@/pages/dhcp-page").then((page) => ({ default: page.DhcpPage })),
);
const DnsPage = lazy(() => import("@/pages/dns-page").then((page) => ({ default: page.DnsPage })));
const ForwardingPage = lazy(() =>
  import("@/pages/forwarding-page").then((page) => ({ default: page.ForwardingPage })),
);
const WirelessPage = lazy(() =>
  import("@/pages/wireless-page").then((page) => ({ default: page.WirelessPage })),
);
const BackupPage = lazy(() =>
  import("@/pages/backup-page").then((page) => ({ default: page.BackupPage })),
);
const WirelessStatusPage = lazy(() =>
  import("@/pages/wireless-status-page").then((page) => ({ default: page.WirelessStatusPage })),
);
const SystemPage = lazy(() =>
  import("@/pages/system-page").then((page) => ({ default: page.SystemPage })),
);
const LedPage = lazy(() => import("@/pages/led-page").then((page) => ({ default: page.LedPage })));
const SchedulePage = lazy(() =>
  import("@/pages/schedule-page").then((page) => ({ default: page.SchedulePage })),
);
const DiagnosticsPage = lazy(() =>
  import("@/pages/diagnostics-page").then((page) => ({ default: page.DiagnosticsPage })),
);

export function App() {
  const session = useRouter((state) => state.session);
  const sessionReady = useRouter((state) => state.sessionReady);
  const sessionRestoreError = useRouter((state) => state.sessionRestoreError);
  const restoreSession = useRouter((state) => state.restoreSession);
  const loadDevice = useRouter((state) => state.loadDevice);
  const [location] = useLocation();
  const search = useSearch();
  useEffect(() => {
    void loadDevice();
    void restoreSession();
  }, [loadDevice, restoreSession]);
  if (!sessionReady)
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30 p-5">
        <div className="w-full max-w-sm space-y-4" aria-live="polite">
          {sessionRestoreError ? (
            <>
              <ErrorAlert message={sessionRestoreError} />
              <Button className="w-full" onClick={() => void restoreSession()}>
                重试登录状态检查
              </Button>
            </>
          ) : (
            <output className="block text-center text-sm text-muted-foreground">
              正在检查登录状态…
            </output>
          )}
        </div>
      </main>
    );
  const atLogin = location.replace(/\/$/, "") === loginPath.replace(/\/$/, "");
  if (!session)
    return atLogin ? (
      <LoginPage />
    ) : (
      <Redirect
        key="login"
        replace
        to={`${loginPath}?next=${encodeURIComponent(returnPath(location))}`}
      />
    );
  if (atLogin)
    return (
      <Redirect
        key="authenticated"
        replace
        to={returnPath(new URLSearchParams(search).get("next"))}
      />
    );
  if (location === "/") return <Redirect key="root" replace to={pageRoutes.overview.path} />;
  const page = pageForPath(location);
  if (page && location !== pageRoutes[page].path)
    return <Redirect key={pageRoutes[page].path} replace to={pageRoutes[page].path} />;
  return (
    <DeviceLayout>
      <Suspense fallback={<DeviceLoading />}>
        <Switch>
          <Route path={pageRoutes.overview.path} component={OverviewPage} />
          <Route path={pageRoutes.network.path} component={NetworkPage} />
          <Route path={pageRoutes.clients.path} component={ClientsPage} />
          <Route path={pageRoutes.wirelessStatus.path} component={WirelessStatusPage} />
          <Route path={pageRoutes.lan.path} component={LanPage} />
          <Route path={pageRoutes.wan.path} component={WanPage} />
          <Route path={pageRoutes.ipv6.path} component={Ipv6Page} />
          <Route path={pageRoutes.dhcp.path} component={DhcpPage} />
          <Route path={pageRoutes.forwarding.path} component={ForwardingPage} />
          <Route path={pageRoutes.dns.path} component={DnsPage} />
          <Route path={pageRoutes.wireless.path} component={WirelessPage} />
          <Route path={pageRoutes.backup.path} component={BackupPage} />
          <Route path={pageRoutes.system.path} component={SystemPage} />
          <Route path={pageRoutes.leds.path} component={LedPage} />
          <Route path={pageRoutes.schedule.path} component={SchedulePage} />
          <Route path={pageRoutes.diagnostics.path} component={DiagnosticsPage} />
          <Route>
            <NotFoundPage />
          </Route>
        </Switch>
      </Suspense>
    </DeviceLayout>
  );
}
