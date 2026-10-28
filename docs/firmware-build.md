# 固件构建

[返回项目首页](../README.md) · [设备接线与初始化](getting-started.md) · [模拟测试](simulation-testing.md)

源码、feeds 和 N1 内核版本固定在 [sources.json](../configs/sources.json)。最近一次上游核对及兼容分支选择见[上游版本记录](upstream-versions.md)。已生成的镜像与待验收事项见[开发进度](development-status.md)。

## 构建约束

- 不包含 LuCI、主题、网页终端、跑分、Docker、文件共享和代理插件。
- 只安装必要 feeds。源码、feeds、Actions 和 N1 打包依赖固定提交；N1 内核固定版本和 SHA-256。
- N1 保留配套内核模块依赖、BCM43455 固件及地区数据库，移除其他设备的无线固件和多平台模块自动加载。0.10.5 加入 WiFi 5 用户空间配置栈，继续使用 ophub 配套无线内核模块，禁止混入通用 ARM64 内核模块。预编译内核尚未按 N1 单独裁剪，镜像体积以 CI 产物为准。
- N1 包含首次 USB 启动自动扩容及所需一次性工具。Btrfs 工具使用配套 ophub 内核，构建时仅移除通用 ARM64 内核模块依赖；补丁和工具元数据随 Artifact 保留。支持范围见[存储说明](storage.md)。

## GitHub Actions 构建

在 GitHub Actions 手动运行“Build lightweight firmware”。`device` 选择 `both` 或单台设备，`n1_role` 选择 `both`、`bypass` 或 `router`，`n1_wan` 默认 `eth1`，不可与 LAN 的 `eth0` 相同。默认同时构建 AX1800 主路由、N1 旁路由和 N1 主路由；两种 N1 模式在独立任务中编译，产物与失败恢复文件按模式区分。

工作流直接执行前端构建、固件编译、N1 镜像打包和校验值生成，不再调用模拟机测试，也不等待代码检查工作流。`publish` 默认开启，成功的设备任务会发布包含镜像、安装包、SHA-256 与构建记录的独立 Release；关闭该选项则只保留 Artifact。版本标签包含设备、模式、运行编号与重跑次数，并固定到本次构建提交。构建成功表示产物生成成功，功能仍需实机验收。N1 请把 `.img.gz` 写到新 U 盘，保留旧启动盘；镜像不会自动安装到内置存储。

两台设备使用独立 Ubuntu 24.04 任务。始终保留 Artifact，不依赖 Release 发布成功。产物包含固件、独立前端包、最终配置、版本锁定、源码补丁、体积报告和 SHA-256。N1 明确选择 generic 设备的根文件系统并核对归档内标识；目标目录清单保存在 `target-files.json`。构建失败时额外保留已有根文件系统和 APK，避免因产物收集错误丢失编译结果。

### 构建缓存与耗时

每次构建仍重新检出锁定源码并生成新镜像，缓存分为两层：

- 下载文件保存在 `build/downloads`，缓存键包含设备、源码锁与输入配置，并能回退复用旧下载缓存。N1 内核压缩包也保存在这里，每次复用前核对 SHA-256；缓存损坏时重新下载并校验，通过后才替换。
- 编译结果保存在 `build/ccache`，按运行系统、设备、模式和源码锁隔离。每次运行保存一个新缓存键，下次恢复最近结果；单份容量上限为 1 GiB，编译器按文件内容校验，避免仅因时间戳变化全部失效。失败任务也会尝试保存已经完成的编译缓存。

缓存不包含 `build_dir`、`staging_dir`、旧软件包或旧镜像，不跨设备复用工具链。完整编译通过 `make` 参数启用 `CONFIG_CCACHE`，不打开隐藏选项所在的开发模式；配置阶段的 `.config` 不代表这些命令行覆盖值。编译结束或失败时输出 `ccache-stats.txt`，随 Artifact 保留，用于确认命中次数及缓存容量。

2026-10-28 的上一轮成功构建中，下载缓存已存在，但尚无编译缓存；N1 编译阶段约 62–67 分钟，AX1800 约 42 分钟。首次启用 ccache 仍需建立缓存，后续收益以实际命中统计和任务耗时为准。下载默认并行 8 路，编译默认使用 runner 的处理器数量，仍保留失败后单线程详细重试；可通过 `DOWNLOAD_JOBS`、`BUILD_JOBS` 覆盖。

普通 push / pull request 仍自动执行快速代码检查；`Verify firmware configurations` 可单独手动运行。模拟机 Actions 工作流已移除，本地模拟脚本保留，按需另行运行，不参与发布。

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
