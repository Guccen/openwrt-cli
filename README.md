# OpenWrt 轻量固件与设备控制台

为京东云 AX1800 和斐讯 N1 分别构建轻量固件，共用基于 Vite、React 和 shadcn/ui 的管理前端。设备复用 OpenWrt 服务，不运行 Node.js、Bun 或新增常驻服务。

支持设备概览、网络与双频 WiFi 状态、LAN / WAN / DHCP / DNS / 无线配置、网络备份恢复、系统归档导出和重启。侧栏可折叠，适配桌面和手机；配置应用后有 120 秒确认，超时由设备回滚。

## 支持设备

| 设备与模式               | 默认管理地址   | 说明                                        |
| ------------------------ | -------------- | ------------------------------------------- |
| AX1800 / RE-SS-01 主路由 | `192.168.68.1` | LiBwrt，保留 WiFi、NSS、IPv6 和拨号组件     |
| N1 旁路由                | `192.168.68.2` | ImmortalWrt + ophub，关闭 DHCP 与 IPv6 通告 |
| N1 主路由                | `192.168.69.1` | 需要额外 USB 有线网卡作为 WAN               |

系统归档网页恢复、恢复出厂和在线升级尚未实现，镜像与实机验收状态见[开发进度](docs/development-status.md)。

## 快速开始

前端开发需要 Bun 1.4.0、Node.js 22.12 或以上版本：

```sh
bun install --frozen-lockfile
bun run check
bun run dev
```

本地演示接口与代理配置见[前端开发](docs/frontend-development.md)。构建固件时，在 GitHub Actions 手动运行 **Build lightweight firmware**，参数和产物说明见[构建文档](docs/firmware-build.md)。

## 文档

| 文档                                         | 内容                                        |
| -------------------------------------------- | ------------------------------------------- |
| [设备与首次使用](docs/getting-started.md)    | 主/旁路由分工、接线、默认地址、初始化       |
| [刷机步骤](docs/flashing.md)                 | AX1800 升级、N1 写卡、校验与防砖、回滚      |
| [前端开发](docs/frontend-development.md)     | 技术栈、本地演示、页面路由、组件、资源预算  |
| [固件构建](docs/firmware-build.md)           | Actions 参数、版本锁定、Linux 编译、N1 打包 |
| [模拟安装与测试](docs/simulation-testing.md) | QEMU、浏览器测试、CI 触发、报告及验收范围   |
| [网络配置与备份恢复](docs/configuration.md)  | LAN、WAN、DHCP、DNS、双频 WiFi、确认回滚    |
| [系统维护与独立更新](docs/maintenance.md)    | 系统归档、重启、单独更新前端包              |
| [开发进度](docs/development-status.md)       | 已实现功能、构建记录及未完成事项            |

## 上游与许可

[LiBwrt](https://github.com/LiBwrt/LibWrt) · [ImmortalWrt](https://github.com/immortalwrt/immortalwrt) · [ophub](https://github.com/ophub/amlogic-s9xxx-openwrt) · [shadcn/ui](https://ui.shadcn.com/)

本仓库采用 [MIT 许可证](LICENSE)，各上游组件遵循其各自许可证；[shadcn/ui 组件许可](frontend/src/components/ui/LICENSE) 随源码保留。
