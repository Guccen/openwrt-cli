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
  CalendarClock,
  ListFilter,
  Lightbulb,
  Monitor,
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
  const device = useRouter((state) => state.device);
  const groups: { title: string; items: { id: Page; icon: LucideIcon }[] }[] = [
    {
      title: "状态概览",
      items: [
        { id: "overview", icon: Activity },
        { id: "network", icon: Network },
        ...(device?.device === "jdcloud-ax1800"
          ? [{ id: "wirelessStatus" as const, icon: Wifi }]
          : []),
        { id: "clients", icon: Monitor },
      ],
    },
    {
      title: "网络配置",
      items: [
        { id: "lan", icon: Settings2 },
        ...(device?.role === "router"
          ? [
              { id: "wan" as const, icon: Cable },
              { id: "dhcp" as const, icon: ListFilter },
              { id: "forwarding" as const, icon: Network },
            ]
          : []),
        { id: "ipv6", icon: Globe },
        { id: "dns", icon: Globe },
        ...(device?.device === "jdcloud-ax1800" ? [{ id: "wireless" as const, icon: Wifi }] : []),
      ],
    },
    {
      title: "系统管理",
      items: [
        { id: "backup", icon: ArchiveRestore },
        { id: "leds", icon: Lightbulb },
        { id: "schedule", icon: CalendarClock },
        { id: "system", icon: Wrench },
        { id: "diagnostics", icon: Activity },
      ],
    },
  ];
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
        {groups.map((group) => (
          <SidebarGroup key={group.title}>
            <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
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
        ))}
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
