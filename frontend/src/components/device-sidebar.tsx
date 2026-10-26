import { Activity, LogOut, Network, Router } from "lucide-react";
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
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";

export type Page = "overview" | "network";

export function DeviceSidebar({
  page,
  onNavigate,
  onLogout,
}: {
  page: Page;
  onNavigate: (page: Page) => void;
  onLogout: () => void;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  const items = [
    { id: "overview" as const, title: "系统概览", icon: Activity },
    { id: "network" as const, title: "网络状态", icon: Network },
  ];
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="py-3">
        <div className="flex items-center gap-1">
          <SidebarMenu className="min-w-0">
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                tooltip="设备控制台"
                onClick={() => {
                  onNavigate("overview");
                  if (isMobile) setOpenMobile(false);
                }}
              >
                <Router className="size-4 shrink-0" />
                <span className="text-sm font-semibold">设备控制台</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <SidebarTrigger className="md:hidden" aria-label="关闭菜单" />
        </div>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>设备管理</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    isActive={page === item.id}
                    tooltip={item.title}
                    aria-current={page === item.id ? "page" : undefined}
                    onClick={() => {
                      onNavigate(item.id);
                      if (isMobile) setOpenMobile(false);
                    }}
                  >
                    <item.icon />
                    <span>{item.title}</span>
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
