# OpenWrt 轻量固件与设备控制台

为京东云 AX1800 和斐讯 N1 分别构建固件，共用 React 前端。当前提供登录、系统概览、网络与无线状态、LAN、上游 DNS、AX1800 无线设置、网络设置备份恢复、系统配置归档导出和重启，以及可折叠侧栏和移动端抽屉菜单。配置应用后有 120 秒确认连接，未确认由设备自动回滚。在线刷机、恢复出厂和系统归档的网页恢复尚未实现。阶段完成条件见 [开发进度](docs/development-status.md)。

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
- 前端使用 Vite、React、shadcn/ui Mira、Axios、Zustand、wouter、Bun、Oxfmt、Oxlint。通过 `bunx --bun shadcn@latest init -t vite` 初始化，界面组件均来自 shadcn/ui。
- 桌面侧栏可折叠为图标栏，小于 768px 切换为抽屉菜单，选中页面后自动收起。
- 使用系统字体和按需图标，不加载外部字体或 CDN。设备通过静态资源、OpenWrt 接口和按需执行的受限 rpcd 插件提供功能，不运行 Bun、Node.js 或新增常驻服务。
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

## 页面地址与组件

| 地址                  | 页面                |
| --------------------- | ------------------- |
| `/login/`             | 登录                |
| `/overview/`          | 系统概览            |
| `/network/`           | 网络状态            |
| `/wireless/`          | AX1800 无线运行状态 |
| `/settings/lan/`      | LAN 设置            |
| `/settings/wan/`      | WAN 上网设置        |
| `/settings/dhcp/`     | DHCP 地址分配       |
| `/settings/dns/`      | DNS 设置            |
| `/settings/wireless/` | AX1800 无线设置     |
| `/settings/backup/`   | 网络设置备份与恢复  |
| `/system/`            | 系统配置导出与重启  |

使用 wouter 的 History 路由，侧栏为真实链接，支持前进、后退和直接访问。管理页按路由延迟加载，共用布局和状态组件，打开页面时再加载对应代码。未登录访问页面时跳到登录页，登录后回到原地址；会话仍只保存在内存中，刷新后重新登录并返回当前页面。登录返回地址限制为已知页面。N1 不显示无线菜单，旁路由隐藏 WAN、DHCP 菜单；直接访问这些地址也不会开放对应表单。

`App.tsx` 只负责登录判断和路由；`pages/` 保存各页面入口；`components/layout/` 保存主布局、标题和页脚；`components/overview/` 与 `components/network/` 保存状态组件；`components/settings/` 分别保存 LAN、WAN、DHCP、DNS、无线、备份表单及共用的应用确认组件。路径和标题统一在 `lib/routes.ts` 维护。

构建时为每个地址生成一个小的目录首页，全部共用同一份 JS/CSS，入口文件也纳入体积预算。uhttpd 可直接提供这些文件，深层地址刷新不依赖额外服务器或 URL 重写。测试会检查所有入口返回 200、资源使用绝对路径，以及不存在的资源仍返回 404。

## 构建固件

首次推送后，在 GitHub Actions 运行“Build lightweight firmware”。`device` 选择 `both` 或单台设备，`n1_role` 选择 `bypass` 或 `router`，`n1_wan` 默认 `eth1`，不可与 LAN 的 `eth0` 相同。`publish` 默认关闭，启用后创建包含设备、模式、运行编号的独立 Release。

两台设备使用独立 Ubuntu 24.04 任务，先做检查再编译。始终保留 Artifact，不依赖 Release 发布成功。只缓存下载文件，不混用工具链。产物包含固件、独立前端包、最终配置、版本锁定、源码补丁、体积报告和 SHA-256。N1 明确选择 generic 设备的根文件系统并核对归档内标识；目标目录清单保存在 `target-files.json`。构建失败时额外保留已有根文件系统和 APK，避免因产物收集错误丢失编译结果。

