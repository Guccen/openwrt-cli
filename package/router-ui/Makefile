include $(TOPDIR)/rules.mk

PKG_NAME:=router-ui
PKG_VERSION:=0.1.0
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
  提供登录、系统概览和网络状态，仅使用静态资源和受限的状态接口。
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
