# 固件构建

[返回项目首页](../README.md) · [设备接线与初始化](getting-started.md) · [模拟测试](simulation-testing.md)

源码、feeds 和 N1 内核版本固定在 [sources.json](../configs/sources.json)。最近一次上游核对及兼容分支选择见[上游版本记录](upstream-versions.md)。已生成的镜像与待验收事项见[开发进度](development-status.md)。

## 构建约束

- 不包含 LuCI、主题、网页终端、跑分、Docker、文件共享和代理插件。
- 只安装必要 feeds。源码、feeds、Actions 和 N1 打包依赖固定提交；N1 内核固定版本和 SHA-256。
- N1 首版保留配套内核模块依赖，移除不用的无线固件及多平台模块自动加载。预编译内核尚未按 N1 单独裁剪，镜像体积以 CI 产物为准。

## GitHub Actions 构建

在 GitHub Actions 手动运行“Build lightweight firmware”。`device` 选择 `both` 或单台设备，`n1_role` 选择 `bypass` 或 `router`，`n1_wan` 默认 `eth1`，不可与 LAN 的 `eth0` 相同。`publish` 默认关闭，启用后创建包含设备、模式、运行编号的独立 Release。

两台设备使用独立 Ubuntu 24.04 任务，先做检查再编译。始终保留 Artifact，不依赖 Release 发布成功。只缓存下载文件，不混用工具链。产物包含固件、独立前端包、最终配置、版本锁定、源码补丁、体积报告和 SHA-256。N1 明确选择 generic 设备的根文件系统并核对归档内标识；目标目录清单保存在 `target-files.json`。构建失败时额外保留已有根文件系统和 APK，避免因产物收集错误丢失编译结果。

`Verify firmware configurations` 手动检查 AX1800、N1 主路由和 N1 旁路由：下载固定源码和 feeds，核对实际 Git 提交，执行 `make defconfig`，验证目标单选、必要包和轻量限制。无需等待 QEMU 或完整固件编译。`configuration-设备-模式` Artifact 保留解析配置、实际提交和日志。完整编译复用同一配置脚本。

N1 启动镜像是 `phicomm-n1-模式-k版本.img.gz`。通用 `rootfs.tar.gz` 仅用于再次打包，不能直接刷入 N1。

## Linux 本地构建

Linux 构建与 CI 使用相同脚本，依赖列表见 [build.yml](../.github/workflows/build.yml)。各设备和模式使用独立的干净 checkout：

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
