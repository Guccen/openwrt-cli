# 斐讯 N1：将 USB 系统写入内置 eMMC

[返回项目首页](../README.md) · [USB 刷机步骤](flashing.md) · [N1 无线与接线](n1-wireless.md) · [存储说明](storage.md)

本教程适用于已经从本项目 U 盘镜像正常启动的 **斐讯 N1（S905D）**，主路由和旁路由操作相同。安装器迁移当前运行的系统、配置与密码，不需要再次上传 `.img.gz`，也不使用 `sysupgrade`。

**执行安装会删除 eMMC 原有分区和系统，标准 N1 安装分支还可能改写引导程序。** 先完成备份并拷到电脑，再执行安装。保留启动 U 盘，同时准备适用于 N1 的恢复手段；引导被改写后，不能保证插回旧 U 盘就一定恢复。

本文依据项目锁定的 ophub 安装脚本与设备表核对，尚未在用户设备上执行 eMMC 写入或拔盘启动验收。本项目仍默认从 U 盘运行，不会自动执行这些操作。原厂安卓解锁、USB 启动激活及线刷救砖不在本教程范围内。

## 1. 从 U 盘启动并确认设备

通过 N1 自带网口连接电脑，以 root 登录。默认主路由地址为 `192.168.69.1`，旁路由地址为 `192.168.68.2`；主路由首次配置时应让电脑位于 `192.168.69.x` 网段。

```sh
ubus call system board
cat /www/device.json
cat /proc/mounts
df -h / /boot
cat /sys/block/mmcblk*/device/type
```

确认型号为 Phicomm N1、项目设备为 `phicomm-n1`，根目录来自外置 USB 的 Btrfs 分区，且 `/boot` 已正常挂载。先验证网口、网页、无线和所需业务能够正常使用，再迁移到内置存储。安装过程中保持有线连接和稳定供电，不切换网络方案、不升级或重启系统。

## 2. 补齐工具并核对安装器

打包器会带入安装脚本，但本项目精简配置**不保证预装全部安装工具**。先检查：

```sh
for tool in bash lsblk fdisk blockdev mkfs.fat mkfs.btrfs btrfs uuidgen hexdump swapoff gzip sha256sum tee; do
    command -v "$tool" >/dev/null 2>&1 || printf '缺少工具：%s\n' "$tool"
done
```

若缺少 Bash、分区查看或 FAT 格式化工具，可以在匹配当前系统的 APK 源可用时补装：

```sh
apk update
apk add bash lsblk fdisk dosfstools uuidgen
```

重新检查，确保 `/bin/bash` 和 `/usr/bin/uuidgen` 可执行。本项目的 `btrfs`、`mkfs.btrfs` 应由完整镜像提供；缺少时先排查镜像，不要混装通用 ARM64 内核模块或强制忽略依赖。这里不需要安装 LuCI、晶晨宝盒网页插件或另一套内核。

检查脚本、型号表和启动文件：

```sh
ls -l /usr/sbin/openwrt-install-amlogic /etc/flippy-openwrt-release
awk -F: '$1 == "101" {print $1, $2, $3, $4, $5, $6, $7}' /etc/model_database.txt
ls -l /boot/dtb/amlogic/meson-gxl-s905d-phicomm-n1.dtb
ls -l /boot/u-boot-n1.bin /lib/u-boot/u-boot-2015-phicomm-n1.bin
lsblk -o NAME,TYPE,SIZE,FSTYPE,MOUNTPOINT
```

本教程对应的型号是 **`101` / `Phicomm-N1` / `s905d`**，设备树是 `meson-gxl-s905d-phicomm-n1.dtb`。编号是型号编号，不是磁盘编号；不要套用网上旧教程的 `11`、其他盒子编号或自定义 `99`。若文件缺失、识别到多块 eMMC，或当前 `/` 已在 eMMC 上，停止操作。

当前锁定安装脚本的 SHA-256 如下；不匹配时先核对构建来源，不能继续照搬本文参数：

```sh
printf '%s  %s\n' \
    7a4e71d3f6a82f2905d6ad7a274e670c44a88b8c0b1fda2b725af0a9b98ad632 \
    /usr/sbin/openwrt-install-amlogic | sha256sum -c -
```

## 3. 备份 eMMC，并把备份拷到电脑

