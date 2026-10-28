<h1 align="center">📡 OpenWrt 轻量固件与设备控制台</h1>

<p align="center">为京东云 AX1800 与斐讯 N1 构建固件，用同一套简洁界面管理网络与设备。</p>

<p align="center">
  <img src="docs/assets/tech-stack/react.svg" width="32" height="32" alt="React" title="React" />
  <img src="docs/assets/tech-stack/typescript.svg" width="32" height="32" alt="TypeScript" title="TypeScript" />
  <img src="docs/assets/tech-stack/vite.svg" width="32" height="32" alt="Vite" title="Vite" />
  <img src="docs/assets/tech-stack/shadcnui.svg" width="32" height="32" alt="shadcn/ui" title="shadcn/ui" />
  <img src="docs/assets/tech-stack/tailwindcss.svg" width="32" height="32" alt="Tailwind CSS" title="Tailwind CSS" />
  <img src="docs/assets/tech-stack/bun.svg" width="32" height="32" alt="Bun" title="Bun" />
  <img src="docs/assets/tech-stack/python.svg" width="32" height="32" alt="Python" title="Python" />
  <img src="docs/assets/tech-stack/githubactions.svg" width="32" height="32" alt="GitHub Actions" title="GitHub Actions" />
</p>

<p align="center">
  <a href="docs/getting-started.md">开始使用</a> ·
  <a href="docs/flashing.md">刷机说明</a> ·
  <a href="https://github.com/Guccen/openwrt-cli/releases">下载固件</a> ·
  <a href="https://github.com/Guccen/openwrt-cli/actions/workflows/build.yml">构建固件</a>
</p>

## ✨ 可以做什么

- **查看状态**：系统、温度、存储、网口、无线连接与 DHCP 租约；概况页每 5 秒刷新，展示负载和内存趋势。
- **配置网络**：LAN / WAN、IPv6、DHCP、DNS、WiFi、地址保留和端口转发；网络改动有 120 秒确认，超时自动回滚。
- **维护设备**：备份恢复、密码、时间同步、状态灯、诊断日志与定时重启；AX1800 支持固件升级和恢复出厂。
- **保持轻量**：复用 OpenWrt 原有服务，设备端不运行 Node.js 或 Bun；界面适配桌面和手机。

## 🧭 设备与地址

| 设备与模式                      | 默认管理地址   | 固件与接线                                      |
| ------------------------------- | -------------- | ----------------------------------------------- |
| 京东云 AX1800 / RE-SS-01 主路由 | `192.168.68.1` | LiBwrt，保留 WiFi、NSS、IPv6 与拨号组件         |
| 斐讯 N1 旁路由                  | `192.168.68.2` | ImmortalWrt + ophub，关闭本机 DHCP 与 IPv6 通告 |
| 斐讯 N1 主路由                  | `192.168.69.1` | 自带网口为 LAN，默认 USB WAN，可切换无线方案    |

首次使用先通过网线登录并设置密码，无线默认关闭。N1 为单射频，2.4 / 5 GHz 二选一；完整镜像写入外置 U 盘，标准布局首次启动自动扩容，不自动写入内置 eMMC。详见[接线与初始化](docs/getting-started.md)、[N1 无线](docs/n1-wireless.md)和[存储说明](docs/storage.md)。

## 🚀 构建与检查

在 [GitHub Actions](https://github.com/Guccen/openwrt-cli/actions/workflows/build.yml) 手动运行 **Build lightweight firmware**，默认同时构建三种镜像并发布到 [Releases](https://github.com/Guccen/openwrt-cli/releases)。源码版本固定，复用下载与编译缓存；镜像生成成功与实机功能验收分别记录。

本地使用 Bun 1.4.4、Node.js 22.12 或以上版本：

```sh
bun install --frozen-lockfile
bun run check
```

完整固件编译使用 Linux 或 Actions。参数、缓存和产物说明见[固件构建](docs/firmware-build.md)，前端工作流见[前端开发](docs/frontend-development.md)。

## 📚 文档导航

| 主题       | 文档                                                                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 安装与恢复 | [首次使用](docs/getting-started.md) · [刷机步骤](docs/flashing.md) · [磁盘与扩容](docs/storage.md)                                                                                                      |
| 网络与无线 | [网络配置](docs/configuration.md) · [N1 接线方案](docs/n1-wireless.md) · [功能清单](docs/router-basics.md)                                                                                              |
| 状态与维护 | [状态和租约](docs/system-status.md) · [系统维护](docs/maintenance.md) · [消息通知](docs/notifications.md)                                                                                               |
| 灯效与计划 | [状态指示灯](docs/leds.md) · [定时任务](docs/scheduled-tasks.md)                                                                                                                                        |
| 开发与验收 | [前端开发](docs/frontend-development.md) · [固件构建](docs/firmware-build.md) · [上游版本](docs/upstream-versions.md) · [模拟测试](docs/simulation-testing.md) · [开发进度](docs/development-status.md) |

## 🤝 上游与许可

[LiBwrt](https://github.com/LiBwrt/LibWrt) · [ImmortalWrt](https://github.com/immortalwrt/immortalwrt) · [ophub](https://github.com/ophub/amlogic-s9xxx-openwrt) · [shadcn/ui](https://ui.shadcn.com/)

本仓库采用 [MIT 许可证](LICENSE)，各上游组件遵循各自许可证；[shadcn/ui 组件许可](frontend/src/components/ui/LICENSE) 随源码保留。
