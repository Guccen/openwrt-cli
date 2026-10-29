# 上游版本同步记录

核对时间：2026-10-29（Asia/Shanghai）。以下“最新”指该时刻对应设备兼容分支或 stable 发布渠道的最新版本；后续构建继续锁定完整提交和 SHA-256，不动态跟随分支。

| 组件                            | 本次结果                                                                             | 锁定版本                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| AX1800 LiBwrt                   | 更新到 `25.12-nss` 最新提交，较原锁定版本前进 102 个提交                             | `a151272502f075bfc5b708e8e696870aa2c48868`                                 |
| AX1800 packages                 | `openwrt-25.12` 已是最新，保留                                                       | `6f8f6461e8a6a0bbc134592d12353700fe698506`                                 |
| NSS packages                    | 切换到 LiBwrt 当前指定的 `NSS-LibWrt` 配套分支                                       | `c425674d8feab34a3dc8045f9f4f4890d8fb6ca9`                                 |
| N1 ImmortalWrt                  | 从 `v25.12.2` 更新到 `openwrt-25.12` 维护分支最新提交，包含发布标签之后的 127 个提交 | `84b665b5de552e297d0f7d755b88a46fc0cfeb13`                                 |
| N1 packages                     | 从发布标签的旧快照更新到 `openwrt-25.12` 最新提交                                    | `6f8f6461e8a6a0bbc134592d12353700fe698506`                                 |
| N1 ophub 打包器                 | `main` 已是最新，保留                                                                | `52ad5239e6720f5b56c9afafcd7080cbe3cf2881`                                 |
| N1 内核包                       | `kernel_stable` 最新版本，6.12.114 → 6.18.58                                         | SHA-256 `a73f560d56fb2a179e35e308b51e4a1c6b14a114585cebe7e0ad4294dbc44ce0` |
| OpenWrt 测试 SDK / ImageBuilder | 25.12.2 → 25.12.6                                                                    | 文件名与官方 SHA-256 见 `configs/simulation.json`                          |

ophub 打包器的四个依赖也已核对，当前锁定值均等于其默认分支最新提交：

| 依赖                          | 提交                                       |
| ----------------------------- | ------------------------------------------ |
| `ophub/u-boot`                | `e06036570fc7a3ff810d7d5e8b4cb32f3a925f31` |
| `ophub/firmware`              | `a9d0e8337cc8aa2ca4b482acd7b19c74ce05860f` |
| `ophub/amlogic-s9xxx-armbian` | `72621c6f32942e40757deb1a5de63dca575c7658` |
| `ophub/luci-app-amlogic`      | `16df300f86e5b4e48e955cd66f337c5872d27d3c` |

## 兼容范围与检查

N1 采用 25.12 维护分支的固定快照，并非新建一个名为 `25.12.6` 的 ImmortalWrt 正式发布。AX1800 保留 LiBwrt 配套的 ath11k、无线固件、NSS 驱动及内核补丁；没有用主线 ath11k 或另一个内核版本单独替换其中组件。软件包源沿用维护分支，不切到开发中的 master。

2026-10-29 将 AX1800 源码更新到 LiBwrt `25.12-nss` 分支头。该版本把 mac80211 从 6.18.39 更新至 6.18.55，并维护 ath11k NSS 补丁；上游 `feeds.conf.default` 指定 NSS 软件源为 `laipeng668/nss-packages` 的 `NSS-LibWrt` 分支。项目继续只固定构建所需的软件源，AX1800 packages 提交未变化。本次同步仅更新版本锁和记录，尚未针对新提交运行配置检查或完整编译；先前已取消的构建不会自动重启。

ophub 的 N1 板型条目为 `s905d`、`stable/all`，明确包含 6.18 系列。本地已下载完整的 6.18.58 内核包，复核 123,598,556 字节文件的 SHA-256，并检查嵌套归档中存在 `meson-gxl-s905d-phicomm-n1.dtb` 和 `r8152.ko`。这只能证明必要文件存在，实际 USB 启动、网卡、温度与吞吐仍需要实机验收。

最新 N1 源码的 `include/target.mk`、armsr 目标及 generic 镜像定义已通过本项目精简补丁检查。本地 54 项前端测试、45 项固件/脚本测试、TypeScript、格式、构建及资源预算检查通过。`router-ui` 更新为 `0.8.0-r2`，包含概览双列卡片等高修正。新的源码配置、25.12.6 模拟安装和完整固件编译结果见[开发进度](development-status.md)。

## 核对来源

- [LiBwrt 25.12-nss](https://github.com/LiBwrt/LibWrt/tree/25.12-nss)、[固定源码的 feeds 配置](https://github.com/LiBwrt/LibWrt/blob/a151272502f075bfc5b708e8e696870aa2c48868/feeds.conf.default)
- [ImmortalWrt 25.12 维护分支](https://github.com/immortalwrt/immortalwrt/tree/openwrt-25.12)、[软件包维护分支](https://github.com/immortalwrt/packages/tree/openwrt-25.12)
- [NSS packages](https://github.com/laipeng668/nss-packages/tree/NSS-LibWrt)
- [ophub N1 支持表](https://github.com/ophub/amlogic-s9xxx-openwrt/blob/52ad5239e6720f5b56c9afafcd7080cbe3cf2881/make-openwrt/openwrt-files/common-files/etc/model_database.conf)、[stable 内核发布](https://github.com/ophub/kernel/releases/tag/kernel_stable)
- [OpenWrt 25.12.6 发布](https://github.com/openwrt/openwrt/releases/tag/v25.12.6)、[官方文件校验和](https://downloads.openwrt.org/releases/25.12.6/targets/armsr/armv8/sha256sums)