根据 `lsblk` 和 `/sys/block/mmcblk*/device/type` 确认内置存储。设备编号可能是 `mmcblk0`、`mmcblk1` 或其他值，**不要根据示例猜盘号**。下面的 `mmcblkX` 必须替换为实机确认的编号；脚本会拒绝无效设备、已挂载的 eMMC 和非 USB 根目录。

备份默认保存在启动 U 盘的 `/mnt/n1-emmc-backup`。先确保 U 盘剩余空间大于 eMMC 主用户区容量并留有余量；压缩不保证显著缩小。容量不足时，另准备足够大的外置存储并调整备份目录。不要把大体积备份放在 `/root`、`/usr` 或 `/opt`，这些目录稍后会复制进容量有限的 eMMC 根分区。

```sh
/bin/bash <<'BASH'
set -euo pipefail
umask 077

# 必须替换为上一步核对的 eMMC，不能填启动 U 盘。
emmc=/dev/mmcblkX
backup=/mnt/n1-emmc-backup
name=${emmc##*/}
[ -b "$emmc" ] || { echo '设备不存在，请先核对盘号'; exit 1; }
[ "$(cat "/sys/block/$name/device/type")" = MMC ] || { echo '目标不是已确认的 eMMC'; exit 1; }
root=$(awk '$2 == "/" {print $1}' /proc/mounts)
case "$root" in /dev/sd*) ;; *) echo '必须先从 USB 启动'; exit 1 ;; esac
mounts=$(lsblk -n -r -o MOUNTPOINT "$emmc")
if printf '%s\n' "$mounts" | grep -q '[^[:space:]]'; then
    echo 'eMMC 仍有挂载点或交换区，请先处理后再备份'
    exit 1
fi
mkdir -p "$backup"
[ ! -e "$backup/emmc-user.img.gz" ] || { echo '已有备份，请另存后再操作'; exit 1; }
available=$(df -kP "$backup" | awk 'NR == 2 {print $4}')
required=$(( $(blockdev --getsize64 "$emmc") / 1024 + 262144 ))
[ "$available" -ge "$required" ] || { echo '备份位置空间不足'; exit 1; }

# 备份主用户区、盘首引导数据和可读取的硬件启动分区，不向 eMMC 写入。
dd if="$emmc" bs=4M | gzip -1 > "$backup/emmc-user.img.gz.partial"
gzip -t "$backup/emmc-user.img.gz.partial"
mv "$backup/emmc-user.img.gz.partial" "$backup/emmc-user.img.gz"
dd if="$emmc" of="$backup/first-4MiB.bin" bs=1M count=4
fdisk -l "$emmc" > "$backup/partition-table.txt"
for part in boot0 boot1; do
    [ ! -b "$emmc$part" ] || dd if="$emmc$part" of="$backup/$part.bin" bs=1M
done
(cd "$backup" && sha256sum *.gz *.bin partition-table.txt > sha256sums)
sync
echo '备份完成，请先拷到电脑并核对摘要'
BASH
```

`emmc-user.img.gz` 是 eMMC 主用户区的全盘镜像，覆盖安装器会改写的盘首与原分区，不是厂商线刷包。中途失败留下的 `.partial` 文件不算完成的备份。

在电脑上拷回整个备份目录，将地址替换成当前 N1 地址：

```sh
scp -O -r root@192.168.69.1:/mnt/n1-emmc-backup ./
```

Linux / WSL 可在电脑的备份目录执行 `sha256sum -c sha256sums`；Windows 可用 `Get-FileHash -Algorithm SHA256` 对照摘要。不要在 Windows PowerShell 中使用 `ssh ... dd ... > 镜像文件` 这样的二进制管道代替 SCP。

安装器会另外保存 `/root/BackupOldBootloader.img`，但它只有盘首 4 MiB，不能替代本次全盘备份；若已有这个文件，安装器会跳过重新备份，应先把旧文件另存到备份目录。

还需检查待迁移目录的大小：

```sh
du -sk /root /etc /bin /sbin /lib /opt /usr /www
```

当前安装器的单个根分区固定为 **1280 MiB**。这些目录需要留有足够空间才能复制完成；若已有大量软件或数据，应先整理，不要直接把整个 U 盘的可用空间当作目标根分区容量。

## 4. 执行安装

**以下命令会立即开始安装，没有最后一次交互确认。** 仅在设备、工具、启动文件、空闲容量以及电脑上的备份均已核对后执行：

