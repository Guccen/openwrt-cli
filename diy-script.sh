#!/bin/bash

# 定义IP地址
IP_ADDRESS="192.168.68.1"
# 定义WIFI名称
WIFI_NAME="PDCN"
# 定义WIFI密码
WIFI_PASSWORD="ZHYA.1906"
# 定义IP设置路径
IP_PATH="package/base-files/files/bin/config_generate"
# 定义WIFI设置路径
WIFI_PATH="target/linux/qualcommax/base-files/etc/uci-defaults/990_set-wireless.sh"

# 修改默认IP
sed -i 's/192.168.1.1/'$IP_ADDRESS'/g' $IP_PATH

# 修改 WiFi 默认设置
sed -i "s/BASE_SSID='LiBwrt'/BASE_SSID='$WIFI_NAME'/g" $WIFI_PATH
sed -i "s/BASE_WORD='12345678'/BASE_WORD='$WIFI_PASSWORD'/g" $WIFI_PATH

# 修改 5G SSID 命名规则，将短横线"-"替换为下划线"_"
sed -i 's/${BASE_SSID}-5G_1/${BASE_SSID}_5G_1/g' $WIFI_PATH
sed -i 's/${BASE_SSID}-5G/${BASE_SSID}_5G/g' $WIFI_PATH
sed -i 's/${BASE_SSID}-5G_2/${BASE_SSID}_5G_2/g' $WIFI_PATH
