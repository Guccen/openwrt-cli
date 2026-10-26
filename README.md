# OpenWrt 轻量固件与设备控制台

为京东云 AX1800 和斐讯 N1 分别构建固件，共用 React 前端。当前提供登录、系统概览、网络状态、可折叠侧栏和移动端抽屉菜单。网络修改、无线设置和在线刷机页面尚未实现，系统配置通过 SSH 完成。

## 设备与模式

| 设备              | 构建路线                                     | 默认地址     | 功能                                                                 |
| ----------------- | -------------------------------------------- | ------------ | -------------------------------------------------------------------- |
| AX1800 / RE-SS-01 | LiBwrt，qualcommax/ipq60xx                   | 192.168.68.1 | 主路由、DHCP、IPv6、拨号组件、WiFi 驱动、NSS                         |
| N1 旁路由         | ImmortalWrt ARM64 根文件系统 + ophub N1 镜像 | 192.168.68.2 | 上游网关和 DNS 为 192.168.68.1，关闭 DHCP 和 IPv6 地址通告           |
| N1 主路由         | 同上，选择 router 配置                       | 192.168.69.1 | 自带网口为 LAN，额外网口为 WAN，默认 DHCP 上网，保留拨号和 IPv6 组件 |

N1 自带一个有线网口。做主路由时，建议增加 RTL8152/RTL8153 系列 USB 有线网卡：自带网口接家里的设备或交换机，USB 网口接光猫或上游路由器。默认 USB 网口为 `eth1`，启动后用 `ip link` 核对名称。可先把 N1 的 WAN 接到现有 AX1800 的 LAN 测试。

N1 旁路由地址需排除出主路由 DHCP 分配范围。当前未预装 DNS 过滤、分流、代理或 VPN 服务，旁路由配置不会自动增加这些能力。切换 N1 模式时不要保留旧网络配置。

## 轻量化设计

- 不包含 LuCI、主题、网页终端、跑分、Docker、文件共享和代理插件。
- 只安装必要 feeds。源码、feeds、Actions 和 N1 打包依赖固定提交；N1 内核固定版本和 SHA-256。
- 前端使用 Vite、React、shadcn/ui Mira、Axios、Zustand、Bun、Oxfmt、Oxlint。通过 `bunx --bun shadcn@latest init -t vite` 初始化，界面组件均来自 shadcn/ui。
- 桌面侧栏可折叠为图标栏，小于 768px 切换为抽屉菜单，选中页面后自动收起。
- 使用系统字体和按需图标，不加载外部字体或 CDN。设备仅运行静态资源及 OpenWrt 原有接口，不运行 Bun、Node.js。
- 资源预算：原始静态资源不超过 768 KiB，按文件计算的 gzip 合计不超过 256 KiB。生产构建不输出源代码映射。
- N1 首版保留配套内核模块依赖，移除不用的无线固件及多平台模块自动加载。预编译内核尚未按 N1 单独裁剪，镜像体积以 CI 产物为准。

## 前端开发

需要 Bun 1.4.0 和 Node.js 22.12 或以上版本。

```sh
bun install --frozen-lockfile
bun run check
bun run dev
```

`check` 执行 Oxlint、Oxfmt、测试、TypeScript、生产构建和体积校验。`dist/` 是静态资源，`build/router-ui/` 是安装包目录，`build/ui-size.json` 记录资源体积。

本地演示使用两个终端，数据标记为“本地演示”，密码为 `preview-only`：

```sh
# 终端一：仅监听本机的演示接口
bun tests/preview-server.ts

# 终端二：前端
OPENWRT_API_URL=http://127.0.0.1:4174 bun run dev
```

PowerShell 设置变量：

```powershell
$env:OPENWRT_API_URL = 'http://127.0.0.1:4174'
bun run dev
```

连接真实设备时，变量应指向该设备已配置受信任证书的 HTTPS 地址。开发代理不进入生产资源，生产页面只访问同一设备上的接口。

## 构建固件

首次推送后，在 GitHub Actions 运行“Build lightweight firmware”。`device` 选择 `both` 或单台设备，`n1_role` 选择 `bypass` 或 `router`，`n1_wan` 默认 `eth1`，不可与 LAN 的 `eth0` 相同。`publish` 默认关闭，启用后创建包含设备、模式、运行编号的独立 Release。

两台设备使用独立 Ubuntu 24.04 任务，先做检查再编译。始终保留 Artifact，不依赖 Release 发布成功。只缓存下载文件，不混用工具链。产物包含固件、独立前端包、最终配置、版本锁定、源码补丁、体积报告和 SHA-256。

N1 启动镜像是 `phicomm-n1-模式-k版本.img.gz`。通用 `rootfs.tar.gz` 仅用于再次打包，不能直接刷入 N1。

Linux 构建与 CI 使用相同脚本，依赖列表见 `.github/workflows/build.yml`。各设备和模式使用独立的干净 checkout：

```sh
bun install --frozen-lockfile
bun run build
# AX1800
bash scripts/build-firmware.sh jdcloud-ax1800 router
# N1 旁路由（另一个干净 checkout）
bash scripts/build-firmware.sh phicomm-n1 bypass
bash scripts/package-n1.sh build/artifacts/*rootfs.tar.gz
# N1 主路由（再使用一个干净 checkout）
bash scripts/build-firmware.sh phicomm-n1 router eth1
bash scripts/package-n1.sh build/artifacts/*rootfs.tar.gz
```

编译使用普通用户，仅安装依赖及 N1 分区、挂载操作需要 sudo。Windows 可开发前端和运行单元测试，完整固件编译使用 CI 或 Linux。

## GitHub 模拟安装与功能测试

