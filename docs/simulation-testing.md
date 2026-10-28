# 本地模拟安装与功能测试

[返回项目首页](../README.md) · [固件构建](firmware-build.md) · [前端开发](frontend-development.md) · [验收记录](development-status.md)

## 运行范围

模拟机 Actions 工作流已移除，完整固件构建直接编译、打包并按选择发布，不再以模拟测试作为前置或后置步骤。以下脚本保留供 Linux 本地按需排查；它通过官方 SDK 构建真正的 `router-ui.apk`，使用校验 SHA-256 的 OpenWrt 25.12.6 ImageBuilder 生成 ARM64 测试系统，在 QEMU 中启动。接口来自运行中的 `procd`、`netifd`、`rpcd` 和 `uhttpd`，不是本地演示接口。

主路由还会通过 SDK 编译带有[断链恢复补丁](ipv6-link-recovery.md)的 `odhcpd-ipv6only.apk`，安装后再重启测试机。`simulate.sh` 的第四个参数可指定该包，默认读取 `build/simulation-package/odhcpd-ipv6only.apk`；缺失时拒绝运行主路由验证。编译后仿真使用本次运行前置阶段生成的通用架构服务包，其源码、修订号与补丁和设备固件一致，报告记录安装包摘要、架构及版本；AX1800 的设备架构包不能直接混装到通用测试系统。N1 旁路由不安装此服务。

普通 push / pull request 只自动执行快速代码检查，同分支新提交会取消尚未结束的旧检查。固件配置和完整构建仍可在 Actions 中独立手动触发，本地模拟结果不影响镜像发布。

不使用浏览器时，命令行设置 `SIM_BROWSER_TESTS=0` 后调用 `simulate.sh`。该模式保留真实安装、重启、权限、配置回滚、网络与维护验证，跳过浏览器安装和页面回归；报告通过 `browser_tests_enabled` 明确标记范围。无需启动开发模式。

## QEMU 启动检查

`simulate.sh` 在下载 ImageBuilder、生成镜像前执行 [qemu_host.py](../scripts/qemu_host.py)，用空 ROM 搜索目录检查 ARM64 TCG、VirtIO 磁盘、双网卡和随机数设备能否创建。测试直接通过 `-kernel` 启动，两张网卡都显式设置 `romfile=` 关闭 PXE ROM，避免精简安装依赖时因缺少 `efi-virtio.rom` 而退出。正式启动使用相同网卡参数；提前退出时会把 QEMU 错误直接写入任务日志。

正式联调额外加入第三网口 `eth2` 作为独立 IPv6 上游，主路由仿真从开机起将 `wan6` 固定到该口，IPv4 WAN 保持 `eth1`。这样 DHCPv6 中继用例不混入运行中搬迁物理网口的行为；真实设备默认仍使用 `@wan`，没有修改硬件配置。odhcpd 对已有逻辑接口保留 ifindex 的实现见[固定上游源码](https://github.com/openwrt/odhcpd/blob/5d7be43f8b9dec0eb47e245cfab81108bb131273/src/config.c)。中继用例仍需完成真实 Relay-Forward/Reply 租约交换，并命中 WAN UDP 547 规则；失败时额外保留设备状态和桥组播表。

## 覆盖范围

本地脚本可分别测试 AX1800 主路由、N1 旁路由、N1 主路由三种配置：

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
- 验证系统归档导出、gzip 格式和 SHA-256；暂存及待确认配置期间，另一个登录会话同样不能导出或重启。验证真实上传令牌、顺序、摘要、归档路径检查、取消清理，以及 generic/ext4 设备拒绝升级与恢复出厂。通过维护接口真实重启，再修改主机名、恢复刚导出的归档并再次重启，核对 boot ID、原配置及旧会话失效。
- 浏览器在受控 RPC 响应下检查归档取消、输入确认文字、维护期间配置互斥、固件摘要和兼容性失败、无能力设备隐藏操作；这些页面测试不执行真实固件刷写。
- 验证未登录、当前密码错误、两次输入不一致和暂存配置期间不能修改密码；在模拟机真实修改 root 密码，确认旧密码拒绝、新密码可登录、所有原 root 网页会话失效，随后还原测试密码。报告仅记录结果，不保存密码或 shadow 内容；密码页面测试关闭 trace。

## 报告与产物

本地输出位于 `build/simulation-report/`：包含安装记录、启动日志、DHCP、网络、`configuration.json` 配置事务、`maintenance.json` 维护结果、`schedule.json` 定时任务权限与 cron 安装结果，以及 `routing.json` 上网及地址池结果。启用浏览器回归时另有 HTML/JUnit 报告、截图及失败 trace。定时任务检查不触发计划重启。系统导出测试关闭 trace，归档仅在内存或浏览器临时目录校验后删除；不要上传归档或其中的测试密钥。浏览器依赖不进入固件；测试密码和 SSH 密钥每次临时生成，模拟磁盘及私钥只留在本地临时目录。

正式构建的 Artifact 和 Release 不包含本地模拟报告，发布说明明确记录本次没有执行模拟机安装测试。

## 模拟边界

模拟运行的是通用 ARM64 OpenWrt，AX1800 使用虚拟 WAN/LAN 替代物理交换机。官方测试系统通过 `openssl-util` 生成证书，设备构建使用对应 fork 的 `px5g-openssl`。它可以提前验证前端安装、系统服务和配置策略，但不能证明 LiBwrt/ImmortalWrt 的完整设备镜像能够启动，也不能验证 WiFi、NSS、N1 引导/eMMC、USB 网卡驱动或真实吞吐量。涉及这些能力的首次验证及相关变更仍需实机。

## Linux 本地运行

Linux 本地需要编译工具、QEMU 与网络测试工具。脚本会创建临时网桥和网络命名空间，需要可用的 `sudo`，不要并发运行多份：

```sh
sudo apt-get install build-essential clang flex bison gawk gettext git \
  libncurses-dev libssl-dev python3 python3-setuptools rsync swig unzip \
  zlib1g-dev file wget curl zstd xsltproc uuid-runtime qemu-system-arm \
  iproute2 iptables busybox-static openssh-client openssl
bun install --frozen-lockfile
bun run build
bash scripts/build-simulation-package.sh
SIM_BROWSER_TESTS=0 bash scripts/simulate.sh phicomm-n1 bypass build/simulation-package/router-ui.apk
```

如需页面回归，先运行 `bunx playwright install --with-deps --only-shell chromium`，再移除 `SIM_BROWSER_TESTS=0`。

再次运行使用新的干净 checkout，或移走本次 `build/simulation-tools/` 和 `build/simulation-report/`。临时密钥与磁盘位于 `build/simulation-private/`，测试结束自动清理。手动强制终止时，可检查并清理同名 QEMU 进程、`br-router-ci` / `tap-router-ci` 网桥网口及 `router-ci-client` 网络命名空间。

参考：[OpenWrt QEMU 文档](https://openwrt.org/docs/guide-user/virtualization/qemu)、[OpenWrt 25.12.2 ARM64 下载与校验](https://downloads.openwrt.org/releases/25.12.2/targets/armsr/armv8/)、[Playwright CI 文档](https://playwright.dev/docs/ci)。
