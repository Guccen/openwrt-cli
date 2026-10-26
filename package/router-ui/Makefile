include $(TOPDIR)/rules.mk

PKG_NAME:=router-ui
PKG_VERSION:=0.3.0
PKG_RELEASE:=1
PKG_LICENSE:=MIT

include $(INCLUDE_DIR)/package.mk

define Package/router-ui
  PKGARCH:=all
  SECTION:=admin
  CATEGORY:=Administration
  TITLE:=轻量设备管理页面
  DEPENDS:=+uhttpd +uhttpd-mod-ubus +rpcd
endef

define Package/router-ui/description
  提供独立页面路由、设备状态、网络设置及本地备份恢复，使用受限接口并支持应用确认及超时回滚。
endef

define Build/Compile
endef

define Package/router-ui/install
	$(INSTALL_DIR) $(1)/www $(1)/usr/share/rpcd/acl.d $(1)/usr/share/licenses/router-ui
	$(CP) ./htdocs/. $(1)/www/
	$(INSTALL_DATA) ./files/router-ui.json $(1)/usr/share/rpcd/acl.d/router-ui.json
	$(INSTALL_DATA) ./files/shadcn-ui.LICENSE $(1)/usr/share/licenses/router-ui/shadcn-ui.LICENSE
endef

$(eval $(call BuildPackage,router-ui))
