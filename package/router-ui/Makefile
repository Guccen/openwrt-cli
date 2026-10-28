include $(TOPDIR)/rules.mk

PKG_NAME:=router-ui
PKG_VERSION:=0.10.3
PKG_RELEASE:=1
PKG_LICENSE:=MIT

include $(INCLUDE_DIR)/package.mk

define Package/router-ui
  PKGARCH:=all
  SECTION:=admin
  CATEGORY:=Administration
  TITLE:=轻量设备管理页面
  DEPENDS:=+uhttpd +uhttpd-mod-ubus +rpcd +jsonfilter +ucode +ucode-mod-fs +ucode-mod-ubus +ucode-mod-uci +coreutils-timeout
endef

define Package/router-ui/description
  提供独立页面路由、设备状态、网络设置及本地备份恢复，使用受限接口并支持应用确认及超时回滚。
endef

define Build/Compile
endef

define Package/router-ui/conffiles
/etc/router-ui-led.json
/etc/router-ui-schedule.json
endef

define Package/router-ui/postinst
#!/bin/sh
if [ -z "$${IPKG_INSTROOT}" ] && [ -f /etc/uci-defaults/91-router-ui-led ]; then
    sh /etc/uci-defaults/91-router-ui-led && rm -f /etc/uci-defaults/91-router-ui-led
fi
if [ -z "$${IPKG_INSTROOT}" ] && [ -f /etc/uci-defaults/92-router-ui-schedule ]; then
    sh /etc/uci-defaults/92-router-ui-schedule && rm -f /etc/uci-defaults/92-router-ui-schedule
fi
exit 0
endef

define Package/router-ui/prerm
#!/bin/sh
if [ -z "$${IPKG_INSTROOT}" ]; then
    /usr/libexec/router-ui/led-state uninstall >/dev/null 2>&1 || true
    /usr/libexec/router-ui/scheduled-reboot uninstall >/dev/null 2>&1 || true
    /etc/init.d/router-ui-led-boot disable
    /etc/init.d/router-ui-led disable
fi
exit 0
endef

define Package/router-ui/install
	$(INSTALL_DIR) $(1)/www $(1)/usr/share/rpcd/acl.d $(1)/usr/share/licenses/router-ui $(1)/usr/libexec/rpcd $(1)/usr/libexec/router-ui $(1)/etc/init.d $(1)/etc/hotplug.d/iface $(1)/etc/uci-defaults $(1)/lib/upgrade/keep.d
	$(CP) ./htdocs/. $(1)/www/
	$(INSTALL_DATA) ./files/router-ui.json $(1)/usr/share/rpcd/acl.d/router-ui.json
	$(INSTALL_DATA) ./files/shadcn-ui.LICENSE $(1)/usr/share/licenses/router-ui/shadcn-ui.LICENSE
	$(INSTALL_BIN) ./files/router.maintenance $(1)/usr/libexec/rpcd/router.maintenance
	$(INSTALL_BIN) ./files/router.status $(1)/usr/libexec/rpcd/router.status
	$(INSTALL_BIN) ./files/router.diagnostics $(1)/usr/libexec/rpcd/router.diagnostics
	$(INSTALL_DATA) ./files/diagnostics.uc $(1)/usr/libexec/router-ui/diagnostics.uc
	$(INSTALL_DATA) ./files/time-settings.uc $(1)/usr/libexec/router-ui/time-settings.uc
	$(INSTALL_DATA) ./files/status.uc $(1)/usr/libexec/router-ui/status.uc
	$(INSTALL_DATA) ./files/maintenance-data.uc $(1)/usr/libexec/router-ui/maintenance-data.uc
	$(INSTALL_DATA) ./files/password.uc $(1)/usr/libexec/router-ui/password.uc
	$(INSTALL_DATA) ./files/led-policy.uc $(1)/usr/libexec/router-ui/led-policy.uc
	$(INSTALL_DATA) ./files/router-ui-led.json $(1)/etc/router-ui-led.json
	$(INSTALL_BIN) ./files/led-state $(1)/usr/libexec/router-ui/led-state
	$(INSTALL_BIN) ./files/router-ui-led $(1)/etc/init.d/router-ui-led
	$(INSTALL_BIN) ./files/router-ui-led-boot $(1)/etc/init.d/router-ui-led-boot
	$(INSTALL_BIN) ./files/led-hotplug $(1)/etc/hotplug.d/iface/95-router-ui-led
	$(INSTALL_BIN) ./files/led-defaults $(1)/etc/uci-defaults/91-router-ui-led
	$(INSTALL_DATA) ./files/schedule.uc $(1)/usr/libexec/router-ui/schedule.uc
	$(INSTALL_DATA) ./files/router-ui-schedule.json $(1)/etc/router-ui-schedule.json
	$(INSTALL_BIN) ./files/scheduled-reboot $(1)/usr/libexec/router-ui/scheduled-reboot
	$(INSTALL_BIN) ./files/schedule-defaults $(1)/etc/uci-defaults/92-router-ui-schedule
	echo /etc/router-ui-led.json > $(1)/lib/upgrade/keep.d/router-ui-led
	printf '/etc/router-ui-schedule.json\n/etc/router-ui-schedule.last\n' > $(1)/lib/upgrade/keep.d/router-ui-schedule
endef

$(eval $(call BuildPackage,router-ui))