`Verify firmware configurations` 手动检查 AX1800、N1 主路由和 N1 旁路由：下载固定源码和 feeds，核对实际 Git 提交，执行 `make defconfig`，验证目标单选、必要包和轻量限制。无需等待 QEMU 或完整固件编译。`configuration-设备-模式` Artifact 保留解析配置、实际提交和日志。完整编译复用同一配置脚本。

N1 启动镜像是 `phicomm-n1-模式-k版本.img.gz`。通用 `rootfs.tar.gz` 仅用于再次打包，不能直接刷入 N1。

Linux 构建与 CI 使用相同脚本，依赖列表见 `.github/workflows/build.yml`。各设备和模式使用独立的干净 checkout：

```sh
bun install --frozen-lockfile
bun run build
# 仅解析并检查配置，不下载工具链或编译固件
bash scripts/configure-firmware.sh jdcloud-ax1800 router
# 完整编译使用另一个干净 checkout
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

`Simulate OpenWrt installation` 在 Actions 中手动运行，完整固件构建也会调用它作为前置检查。它通过官方 SDK 构建真正的 `router-ui.apk`，使用校验 SHA-256 的 OpenWrt 25.12.2 ImageBuilder 生成 ARM64 测试系统，在 QEMU 中启动。接口来自运行中的 `procd`、`netifd`、`rpcd` 和 `uhttpd`，不是本地演示接口。

普通 push / pull request 只自动执行快速代码检查，同分支新提交会取消尚未结束的旧检查。先在本地验证并集中推送，按需要手动运行固件配置、QEMU 模拟或完整固件构建；不再每次提交重复运行耗时任务。

每次分别测试 AX1800 主路由、N1 旁路由、N1 主路由三种配置：

- 安装软件包，并逐文件核对前端资源和 ACL；重启同一磁盘后继续测试。
- 验证真实 root 登录、错误密码、未登录访问、系统和网络状态读取、受限权限及退出后的会话失效。
- 用独立虚拟客户端申请 DHCP：主路由应分配正确网段的地址，旁路由应不分配；客户端还需实际连通管理页面。
- 主路由验证 LAN 经 WAN 的 NAT 转发；核对 HTTPS 跳转、初始化状态和 DHCP/IPv6 通告配置。
- 主路由切换静态 WAN 后验证真实 NAT，再回滚到 DHCP 上网；修改 DHCP 地址池后由独立客户端重新申请租约并核对范围，恢复后再次验证。PPPoE 只测试凭据校验、暂存及取消，不模拟运营商认证。
- Chromium 分别使用 1280、768、390 像素宽度，检查登录、刷新、侧栏折叠、手机抽屉、退出、横向溢出和页面脚本错误；验证独立页面地址、登录返回目标、前进后退和深层页面刷新。
- 验证真实 UCI 暂存、DNS 手动恢复、确认后保留、其他会话不能代为确认，以及发起会话结束后仍可自动恢复。
- 临时修改 LAN 地址，验证新地址确实能访问，然后不发送确认，等待设备恢复原地址。
- 测试页面 DNS 应用确认、LAN 输入校验及跨地址确认交接；AX1800 使用禁用的虚拟无线配置测试 SSID 表单，不模拟射频硬件。
- 下载网络设置备份、校验相同设备/模式、预览变更、拒绝错误备份，以及同次恢复 DNS、DHCP 后的确认流程；同次应用 LAN 和 DNS，验证失联后两个配置都能回滚。
- 验证无线只读状态权限和按需刷新；通用 QEMU 没有射频设备，连接设备列表、信号和协商速率由协议测试及本地组件测试覆盖，仍需 AX1800 实机验证。
- 验证系统归档导出、gzip 格式和 SHA-256；暂存及待确认配置期间，另一个登录会话同样不能导出或重启。最后通过维护接口真实重启虚拟机，检查 boot ID 改变、原配置保留和旧会话失效。

打开运行记录，在 Artifacts 下载 `simulation-设备-模式`：包含 HTML/JUnit 报告、页面截图、安装记录、启动日志、DHCP、网络、`configuration.json` 配置事务、`maintenance.json` 维护结果和 `routing.json` 上网及地址池结果。失败时通常保留 Playwright trace；系统导出测试关闭 trace，归档仅在内存或浏览器临时目录校验后删除，不上传归档或其中的测试密钥。浏览器依赖仅用于开发和 CI，不进入固件；测试密码和 SSH 密钥每次临时生成，模拟磁盘及私钥不上传。

`Build lightweight firmware` 会先等待三种模拟配置通过，再编译设备固件。编译完成后，还会安装并测试本次真实编译生成的前端 APK，失败会阻止后续打包和 Release。正式构建的模拟报告放在设备构建 Artifact 中。

模拟运行的是通用 ARM64 OpenWrt，AX1800 使用虚拟 WAN/LAN 替代物理交换机。官方测试系统通过 `openssl-util` 生成证书，设备构建使用对应 fork 的 `px5g-openssl`。它可以提前验证前端安装、系统服务和配置策略，但不能证明 LiBwrt/ImmortalWrt 的完整设备镜像能够启动，也不能验证 WiFi、NSS、N1 引导/eMMC、USB 网卡驱动或真实吞吐量。涉及这些能力的首次验证及相关变更仍需实机；日常前端和状态接口开发可优先依靠 CI。

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
5. AX1800 无线默认关闭，在“无线设置”填写自己的 SSID、加密与密码后启用，也可通过 SSH 配置。N1 首版不启用无线。

初始化状态保存在 UCI 配置，保留配置升级不会再次关闭无线或重置 LAN 地址。切换设备或 N1 模式时不要沿用旧配置。

网页登录会话仅存于内存，刷新后重新登录。配置权限限制在 `network`、`dhcp`、`wireless` 三个 UCI 文件，未授予直接 `commit`、任意执行、`file` 接口或其他系统配置的写权限。正常页面按需读取；仅在配置待确认期间探测连接。

AX1800 的“无线状态”显示射频启用/启动状态、运行接口、实际信道、连接设备 MAC、信号、连接时长及接收/发送协商速率。通过 `network.wireless.status` 和 `iwinfo.info / assoclist` 读取，不授予扫描或断开客户端权限。`rpcd-mod-iwinfo` 仅加入 AX1800 的正式配置；N1 隐藏无线菜单。

“系统维护”使用 `router.maintenance` 固定操作插件。导出沿用 `sysupgrade -b` 的标准配置列表，归档最大 128 KiB，临时文件置于私有目录并在结束后删除；客户端验证大小、gzip 标记及 SHA-256 后下载。归档可能包含密码哈希及私钥，不是完整磁盘备份，也不包含 N1 引导分区。系统归档的网页恢复尚未开放。

重启需要页面二次确认，后台只调用固定的 `system.reboot`，不接受命令或路径。后台检查所有 rpcd 会话的暂存差异及回滚快照，并在执行前再次检查；备份和重启通过互斥目录串行执行。请在维护期间停止其他窗口或 SSH 的配置修改；这些操作与 OpenWrt 原生 UCI 接口不构成原子事务。重启后页面短时探测设备，原会话失效后返回登录页。演示接口不会备份宿主机或执行重启。

## 修改设置与独立更新

- LAN：修改 IPv4 地址和子网掩码；旁路由还可修改上游网关。会保留桥接、WAN 及其他现有字段；如果旁路由 DNS 仍跟随默认网关，网关修改时同步更新。
- WAN：主路由支持自动获取、静态 IPv4、PPPoE 拨号和上游 DNS。宽带密码留空保留，切回其他上网方式时清除旧拨号凭据；保留当前网口、VLAN 及独立 IPv6 接口。N1 主路由需要额外 USB 网卡。
- DHCP：主路由支持 IPv4 地址分配开关、起止地址和租期，保留静态租约及 IPv6 设置。地址池不能包含路由器地址；缩小 LAN 网段前，先调整地址池使其仍位于新网段内。
- DNS：支持最多 4 个 IPv4/IPv6 上游地址。留空恢复自动 DNS。现有域名定向 DNS 等高级规则应通过 SSH 管理。
- 无线：AX1800 按实际频段显示 2.4 GHz、5 GHz 独立卡片，可分别修改 AP 的启用状态、SSID、WPA2/WPA3 兼容加密、密码和隐藏状态。两种频段可以使用相同或不同名称；已有密码不会填入输入框，留空保留。频段按设备配置识别，不根据 radio 编号猜测；企业认证、客户端等高级接口不开放编辑。
- 备份与恢复：导出 LAN、DHCP 地址池、上游 DNS 和支持的无线 AP 设置为 JSON；选择同型号、同主/旁路由模式的备份，预览差异后恢复。格式 v2 增加 DHCP，兼容 v1 备份，恢复 v1 时保留当前地址池。高级无线接口会明确列出并跳过；不改变 WAN、桥接、无线网络绑定等其他字段，不增加设备写文件或任意命令权限。

网络备份最大 64 KiB，仅在当前浏览器读写。文件包含明文 WiFi 密钥，请妥善保管；预览隐藏密钥。备份不包含 SSH 密钥、设备登录密码、WAN 和宽带拨号凭据、DNS 域名定向规则及其他系统配置。存在高级 LAN、DHCP 或不支持的 DNS 策略时需使用 SSH 管理备份。恢复和普通配置修改共用设备端的确认回滚流程。

点击应用前先检查输入，再确认开始 120 秒计时。LAN 地址变化时，使用“打开新地址并确认”按钮，在新页面检查连接后保留设置。页面通过校验来源和窗口的 `postMessage` 传递当前短期会话，令牌不放入 URL 或浏览器持久存储。若换了网段，需要重新连接网络；新地址可能需要确认设备证书。

选择“恢复原设置”可主动回滚。关闭页面或失联后，不需要浏览器继续运行，设备会在未确认时回滚。rpcd 的回滚快照和计时器位于内存，**应用期间不要重启、断电或更新系统服务**；这类中断不保证自动恢复，仍需 SSH 或设备恢复方式。此处使用 [rpcd UCI 接口](https://github.com/openwrt/rpcd/blob/master/uci.c) 的 `apply / confirm / rollback`，不直接提交设置。

`router-ui` 0.5.0 可单独更新静态资源、ACL 和维护插件，安装后重启 rpcd，刷新页面并重新登录以取得新接口和权限。AX1800 的无线运行详情还需要安装固件来源匹配的 `rpcd-mod-iwinfo`。仅使用自己构建且已核对 SHA-256 的包，在没有暂存或待确认配置时更新，例如：

```sh
scp -O router-ui-0.5.0-r1.apk root@192.168.68.1:/tmp/router-ui.apk
ssh root@192.168.68.1 'apk add --allow-untrusted /tmp/router-ui.apk && /etc/init.d/rpcd restart'
```

安装包不改变设备网络默认值；默认配置变化仍需重新构建固件或通过设置页面修改。

## 目录与验证

`configs/` 保存公共及设备配置和版本锁定；`files/` 保存默认文件；`frontend/` 为页面和 shadcn 组件；`package/router-ui/` 为安装包；`scripts/` 负责配置生成、编译、打包；`tests/` 保存测试和演示接口。

```sh
bun run check
python3 -m unittest discover -s tests/firmware -v
```

首次 CI 完整编译和模拟运行的结果，以 GitHub Actions 记录为准。设备启动、物理网口、WiFi、NSS、实际 DHCP/IPv6 环境和吞吐量仍需实机验收。

上游：[LiBwrt](https://github.com/LiBwrt/LibWrt)、[ImmortalWrt](https://github.com/immortalwrt/immortalwrt)、[ophub](https://github.com/ophub/amlogic-s9xxx-openwrt)、[shadcn/ui](https://ui.shadcn.com/)。本仓库沿用 MIT 许可证，各上游组件分别遵循其许可证，shadcn 组件许可证保存在对应目录。