```sh
/bin/bash -o pipefail -c \
  '/usr/sbin/openwrt-install-amlogic no 101 auto btrfs 2>&1 | tee /tmp/n1-emmc-install.log'
```

参数含义：

| 参数    | 含义                                                       |
| ------- | ---------------------------------------------------------- |
| `no`    | 不选择主线 U-Boot 写入；**不代表完全不改引导**             |
| `101`   | 使用当前设备表的标准 Phicomm N1 条目                       |
| `auto`  | 此位置只有自定义 `99` 分支才解析；本教程由型号表决定设备树 |
| `btrfs` | 将共享分区也格式化为 Btrfs，复用本项目已有工具与驱动       |

标准 N1 条目的主线 U-Boot 字段为空，但 Android U-Boot 字段为 `/lib/u-boot/u-boot-2015-phicomm-n1.bin`。当前脚本在该文件存在时仍会写入它，并更新启动分区中的引导文件。因此不能把这条命令理解为“保留所有原始引导数据”。

安装器会重建四个分区：512 MiB 启动分区、两个各 1280 MiB 的 Btrfs 根分区，以及使用余下可用空间的共享分区，并保留脚本定义的布局间隔。第二个根分区不表示本项目提供自动 A/B 回滚；共享分区也不会自动并入 `/`。本项目首次启动自动扩容仅针对标准 USB 布局，不会继续扩大这套 eMMC 根分区。

保留并检查完整输出。如果出现命令缺失、格式化失败、挂载失败或空间不足，停止后续重启步骤，保存 `/tmp/n1-emmc-install.log`。上游脚本并非每一步都严格检查失败，最后的成功提示或退出码不能代替下一步的实际启动验证。不要在安装未结束时断电或拔 U 盘。

## 5. 关机、拔 U 盘并验证内置启动

确认安装过程结束且没有关键错误后，先将日志拷回电脑，再在 N1 上执行：

```sh
sync
poweroff
```

关机后断电，拔下启动 U 盘，再重新上电。首次检查使用自带有线 LAN，管理地址、密码和网络模式以迁移前的当前配置为准；未自行改址时，主路由仍为 `192.168.69.1`，旁路由仍为 `192.168.68.2`。

登录后检查：

```sh
df -h / /boot
lsblk -o NAME,TYPE,SIZE,FSTYPE,MOUNTPOINT
cat /proc/cmdline
ubus call system board
```

在**没有启动 U 盘**的情况下，确认根目录位于 `mmcblkNp2` 一类的内置 MMC 分区，并验证网页、网口、无线、上网和配置保存。仅能打开管理地址不代表已经从 eMMC 启动。

## 6. 失败时如何恢复

- 内置启动失败时，先断电，插回已验证的启动 U 盘再上电。能进入 USB 系统后，保留安装日志、`lsblk`、`df` 与引导信息，重新核对问题，不要反复执行安装器。
- 主用户区的全盘恢复会再次覆盖 eMMC。只有先从 USB 启动、重新核对目标编号、确认 eMMC 未挂载并验证备份完整性后，才能将 `emmc-user.img.gz` 解压写回同一块 eMMC；不要向启动 U 盘或 `boot0` / `boot1` 误写主用户区镜像。
- USB 也不能启动时，可能需要 N1 对应的线刷恢复与原厂镜像。普通写 U 盘不能替代恢复引导；使用匹配型号的恢复流程，并保留本次备份。上游提供的恢复说明见下方来源。

## 核对来源

- [项目版本锁定](../configs/sources.json)：N1 打包器 `52ad5239`，安装脚本依赖 `869a7ae5`。
- [固定版本安装脚本](https://github.com/ophub/luci-app-amlogic/blob/869a7ae501d54d9b94742a1165df374b2a4d0e69/luci-app-amlogic/root/usr/sbin/openwrt-install-amlogic)：参数、引导写入分支、分区布局及复制范围。
- [固定版本设备表](https://github.com/ophub/amlogic-s9xxx-openwrt/blob/52ad5239e6720f5b56c9afafcd7080cbe3cf2881/make-openwrt/openwrt-files/common-files/etc/model_database.conf)：标准 N1 的 `101` 条目与配套设备树、U-Boot。
- [上游安装与备份恢复说明](https://github.com/ophub/amlogic-s9xxx-openwrt/blob/52ad5239e6720f5b56c9afafcd7080cbe3cf2881/README.cn.md)：eMMC 安装、备份恢复及安卓恢复镜像入口。
