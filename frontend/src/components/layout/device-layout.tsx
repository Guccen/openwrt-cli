import type { CSSProperties, ReactNode } from "react";
import { useLocation } from "wouter";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DeviceSidebar } from "@/components/device-sidebar";
import { ApplyStatus } from "@/components/apply-status";
import { ErrorAlert } from "@/components/status/error-alert";
import { pageForPath } from "@/lib/routes";
import { useRouter } from "@/stores/router";
import { useSettings } from "@/stores/settings";
import { DeviceHeader } from "./device-header";
import { PageHeader } from "./page-header";
import { DeviceFooter } from "./device-footer";

export function DeviceLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const page = pageForPath(location);
  const { error, logout } = useRouter();
  const { pending, loading } = useSettings();
  return (
    <TooltipProvider delayDuration={200}>
      <SidebarProvider style={{ "--sidebar-width": "13rem" } as CSSProperties}>
        <DeviceSidebar page={page} onLogout={() => void logout()} disabled={!!pending || loading} />
        <SidebarInset className="min-w-0">
          <DeviceHeader />
          <main className="mx-auto w-full max-w-6xl min-w-0 space-y-4 p-4 sm:p-6">
            <PageHeader page={page} />
            <ErrorAlert message={error} />
            <ApplyStatus />
            {children}
            <DeviceFooter />
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