代码推送到 GitHub 后，`Simulate OpenWrt installation` 会自动运行，也可以在 Actions 中手动运行。它通过官方 SDK 构建真正的 `router-ui.apk`，使用校验 SHA-256 的 OpenWrt 25.12.2 ImageBuilder 生成 ARM64 测试系统，在 QEMU 中启动。接口来自运行中的 `procd`、`netifd`、`rpcd` 和 `uhttpd`，不是本地演示接口。

每次分别测试 AX1800 主路由、N1 旁路由、N1 主路由三种配置：

- 安装软件包，并逐文件核对前端资源和 ACL；重启同一磁盘后继续测试。
- 验证真实 root 登录、错误密码、未登录访问、系统和网络状态读取、受限权限及退出后的会话失效。
- 用独立虚拟客户端申请 DHCP：主路由应分配正确网段的地址，旁路由应不分配；客户端还需实际连通管理页面。
- 主路由验证 LAN 经 WAN 的 NAT 转发；核对 HTTPS 跳转、初始化状态和 DHCP/IPv6 通告配置。
- Chromium 分别使用 1280、768、390 像素宽度，检查登录、刷新、侧栏折叠、手机抽屉、退出、横向溢出和页面脚本错误。

打开运行记录，在 Artifacts 下载 `simulation-设备-模式`：包含 HTML/JUnit 报告、概览/网络/菜单截图、安装记录、启动日志、DHCP 和网络结果。失败时还保留 Playwright trace。浏览器依赖仅用于开发和 CI，不进入固件；测试密码和 SSH 密钥每次临时生成，模拟磁盘及私钥不上传。

`Build lightweight firmware` 会先等待三种模拟配置通过，再编译设备固件。编译完成后，还会安装并测试本次真实编译生成的前端 APK，失败会阻止后续打包和 Release。正式构建的模拟报告放在设备构建 Artifact 中。

模拟运行的是通用 ARM64 OpenWrt，AX1800 使用虚拟 WAN/LAN 替代物理交换机。它可以提前验证前端安装、系统服务和配置策略，但不能证明 LiBwrt/ImmortalWrt 的完整设备镜像能够启动，也不能验证 WiFi、NSS、N1 引导/eMMC、USB 网卡驱动或真实吞吐量。涉及这些能力的首次验证及相关变更仍需实机；日常前端和状态接口开发可优先依靠 CI。

Linux 本地也可使用同一流程，所需依赖见模拟 workflow。脚本会创建临时网桥和网络命名空间，需要可用的 `sudo`，不要并发运行多份：

```sh
bun install --frozen-lockfile
bun run build
bash scripts/build-simulation-package.sh
bunx playwright install --with-deps --only-shell chromium
bash scripts/simulate.sh phicomm-n1 bypass build/simulation-package/router-ui.apk
```

再次运行使用新的干净 checkout，或移走本次 `build/simulation-tools/` 和 `build/simulation-report/`。临时密钥与磁盘位于 `build/simulation-private/`，测试结束自动清理。手动强制终止时，可检查并清理同名 QEMU 进程、`br-router-ci` / `tap-router-ci` 网桥网口及 `router-ci-client` 网络命名空间。

参考：[OpenWrt QEMU 文档](https://openwrt.org/docs/guide-user/virtualization/qemu)、[OpenWrt 25.12.2 ARM64 下载与校验](https://downloads.openwrt.org/releases/25.12.2/targets/armsr/armv8/)、[Playwright CI 文档](https://playwright.dev/docs/ci)。

## 首次使用

1. AX1800 使用对应 RE-SS-01 的升级方式。N1 先确认 USB 启动条件，通过 USB 验证镜像；本项目不自动改引导或写入 eMMC。
2. 网线接入 LAN，N1 主路由额外连接 USB WAN。
3. 通过 SSH 登录，例如 `ssh root@192.168.68.1`，执行 `passwd` 设置自己的 root 密码。仓库不写入固定密码。
4. 打开对应地址的 HTTPS 页面。证书由设备生成，首次访问由用户自行确认设备证书。
5. AX1800 无线默认关闭，通过 SSH 设置自己的 SSID、加密与密码后启用。N1 首版不启用无线。

初始化状态保存在 UCI 配置，保留配置升级不会再次关闭无线或重置 LAN 地址。切换设备或 N1 模式时不要沿用旧配置。

网页登录会话仅存于内存，刷新后重新登录。权限仅允许读取系统、接口状态和当前会话权限，以及退出当前会话，没有任意执行、文件读写或 UCI 修改权限。按需刷新，不后台轮询。可用相同固件构建的 `router-ui` 包单独更新前端；ACL 或默认配置变化需同步更新或重建固件。

## 目录与验证

`configs/` 保存公共及设备配置和版本锁定；`files/` 保存默认文件；`frontend/` 为页面和 shadcn 组件；`package/router-ui/` 为安装包；`scripts/` 负责配置生成、编译、打包；`tests/` 保存测试和演示接口。

```sh
bun run check
python3 -m unittest discover -s tests/firmware -v
```

首次 CI 完整编译和模拟运行的结果，以 GitHub Actions 记录为准。设备启动、物理网口、WiFi、NSS、实际 DHCP/IPv6 环境和吞吐量仍需实机验收。

上游：[LiBwrt](https://github.com/LiBwrt/LibWrt)、[ImmortalWrt](https://github.com/immortalwrt/immortalwrt)、[ophub](https://github.com/ophub/amlogic-s9xxx-openwrt)、[shadcn/ui](https://ui.shadcn.com/)。本仓库沿用 MIT 许可证，各上游组件分别遵循其许可证，shadcn 组件许可证保存在对应目录。
