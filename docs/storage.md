# 磁盘容量与首次启动初始化

[返回项目首页](../README.md) · [刷机步骤](flashing.md)

## N1 的 USB 启动盘

从 0.10.3 起，新构建的 N1 主路由、旁路由镜像都包含首次启动自动扩容。写入镜像后正常启动，系统自动将第二个 Btrfs 根分区扩大到 U 盘尾部，再在线扩大文件系统。不需要手动分区、格式化或再次重启；不安装到内置 eMMC，不增加常驻服务。镜像中的初始根分区仍为 1 GiB，实际容量在首次启动后变化。

自动处理仅适用于本项目标准双分区 DOS 镜像、512 字节逻辑扇区、单设备 Btrfs、从 USB 启动且根分区为最后一个分区的情况。启动分区起点和大小、根分区起点及内核看到的布局均须匹配。内置 eMMC、GPT、额外数据分区、非标准布局及超过 DOS 支持范围的磁盘会保留现状，并在系统日志记录跳过原因。

修改分区前，在 `/root/router-ui-storage-backup.*` 备份原分区表和前 4 MiB 启动区域并生成 SHA-256。扩容不会移动分区起点或擦除文件系统签名。分区修改后如果内核容量刷新或 Btrfs 扩容失败，初始化入口保留，下次启动重试；已经变大的分区不会自动缩回，避免文件系统已经变大时损坏数据。

先校验镜像 SHA-256，再写入计划用作启动盘的 U 盘。写镜像本身会覆盖目标盘原数据。建议保留旧启动盘作为恢复介质。只安装新的 `router-ui` APK 不会安装此功能，需要使用包含 0.10.3 存储初始化脚本的新完整镜像。此前启动的 0.10.2 镜像构建不包含自动扩容。

刷入后在系统概览查看可写存储和“整盘与分区容量”。例如约 14.4 GiB 的 USB 磁盘，扣除启动分区和布局间隔后根分区约为 14.2 GiB；文件系统实际可用空间还要扣除系统文件与 Btrfs 元数据。可用容量不能等同整盘容量。

若容量未增长，可通过 SSH 只读查看 `logread -e router-ui-storage`、`df -h /` 和 `cat /proc/partitions`。本轮已验证规划器与命令流程的拒绝条件、预检查失败、内核更新失败和文件系统重试；新镜像的首次启动扩容仍需实机验收。

## 京东云 AX1800（RE-SS-01）

此设备采用 eMMC。固定的 LiBwrt 源码为 RE-SS-01 选择 `EmmcImage`，升级写入 `0:HLOS` 和 `rootfs` 分区；fstools 在固件根分区内识别只读系统结尾，并在剩余区域自动初始化可写层。正常刷入支持的固件后即可保存配置、安装适用软件，不需要手动创建可写区。

0.10.3 补回此前精简默认包时遗漏的 `e2fsprogs`、`mkf2fs`、ext4 与 F2FS 驱动，并在配置阶段强制检查。这些组件供原生可写层创建和挂载使用，不需要新增重分区脚本。

这不表示 eMMC 的全部容量都属于系统。设备可能保留启动、校准、恢复或厂商数据分区，本项目不会在启动时重建整盘分区表，也不会把未知分区格式化或强行合并。尚未取得用户 AX1800 的真实分区表，不能保证整盘剩余容量均已并入可写层。概览新增整盘及分区容量展示，便于区分文件系统空闲与分区外的尾部空间。

依据为固定源码的 [RE-SS-01 设备定义](https://github.com/LiBwrt/LibWrt/blob/3a3d0b08595530070ad9cd8a20c0ae4ea3e77f70/target/linux/qualcommax/image/ipq60xx.mk)、[eMMC 升级分支](https://github.com/LiBwrt/LibWrt/blob/3a3d0b08595530070ad9cd8a20c0ae4ea3e77f70/target/linux/qualcommax/ipq60xx/base-files/lib/upgrade/platform.sh) 和 [fstools 根磁盘初始化](https://github.com/openwrt/fstools/blob/16718b6e3c0fc7db7be6ae5848db0eae88ac8a8b/libfstools/rootdisk.c)。

## 性能与资源占用

状态读取使用内核节点，根目录与临时空间合并为一次 `df` 查询。整盘数据是容量统计，不自动挂载或格式化其他设备；临时空间通常来自内存，不能作为持久化磁盘。扩容只解决磁盘容量，不直接提高有线或 WiFi 速率。

N1 实机读取时约使用 162 MiB 内存（按 `MemTotal - MemAvailable` 计算，随业务变化）。预编译内核模块占用磁盘最多，仍保留其依赖，不能为减小镜像盲目删除 USB 网卡和网络所需模块。当前配置已保留 WiFi/NSS 驱动并裁去大型可选服务；吞吐、温度、无线覆盖及长时间负载仍以 AX1800 实测为准。

目前射频页面支持国家、信道和带宽，没有独立“穿墙”开关。发射功率受驱动、硬件及所在地法规限制，名称为“穿墙”的开关不能保证实际覆盖提升。需要覆盖优先时可比较 2.4 GHz 的实际效果；追求近距离高速则通常使用 5 GHz，并结合现场干扰与终端能力选择带宽。相关约束见 [OpenWrt 无线配置](https://openwrt.org/docs/guide-user/network/wifi/basic)。

## 可选的网页远程访问

远程访问路由器、NAS 等网页服务可以按需使用 Cloudflare Tunnel。它通过设备主动建立隧道，不要求在家庭路由器上开放入站端口；建议使用独立域名并为管理页面启用 Cloudflare Access 身份验证。

基础镜像暂不预装、启用 `cloudflared`，避免所有设备承担不需要的磁盘和常驻内存开销。服务部署需要用户的 Cloudflare 账户、域名及隧道配置，实际连通性和速度也受家庭网络到 Cloudflare 的路径影响。隧道不能代替路由器本身的登录密码；启用远程访问前需设置管理密码。后续部署优先使用权限为 `0600` 的令牌文件，避免将令牌直接放入进程参数或日志。详见 [Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/) 和 [运行参数](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/)。
