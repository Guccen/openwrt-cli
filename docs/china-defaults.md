# 国内默认设置与界面资源

首次启动使用中国标准时间 `Asia/Shanghai`，对应 `CST-8`；启用系统已有的时间同步客户端，默认使用以下公网服务器，不启用对外授时服务：

- `ntp.aliyun.com`
- `ntp1.aliyun.com`
- `ntp2.aliyun.com`

地址来自[阿里云公网时间服务器说明](https://help.aliyun.com/zh/ecs/user-guide/alibaba-cloud-ntp-server)。默认关闭从 DHCP 接收时间源，后续可在“系统维护 → 时间设置”调整。初始化完成后再次运行默认脚本会直接退出，不覆盖用户后来保存的时区和同步源。

软件仓库使用[南京大学 ImmortalWrt 镜像](https://help.mirror.nju.edu.cn/immortalwrt/?mirror=NJU)。仅将已知 ImmortalWrt 源前缀替换为 `https://mirror.nju.edu.cn/immortalwrt/`；保留 `25.12-SNAPSHOT`、设备目标、软件包架构、索引文件路径与签名校验。两个设备当前都使用这一发行版的仓库前缀。官方 OpenWrt 前缀单独映射到[中科大 OpenWrt 镜像](https://mirrors.ustc.edu.cn/help/openwrt.html)，不把不同发行版的包混用；自定义仓库与注释保持原样。

当前 ImmortalWrt 快照目录已核对三个索引均可访问；中科大的 ImmortalWrt 镜像只包含正式发布目录，因此本项目快照源选用南京大学。镜像不会改变内核与软件包兼容性，N1 内核模块仍须与其 ophub 内核配套。

网站图标以 `frontend/public/icon.svg` 为矢量源，同时提供含 16、32、48、64 像素图像的 `favicon.ico` 和 180 像素触屏图标。网站页签、登录页与侧栏使用同一路由器图形，资源随生产构建打包，不依赖外部图片或图标服务。

概览内存使用只在顶部统计卡保留一份；温度名称按已知传感器类型中文化，无法识别用途时显示编号。存储进度条低于 75% 为蓝色，75% 至 89% 为橙色，90% 起为红色，同时保留数值与空间不足提示；深色模式也有对应配色。

2026-10-28 已在 `192.168.68.2` 应用上述时间源、镜像与静态页面，`apk update` 校验索引成功，显示 5670 个可用软件包。设备配置备份为 `/root/router-ui-cn-backup-0.10.2.oMfeNB/`，旧网页入口备份为 `/root/router-ui-web-backup-0.10.2.fbHNgP/entries.tar.gz`。本次没有安装或升级系统软件包，已安装界面包的版本记录保持原值；网络与认证配置摘要、启动标识均未改变。
