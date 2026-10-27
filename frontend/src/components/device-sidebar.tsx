import {
  Activity,
  ArchiveRestore,
  Globe,
  LogOut,
  Network,
  Router,
  Settings2,
  Wifi,
  Wrench,
  Cable,
  ListFilter,
  Lightbulb,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "@/stores/router";
import { Link } from "wouter";
import { pageRoutes, type Page } from "@/lib/routes";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";

export function DeviceSidebar({
  page,
  onLogout,
  disabled = false,
}: {
  page: Page | null;
  onLogout: () => void;
  disabled?: boolean;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  const items: { id: Page; icon: LucideIcon }[] = [
    { id: "overview", icon: Activity },
    { id: "network", icon: Network },
    { id: "lan", icon: Settings2 },
    { id: "dns", icon: Globe },
  ];
  const device = useRouter((state) => state.device);
  if (device?.role === "router")
    items.splice(3, 0, { id: "wan", icon: Cable }, { id: "dhcp", icon: ListFilter });
  if (device?.device === "jdcloud-ax1800") {
    items.splice(2, 0, { id: "wirelessStatus", icon: Wifi });
    items.push({ id: "wireless", icon: Wifi });
  }
  items.push({ id: "backup", icon: ArchiveRestore });
  items.push({ id: "leds", icon: Lightbulb });
  items.push({ id: "system", icon: Wrench });
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-12 shrink-0 justify-center border-b px-2 py-0">
        <div className="flex items-center gap-1">
          <SidebarMenu className="min-w-0">
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="设备控制台">
                <Link
                  href={pageRoutes.overview.path}
                  onClick={() => {
                    if (isMobile) setOpenMobile(false);
                  }}
                >
                  <Router className="size-4 shrink-0" />
                  <span className="text-sm font-semibold">设备控制台</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <SidebarTrigger className="md:hidden" aria-label="关闭菜单" />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>设备管理</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    asChild
                    isActive={page === item.id}
                    tooltip={pageRoutes[item.id].title}
                  >
                    <Link
                      href={pageRoutes[item.id].path}
                      aria-current={page === item.id ? "page" : undefined}
                      onClick={() => {
                        if (isMobile) setOpenMobile(false);
                      }}
                    >
                      <item.icon />
                      <span>{pageRoutes[item.id].title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="退出登录"
              disabled={disabled}
              onClick={() => {
                setOpenMobile(false);
                onLogout();
              }}
            >
              <LogOut />
              <span>退出登录</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail aria-label="切换侧边栏" title="切换侧边栏" />
    </Sidebar>
  );
}
