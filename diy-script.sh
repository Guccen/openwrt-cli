#!/bin/bash

# 定义IP地址
IP_ADDRESS="192.168.68.1"
# 定义WIFI名称
WIFI_NAME="PDCN"
# 定义WIFI密码
WIFI_PASSWORD="ZHYA.1906"
# 定义IP设置路径
IP_PATH="package/base-files/files/bin/config_generate"

# 动态查找WIFI配置文件路径
WIFI_SH=$(find target/linux/{mediatek/filogic,qualcommax}/base-files/etc/uci-defaults/ -type f -name "*set-wireless.sh" 2>/dev/null)
WIFI_UC="package/network/config/wifi-scripts/files/lib/wifi/mac80211.uc"

# 修改默认IP
sed -i 's/192.168.1.1/'$IP_ADDRESS'/g' $IP_PATH

# 修改 WiFi 默认设置
if [ -f "$WIFI_SH" ]; then
	# 修改WIFI名称
	sed -i "s/BASE_SSID='.*'/BASE_SSID='$WIFI_NAME'/g" $WIFI_SH
	# 修改WIFI密码
	sed -i "s/BASE_WORD='.*'/BASE_WORD='$WIFI_PASSWORD'/g" $WIFI_SH
	# 修改 5G SSID 命名规则，将短横线"-"替换为下划线"_"
	sed -i 's/${BASE_SSID}-5G_1/${BASE_SSID}_5G_1/g' $WIFI_SH
	sed -i 's/${BASE_SSID}-5G/${BASE_SSID}_5G/g' $WIFI_SH
	sed -i 's/${BASE_SSID}-5G_2/${BASE_SSID}_5G_2/g' $WIFI_SH
elif [ -f "$WIFI_UC" ]; then
	# 修改WIFI名称
	sed -i "s/ssid='.*'/ssid='$WIFI_NAME'/g" $WIFI_UC
	# 修改WIFI密码
	sed -i "s/key='.*'/key='$WIFI_PASSWORD'/g" $WIFI_UC
	# 修改WIFI地区
	sed -i "s/country='.*'/country='CN'/g" $WIFI_UC
	# 修改WIFI加密
	sed -i "s/encryption='.*'/encryption='psk2+ccmp'/g" $WIFI_UC
fi
