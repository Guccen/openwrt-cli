#!/bin/sh
set -eu

if [ "$(uci -q get router-lite.setup.initialized || true)" = '1' ]; then
    exit 0
fi

uci set system.@system[0].hostname='@HOSTNAME@'
uci set system.@system[0].zonename='Asia/Shanghai'
uci set system.@system[0].timezone='CST-8'
uci set system.ntp='timeserver'
uci set system.ntp.enabled='1'
uci set system.ntp.use_dhcp='0'
uci set system.ntp.enable_server='0'
uci -q delete system.ntp.server || true
for server in ntp.aliyun.com ntp1.aliyun.com ntp2.aliyun.com; do
    uci add_list "system.ntp.server=$server"
done
# 只替换已知发行版的镜像前缀，保留版本、架构、签名与自定义仓库。
for repositories in /etc/apk/repositories.d/distfeeds.list /etc/apk/repositories; do
    [ -f "$repositories" ] || continue
    sed -i \
        -e 's#^https\?://downloads\.immortalwrt\.org/#https://mirror.nju.edu.cn/immortalwrt/#' \
        -e 's#^https\?://mirrors\.vsean\.net/openwrt/#https://mirror.nju.edu.cn/immortalwrt/#' \
        -e 's#^https\?://downloads\.openwrt\.org/#https://mirrors.ustc.edu.cn/openwrt/#' \
        "$repositories"
done
if uci -q get system.@imm_init[0] >/dev/null; then
    uci set system.@imm_init[0].apk_mirror='https://mirror.nju.edu.cn/immortalwrt'
fi
uci set network.lan.ipaddr='@ADDRESS@'
# LAN 地址和掩码使用独立字段，确保与前端配置格式一致。
uci set network.lan.netmask='255.255.255.0'
# 主路由首次启动时生成稳定的本地 IPv6 前缀，保留上游已有值；旁路由不向 LAN 分配该前缀。
if [ '@ROLE@' = 'router' ]; then
    if [ -z "$(uci -q get network.globals.ula_prefix || true)" ]; then
        prefix=$(ucode -e 'import { readfile } from "fs"; let h=hexenc(readfile("/dev/urandom",5)); if(length(h)!=10) exit(1); print(sprintf("fd%s:%s:%s::/48",substr(h,0,2),substr(h,2,4),substr(h,6,4)));')
        uci set network.globals='globals'
        uci set "network.globals.ula_prefix=$prefix"
    fi
    # 清理上游固件可能遗留的空 wan6 dhcp 节，避免中继模式冲突。
    uci -q delete dhcp.wan6 || true
    uci commit dhcp || true
fi
uci commit system
uci commit network

# 无线默认关闭，首次接入通过网线设置设备密码和无线参数。
if [ -x /sbin/wifi ]; then
    /sbin/wifi config
fi
if [ -f /etc/config/wireless ]; then
    (
        # OpenWrt 的配置库允许未定义的可选变量，不兼容 nounset。
        # 只在这个子 shell 关闭 nounset，仍保留命令失败时停止初始化。
        set +u
        . /lib/functions.sh
        disable_radio() {
            uci set "wireless.$1.disabled=1"
        }
        config_load wireless
        config_foreach disable_radio wifi-device
    )
    if [ '@HOSTNAME@' = 'phicomm-n1' ] && [ -z "$(uci -q get wireless.default_radio0.macaddr || true)" ]; then
        # 配套 NVRAM 含固定示例地址；依据本机网口生成稳定且不同的本地无线地址。
        wlan_mac=$(ucode -e 'import { readfile } from "fs"; let m=trim(readfile("/sys/class/net/eth0/address") || ""); if(!match(m,/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i) || (int(substr(m,0,2),16)&1)) exit(1); print(sprintf("%02x%s",((int(substr(m,0,2),16)|2)^4)&254,substr(m,2)));')
        uci set "wireless.default_radio0.macaddr=$wlan_mac"
    fi
    uci commit wireless
fi

uci set router-lite.setup.initialized='1'
uci commit router-lite
exit 0
