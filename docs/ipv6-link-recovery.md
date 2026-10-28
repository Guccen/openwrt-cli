# 地址分配中继的断链恢复修正

[返回开发进度](development-status.md) · [固件构建](firmware-build.md)

## 已确认的现象

原生验证 [#40615677000](https://github.com/Guccen/openwrt-cli/actions/runs/40615677000) 中，两种主路由均能收到 LAN 客户端的 DHCPv6 请求，但没有向上游发出中继报文。配置切换时，wan6 短暂断链；随后物理链路和静态地址已恢复，服务日志却没有重新启用上游接口。此前静态 IPv6 转发、LAN SLAAC 和 IPv6 管理访问已通过，不能把本次失败扩大为所有 IPv6 功能失效。

两种设备和测试系统均使用 odhcpd 固定提交 `5d7be43f8b9dec0eb47e245cfab81108bb131273`。其 `odhcpd_reload()` 只有在接口仍被配置且设置了 `IFF_RUNNING` 时才保留接口，否则调用 `close_interface()`，从管理列表删除。`reload_services()` 本身已经能按链路状态停用服务；删除接口会使后续网络链路事件无法找到它。这段逻辑与失败日志吻合。

源码依据：[固定版本的接口重载](https://github.com/openwrt/odhcpd/blob/5d7be43f8b9dec0eb47e245cfab81108bb131273/src/config.c)、[链路恢复事件处理](https://github.com/openwrt/odhcpd/blob/5d7be43f8b9dec0eb47e245cfab81108bb131273/src/netlink.c)。上游提交 [4b38e6b5](https://github.com/openwrt/odhcpd/commit/4b38e6b5bb967f0ee2e378a9016a5adaaa90eba5) 的说明也指出了删除仍在使用的接口会妨碍服务恢复。

## 修正范围

- 在重载时保留 `inuse` 的接口，由 `reload_services()` 按链路状态启停服务；只有已经不再配置的接口才被删除。
- 只为主路由构建安装补丁，软件包修订号从 1 改为 2。上游源码版本或修订号变化时停止自动修改，要求重新审核。
- 固件保留独立补丁文件与摘要；仿真通过相同源码和补丁重新编译通用架构的地址分配服务，不沿用官方预编译旧包，也不混装设备架构的二进制包。两端均记录源码版本、修订号及补丁摘要。
- 租约交换开始前，核对 LAN 与上游实际加入 DHCPv6 请求组；失败时保存当时的接口运行状态。

该修正不新增常驻进程或周期任务。N1 旁路由默认不安装该服务，不受影响。

## 验证状态

本轮只做补丁干运行匹配与脚本语法核对，暂不启动原生仿真和页面回归。修正版编译和真实租约交换需要后续验收，不将源码分析记为运行验证通过。实机重点检查切换中继模式、上游网口重新连接及设备重启后，客户端能否重新获得 IPv6 地址。DHCPv6 租约交换也不能替代 RA、NDP 和运营商前缀委派的完整验证。
