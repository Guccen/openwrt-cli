import { useEffect } from "react";
import { Redirect, Route, Switch, useLocation, useSearch } from "wouter";
import { DeviceLayout } from "@/components/layout/device-layout";
import { loginPath, pageForPath, pageRoutes, returnPath } from "@/lib/routes";
import { LoginPage } from "@/pages/login-page";
import { OverviewPage } from "@/pages/overview-page";
import { NetworkPage } from "@/pages/network-page";
import { LanPage } from "@/pages/lan-page";
import { DnsPage } from "@/pages/dns-page";
import { WirelessPage } from "@/pages/wireless-page";
import { BackupPage } from "@/pages/backup-page";
import { NotFoundPage } from "@/pages/not-found-page";
import { WirelessStatusPage } from "@/pages/wireless-status-page";
import { SystemPage } from "@/pages/system-page";
import { useRouter } from "@/stores/router";

export function App() {
  const session = useRouter((state) => state.session);
  const loadDevice = useRouter((state) => state.loadDevice);
  const [location] = useLocation();
  const search = useSearch();
  useEffect(() => {
    void loadDevice();
  }, [loadDevice]);
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
      <Switch>
        <Route path={pageRoutes.overview.path} component={OverviewPage} />
        <Route path={pageRoutes.network.path} component={NetworkPage} />
        <Route path={pageRoutes.wirelessStatus.path} component={WirelessStatusPage} />
        <Route path={pageRoutes.lan.path} component={LanPage} />
        <Route path={pageRoutes.dns.path} component={DnsPage} />
        <Route path={pageRoutes.wireless.path} component={WirelessPage} />
        <Route path={pageRoutes.backup.path} component={BackupPage} />
        <Route path={pageRoutes.system.path} component={SystemPage} />
        <Route>
          <NotFoundPage />
        </Route>
      </Switch>
    </DeviceLayout>
  );
}
