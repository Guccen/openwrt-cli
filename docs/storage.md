# 磁盘容量与首次启动初始化

[返回项目首页](../README.md) · [刷机步骤](flashing.md)

## N1 的 USB 启动盘

从 0.10.3 起，新构建的 N1 主路由、旁路由镜像都包含首次启动自动扩容。写入镜像后正常启动，系统自动将第二个 Btrfs 根分区扩大到 U 盘尾部，再在线扩大文件系统。不需要手动分区、格式化或再次重启；不安装到内置 eMMC，不增加常驻服务。镜像中的初始根分区仍为 1 GiB，实际容量在首次启动后变化。

自动处理仅适用于本项目标准双分区 DOS 镜像、512 字节逻辑扇区、单设备 Btrfs、从 USB 启动且根分区为最后一个分区的情况。启动分区起点和大小、根分区起点及内核看到的布局均须匹配。内置 eMMC、GPT、额外数据分区、非标准布局及超过 DOS 支持范围的磁盘会保留现状，并在系统日志记录跳过原因。

修改分区前，在 `/root/router-ui-storage-backup.*` 备份原分区表和前 4 MiB 启动区域并生成 SHA-256。扩容不会移动分区起点或擦除文件系统签名。分区修改后如果内核容量刷新或 Btrfs 扩容失败，初始化入口保留，下次启动重试；已经变大的分区不会自动缩回，避免文件系统已经变大时损坏数据。

先校验镜像 SHA-256，再写入计划用作启动盘的 U 盘。写镜像本身会覆盖目标盘原数据。建议保留旧启动盘作为恢复介质。只安装新的 `router-ui` APK 不会安装此功能，需要使用包含 0.10.3 存储初始化脚本的新完整镜像。此前启动的 0.10.2 镜像构建不包含自动扩容。

刷入后在系统概览查看可写存储和“整盘与分区容量”。例如约 14.4 GiB 的 USB 磁盘，扣除启动分区和布局间隔后根分区约为 14.2 GiB；文件系统实际可用空间还要扣除系统文件与 Btrfs 元数据。可用容量不能等同整盘容量。

若容量未增长，可通过 SSH 只读查看 `logread -e router-ui-storage`、`df -h /` 和 `cat /proc/partitions`。本轮已验证规划器与命令流程的拒绝条件、预检查失败、内核更新失败和文件系统重试；新镜像的首次启动扩容仍需实机验收。

## N1 的内置 eMMC

可按 [N1 写入 eMMC 教程](n1-emmc.md)从已验证的 USB 系统手工迁移。当前上游安装器重建启动、双根分区和共享分区，根分区各为 1280 MiB；不能把 eMMC 整盘容量等同于 `/` 的容量。USB 的首次启动扩容逻辑不会处理这套内置布局。

该操作会删除 eMMC 原分区，且可能改写引导，必须先把本次备份拷到电脑。本项目不会自动执行；目前仅完成安装脚本及型号表核对，尚未完成 eMMC 写入与拔盘启动实机验收。

## 京东云 AX1800（RE-SS-01）

此设备采用 eMMC。固定的 LiBwrt 源码为 RE-SS-01 选择 `EmmcImage`，升级写入 `0:HLOS` 和 `rootfs` 分区；fstools 在固件根分区内识别只读系统结尾，并在剩余区域自动初始化内部可写层。

实机检查发现，`/dev/mmcblk0p18` 的 `rootfs` 分区约 60 MiB，内部 overlay 约 42 MiB；`/dev/mmcblk0p27` 标记为 `storage`，约 56 GiB，读到 ext4 超级块签名，但原镜像没有挂载它。因此 AX1800 新构建加入 `block-mount`，并将 `/dev/mmcblk0p27` 配置为 `/overlay` 的 extroot。启动时由 fstools 在 PREINIT 阶段挂载，根目录可写容量随该分区扩展；不重建分区表、不格式化该分区。若 extroot 不可用，系统保留内部 overlay 回退。

extroot 会使用 `storage` 分区根目录下的 `upper` 和 `work` 作为可写层目录；分区上的其他文件不会被清理。若这两个目录已存在，其内容会被系统当作 overlay 数据使用。原内部 overlay 的配置不会自动复制到新 extroot；刷入新构建前应备份需要保留的设置。当前分区表中其他启动、校准、恢复或厂商分区保持原样，尾部未分配空间也不会并入根目录。

依据为固定源码的 [RE-SS-01 设备定义](https://github.com/LiBwrt/LibWrt/blob/a151272502f075bfc5b708e8e696870aa2c48868/target/linux/qualcommax/image/ipq60xx.mk)、[eMMC 升级分支](https://github.com/LiBwrt/LibWrt/blob/a151272502f075bfc5b708e8e696870aa2c48868/target/linux/qualcommax/ipq60xx/base-files/lib/upgrade/platform.sh)、[fstools 根磁盘初始化](https://github.com/openwrt/fstools/blob/16718b6e3c0fc7db7be6ae5848db0eae88ac8a8b/libfstools/rootdisk.c) 和 [OpenWrt extroot 配置](https://openwrt.org/docs/guide-user/additional-software/extroot_configuration)。

## 性能与资源占用

状态读取使用内核节点，根目录与临时空间合并为一次 `df` 查询。整盘数据是容量统计，不自动挂载或格式化其他设备；临时空间通常来自内存，不能作为持久化磁盘。扩容只解决磁盘容量，不直接提高有线或 WiFi 速率。

N1 实机读取时约使用 162 MiB 内存（按 `MemTotal - MemAvailable` 计算，随业务变化）。预编译内核模块占用磁盘最多，仍保留其依赖，不能为减小镜像盲目删除 USB 网卡和网络所需模块。当前配置已保留 WiFi/NSS 驱动并裁去大型可选服务；吞吐、温度、无线覆盖及长时间负载仍以 AX1800 实测为准。

目前射频页面支持国家、信道和带宽，没有独立“穿墙”开关。发射功率受驱动、硬件及所在地法规限制，名称为“穿墙”的开关不能保证实际覆盖提升。需要覆盖优先时可比较 2.4 GHz 的实际效果；追求近距离高速则通常使用 5 GHz，并结合现场干扰与终端能力选择带宽。相关约束见 [OpenWrt 无线配置](https://openwrt.org/docs/guide-user/network/wifi/basic)。

## 可选的网页远程访问

远程访问路由器、NAS 等网页服务可以按需使用 Cloudflare Tunnel。它通过设备主动建立隧道，不要求在家庭路由器上开放入站端口；建议使用独立域名并为管理页面启用 Cloudflare Access 身份验证。

基础镜像暂不预装、启用 `cloudflared`，避免所有设备承担不需要的磁盘和常驻内存开销。服务部署需要用户的 Cloudflare 账户、域名及隧道配置，实际连通性和速度也受家庭网络到 Cloudflare 的路径影响。隧道不能代替路由器本身的登录密码；启用远程访问前需设置管理密码。后续部署优先使用权限为 `0600` 的令牌文件，避免将令牌直接放入进程参数或日志。详见 [Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/) 和 [运行参数](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/)。
