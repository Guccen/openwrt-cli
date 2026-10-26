# 模拟安装与功能测试

[返回项目首页](../README.md) · [固件构建](firmware-build.md) · [前端开发](frontend-development.md) · [验收记录](development-status.md)

## GitHub Actions 运行方式

`Simulate OpenWrt installation` 在 Actions 中手动运行，完整固件构建也会调用它作为前置检查。它通过官方 SDK 构建真正的 `router-ui.apk`，使用校验 SHA-256 的 OpenWrt 25.12.2 ImageBuilder 生成 ARM64 测试系统，在 QEMU 中启动。接口来自运行中的 `procd`、`netifd`、`rpcd` 和 `uhttpd`，不是本地演示接口。

普通 push / pull request 只自动执行快速代码检查，同分支新提交会取消尚未结束的旧检查。先在本地验证并集中推送，按需要手动运行固件配置、QEMU 模拟或完整固件构建；不再每次提交重复运行耗时任务。

## QEMU 启动检查

`simulate.sh` 在下载 ImageBuilder、生成镜像前执行 [qemu_host.py](../scripts/qemu_host.py)，用空 ROM 搜索目录检查 ARM64 TCG、VirtIO 磁盘、双网卡和随机数设备能否创建。测试直接通过 `-kernel` 启动，两张网卡都显式设置 `romfile=` 关闭 PXE ROM，避免精简安装依赖时因缺少 `efi-virtio.rom` 而退出。正式启动使用相同网卡参数；提前退出时会把 QEMU 错误直接写入任务日志。

## 覆盖范围

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

## 报告与产物

打开运行记录，在 Artifacts 下载 `simulation-设备-模式`：包含 HTML/JUnit 报告、页面截图、安装记录、启动日志、DHCP、网络、`configuration.json` 配置事务、`maintenance.json` 维护结果和 `routing.json` 上网及地址池结果。失败时通常保留 Playwright trace；系统导出测试关闭 trace，归档仅在内存或浏览器临时目录校验后删除，不上传归档或其中的测试密钥。浏览器依赖仅用于开发和 CI，不进入固件；测试密码和 SSH 密钥每次临时生成，模拟磁盘及私钥不上传。

`Build lightweight firmware` 会先等待三种模拟配置通过，再编译设备固件。编译完成后，还会安装并测试本次真实编译生成的前端 APK，失败会阻止后续打包和 Release。正式构建的模拟报告放在设备构建 Artifact 中。

## 模拟边界

模拟运行的是通用 ARM64 OpenWrt，AX1800 使用虚拟 WAN/LAN 替代物理交换机。官方测试系统通过 `openssl-util` 生成证书，设备构建使用对应 fork 的 `px5g-openssl`。它可以提前验证前端安装、系统服务和配置策略，但不能证明 LiBwrt/ImmortalWrt 的完整设备镜像能够启动，也不能验证 WiFi、NSS、N1 引导/eMMC、USB 网卡驱动或真实吞吐量。涉及这些能力的首次验证及相关变更仍需实机；日常前端和状态接口开发可优先依靠 CI。

## Linux 本地运行

Linux 本地也可使用同一流程，所需依赖见 [simulate.yml](../.github/workflows/simulate.yml)。脚本会创建临时网桥和网络命名空间，需要可用的 `sudo`，不要并发运行多份：

```sh
bun install --frozen-lockfile
bun run build
bash scripts/build-simulation-package.sh
bunx playwright install --with-deps --only-shell chromium
bash scripts/simulate.sh phicomm-n1 bypass build/simulation-package/router-ui.apk
```

再次运行使用新的干净 checkout，或移走本次 `build/simulation-tools/` 和 `build/simulation-report/`。临时密钥与磁盘位于 `build/simulation-private/`，测试结束自动清理。手动强制终止时，可检查并清理同名 QEMU 进程、`br-router-ci` / `tap-router-ci` 网桥网口及 `router-ci-client` 网络命名空间。

参考：[OpenWrt QEMU 文档](https://openwrt.org/docs/guide-user/virtualization/qemu)、[OpenWrt 25.12.2 ARM64 下载与校验](https://downloads.openwrt.org/releases/25.12.2/targets/armsr/armv8/)、[Playwright CI 文档](https://playwright.dev/docs/ci)。
