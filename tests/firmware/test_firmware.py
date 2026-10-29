import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import firmware
import n1_packer


class FirmwareTests(unittest.TestCase):
    def test_build_time_records_current_build_for_every_image(self):
        for device, role in [("jdcloud-ax1800", "router"), ("phicomm-n1", "router"), ("phicomm-n1", "bypass")]:
            with self.subTest(device=device, role=role), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                with patch.dict(os.environ, {"SOURCE_DATE_EPOCH": "1"}), patch("firmware.time.time", return_value=1793187238.75):
                    metadata = firmware.overlay(root, device, role)
                self.assertEqual(metadata["builtAt"], 1793187238)
                self.assertEqual(json.loads((root / "www/device.json").read_text(encoding="utf-8")), metadata)

    def test_first_boot_is_idempotent_and_stops_on_failure(self):
        bash = shutil.which("bash")
        if not bash and Path("C:/Program Files/Git/bin/bash.exe").is_file():
            bash = "C:/Program Files/Git/bin/bash.exe"
        if not bash:
            self.skipTest("需要 Bash 执行首次启动脚本测试")
        for fail in ("", "network", "wireless"):
            with self.subTest(fail=fail), tempfile.TemporaryDirectory() as temp:
                root = Path(temp).resolve()
                firmware.overlay(root / "overlay", "jdcloud-ax1800", "router")
                script = root / "first-boot.sh"
                text = (root / "overlay/etc/uci-defaults/zz-router-lite").read_text(encoding="utf-8")
                text = text.replace("/sbin/wifi", (root / "no-wifi").as_posix())
                wireless = root / "wireless"
                wireless.write_text("config wifi-device 'radio0'\nconfig wifi-device 'radio1'\n")
                repositories = root / "distfeeds.list"
                repositories.write_text("\n".join([
                    "https://downloads.immortalwrt.org/releases/25.12-SNAPSHOT/targets/armsr/armv8/packages/packages.adb",
                    "http://downloads.openwrt.org/releases/25.12.6/packages/aarch64_generic/base/packages.adb",
                    "https://mirrors.vsean.net/openwrt/releases/25.12-SNAPSHOT/packages/aarch64_generic/packages/packages.adb",
                    "https://downloads.immortalwrt.org.example.invalid/custom/packages.adb",
                    "https://custom.example.invalid/feed/packages.adb",
                    "# https://downloads.openwrt.org/custom/packages.adb",
                ]) + "\n", encoding="utf-8", newline="\n")
                text = text.replace("/etc/apk/repositories.d/distfeeds.list", repositories.as_posix())
                text = text.replace("/etc/apk/repositories;", (root / "no-repositories").as_posix() + ";")
                functions = root / "functions.sh"
                # OpenWrt 库使用未定义的可选环境变量；初始化须兼容这种调用。
                functions.write_text('config_load() { [ -n "$IPKG_INSTROOT" ] && return 0; return 0; }\nconfig_foreach() { "$1" radio0; "$1" radio1; }\n', encoding="utf-8", newline="\n")
                text = text.replace("/etc/config/wireless", wireless.as_posix()).replace("/lib/functions.sh", functions.as_posix())
                script.write_text(text, encoding="utf-8", newline="\n")
                binaries = root / "bin"
                binaries.mkdir()
                (binaries / "ucode").write_text("#!/bin/sh\nprintf 'fd12:3456:789a::/48'\n", encoding="utf-8", newline="\n")
                (binaries / "ucode").chmod(0o755)
                mock = binaries / "uci"
                mock.write_text("""#!/bin/sh
printf '%s\\n' "$*" >> "$UCI_LOG"
if [ "$1" = '-q' ]; then
    [ -f "$UCI_STATE" ] || exit 1
    printf '1\\n'
    exit 0
fi
if [ "$*" = "commit $UCI_FAIL" ]; then exit 1; fi
if [ "$*" = 'set router-lite.setup.initialized=1' ]; then : > "$UCI_STATE"; fi
exit 0
""", encoding="utf-8", newline="\n")
                mock.chmod(0o755)
                log = root / "uci.log"
                state = root / "initialized"
                env = dict(os.environ, UCI_LOG=log.as_posix(), UCI_STATE=state.as_posix(), UCI_FAIL=fail)
                env.pop("IPKG_INSTROOT", None)
                env["PATH"] = str(binaries) + os.pathsep + env["PATH"]
                result = subprocess.run([bash, script.as_posix()], env=env, capture_output=True, text=True)
                if fail:
                    self.assertNotEqual(result.returncode, 0)
                    self.assertFalse(state.exists())
                else:
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertTrue(state.exists())
                    self.assertIn("set network.lan.ipaddr=192.168.68.1", log.read_text())
                    self.assertIn("set wireless.radio0.disabled=1", log.read_text())
                    self.assertIn("set wireless.radio1.disabled=1", log.read_text())
                    self.assertIn("commit wireless", log.read_text())
                    self.assertIn("set system.@system[0].zonename=Asia/Shanghai", log.read_text())
                    self.assertIn("set system.@system[0].timezone=CST-8", log.read_text())
                    self.assertIn("set system.ntp.use_dhcp=0", log.read_text())
                    for server in ("ntp.aliyun.com", "ntp1.aliyun.com", "ntp2.aliyun.com"):
                        self.assertIn(f"add_list system.ntp.server={server}", log.read_text())
                    feeds = repositories.read_text()
                    self.assertIn("https://mirror.nju.edu.cn/immortalwrt/releases/25.12-SNAPSHOT/targets/armsr/armv8/packages/packages.adb", feeds)
                    self.assertIn("https://mirrors.ustc.edu.cn/openwrt/releases/25.12.6/packages/aarch64_generic/base/packages.adb", feeds)
                    self.assertIn("https://mirror.nju.edu.cn/immortalwrt/releases/25.12-SNAPSHOT/packages/aarch64_generic/packages/packages.adb", feeds)
                    self.assertIn("https://downloads.immortalwrt.org.example.invalid/custom/packages.adb", feeds)
                    self.assertIn("https://custom.example.invalid/feed/packages.adb", feeds)
                    self.assertIn("# https://downloads.openwrt.org/custom/packages.adb", feeds)
                    log.write_text("")
                    subprocess.run([bash, script.as_posix()], env=env, check=True)
                    self.assertNotIn("set network", log.read_text())
                    self.assertNotIn("set wireless", log.read_text())
                    self.assertNotIn("set system", log.read_text())
                    self.assertEqual(repositories.read_text(), feeds)

    def test_role_configuration(self):
        bypass = firmware.merge_config("phicomm-n1", "bypass")
        router = firmware.merge_config("phicomm-n1", "router")
        self.assertIn("# CONFIG_PACKAGE_ppp is not set", bypass)
        self.assertIn("CONFIG_PACKAGE_ppp=y", router)
        self.assertNotIn("# CONFIG_PACKAGE_ppp is not set", router)
        self.assertEqual(len(re.findall(r"^CONFIG_PACKAGE_ppp=", router, re.M)), 1)

    def test_network_modes_are_isolated(self):
        for role, address, ignore, ipv6 in [("bypass", "192.168.68.2", "1", "disabled"), ("router", "192.168.69.1", "0", "server")]:
            with self.subTest(role=role), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                data = firmware.overlay(root, "phicomm-n1", role, "eth1")
                self.assertEqual(data["address"], address)
                network = (root / "etc/config/network").read_text()
                dhcp = (root / "etc/config/dhcp").read_text()
                self.assertIn(address, network)
                lan = dhcp.split("config dhcp 'lan'")[1].split("config dhcp 'wan'")[0]
                self.assertIn(f"option ignore '{ignore}'", lan)
                self.assertIn(f"option ra '{ipv6}'", lan)
                self.assertEqual("config interface 'wan'" in network, role == "router")
                self.assertEqual("option device 'eth1'" in network, role == "router")
                self.assertNotRegex((root / "etc/uci-defaults/zz-router-lite").read_text(encoding="utf-8"), r"@[A-Z][A-Z_]*@")

    def test_reject_invalid_wan(self):
        for wan in ("", "eth0", "lo", "br-lan", "eth1'; reboot", "eth1\n"):
            with self.subTest(wan=wan), self.assertRaises(ValueError):
                firmware.validate_role("phicomm-n1", "router", wan)

    def test_makefile_assignment_handles_continuation(self):
        source = "before\nDEFAULT_PACKAGES += first \\\n\tsecond \\\n\tthird\nafter\n"
        self.assertEqual(firmware.assignment(source, "DEFAULT_PACKAGES", ["minimal"]), "before\nDEFAULT_PACKAGES += minimal\nafter\n")
        with self.assertRaises(ValueError):
            firmware.assignment("other := value\n", "DEFAULT_PACKAGES", [])

    def test_missing_or_forbidden_packages_fail_validation(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp)
            # 此处只验证解析结果；隐藏能力须由 Kconfig 的条件依赖选中。
            config = firmware.merge_config("phicomm-n1", "bypass") + "CONFIG_DRIVER_11AC_SUPPORT=y\n"
            (source / ".config").write_text(config)
            firmware.verify(source, "phicomm-n1", "bypass")
            with (source / ".config").open("a") as output:
                output.write("CONFIG_PACKAGE_luci-base=y\n")
            with self.assertRaises(ValueError):
                firmware.verify(source, "phicomm-n1", "bypass")
            (source / ".config").write_text(config + "CONFIG_PACKAGE_kmod-fs-btrfs=y\n")
            with self.assertRaises(ValueError):
                firmware.verify(source, "phicomm-n1", "bypass")
            (source / ".config").write_text(config + "CONFIG_TARGET_armsr_armv8_DEVICE_other=y\n")
            with self.assertRaises(ValueError):
                firmware.verify(source, "phicomm-n1", "bypass")
            (source / ".config").write_text("CONFIG_TARGET_armsr=y\n")
            with self.assertRaises(ValueError):
                firmware.verify(source, "phicomm-n1", "bypass")

    def test_web_configuration_permissions_are_bounded(self):
        acl = json.loads((ROOT / "package/router-ui/files/router-ui.json").read_text(encoding="utf-8"))["router-ui"]
        self.assertEqual(set(acl["write"]["ubus"]), {"session", "uci", "router.maintenance"})
        self.assertEqual(set(acl["write"]["ubus"]["router.maintenance"]), {"reboot", "upload_start", "upload_chunk", "upload_cancel", "inspect", "restore", "upgrade", "reset", "password", "led_save", "led_repair", "time_save", "schedule_save"})
        self.assertEqual(acl["read"]["ubus"]["iwinfo"], ["info", "assoclist", "phyname", "freqlist", "countrylist", "txpowerlist"])
        self.assertEqual(acl["read"]["ubus"]["router.status"], ["summary", "clients", "wireless"])
        self.assertNotIn("network.wireless", acl["read"]["ubus"])
        self.assertNotIn("router.status", acl["write"]["ubus"])
        self.assertEqual(set(acl["write"]["uci"]), {"network", "dhcp", "wireless", "firewall"})
        self.assertNotIn("commit", acl["write"]["ubus"]["uci"])
        self.assertIn("add", acl["write"]["ubus"]["uci"])
        self.assertNotIn("*", acl["write"]["uci"])
        self.assertNotIn("file", acl["read"]["ubus"])
        self.assertNotIn("system", acl["write"]["uci"])
        rpcd = (ROOT / "files/common/etc/config/rpcd").read_text(encoding="utf-8")
        self.assertNotIn("'*'", rpcd)

    def test_ax_emmc_overlay_cannot_drop_its_initialization_tools_or_drivers(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp)
            config = firmware.merge_config("jdcloud-ax1800", "router")
            (source / ".config").write_text(config)
            firmware.verify(source, "jdcloud-ax1800", "router")
            for package in firmware.AX_STORAGE:
                with self.subTest(package=package):
                    (source / ".config").write_text(config.replace(f"CONFIG_PACKAGE_{package}=y", f"# CONFIG_PACKAGE_{package} is not set"))
                    with self.assertRaises(ValueError): firmware.verify(source, "jdcloud-ax1800", "router")

    def test_sources_and_feeds_use_fixed_revisions(self):
        for device in firmware.DEVICES:
            source = firmware.SOURCES[device]
            self.assertRegex(source["revision"], r"^[a-f0-9]{40}$")
            for feed in source["feeds"].values():
                self.assertRegex(feed["revision"], r"^[a-f0-9]{40}$")
        self.assertRegex(firmware.SOURCES["n1_packager"]["kernel_sha256"], r"^[a-f0-9]{64}$")

    def test_resolved_revisions_reject_feed_drift(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp)
            feed = source / "feeds/packages"
            feed.mkdir(parents=True)
            revisions = []
            for repository in (source, feed):
                subprocess.run(["git", "init", "-q", str(repository)], check=True, capture_output=True)
                subprocess.run(["git", "-C", str(repository), "-c", "user.name=Firmware Test", "-c", "user.email=firmware-test@example.invalid", "commit", "-q", "--allow-empty", "-m", "Pinned input"], check=True, capture_output=True)
                revisions.append(subprocess.check_output(["git", "-C", str(repository), "rev-parse", "HEAD"], text=True).strip())
            sources = {"phicomm-n1": {"revision": revisions[0], "feeds": {"packages": {"revision": revisions[1]}}}}
            with patch.object(firmware, "SOURCES", sources):
                firmware.verify_revisions(source, "phicomm-n1")
                self.assertEqual(json.loads((source / "resolved-sources.json").read_text()), {"source": revisions[0], "packages": revisions[1]})
                subprocess.run(["git", "-C", str(feed), "-c", "user.name=Firmware Test", "-c", "user.email=firmware-test@example.invalid", "commit", "-q", "--allow-empty", "-m", "Unexpected feed update"], check=True, capture_output=True)
                with self.assertRaisesRegex(ValueError, "packages"):
                    firmware.verify_revisions(source, "phicomm-n1")

    def test_packer_refuses_paths_outside_image(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with self.assertRaises(ValueError):
                n1_packer.finalize(root / "packer", root / "overlay", root)
            with self.assertRaises(ValueError):
                n1_packer.bounded_remove(root / "image", root / "outside")

    def test_n1_finalize_reapplies_overlay(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp) / "packer"
            overlay = Path(temp) / "overlay"
            rootfs = directory / "openwrt/tmp/6.12/s905d/rootfs"
            rootfs.mkdir(parents=True)
            firmware.overlay(overlay, "phicomm-n1", "bypass")
            (rootfs / "lib/firmware/brcm").mkdir(parents=True)
            (rootfs / "lib/firmware/rtl_nic").mkdir()
            (rootfs / "lib/firmware/brcm/unused.bin").write_text("test")
            for name in ("brcmfmac43455-sdio.bin", "brcmfmac43455-sdio.clm_blob", "brcmfmac43455-sdio.phicomm,n1.bin", "brcmfmac43455-sdio.phicomm,n1.txt"):
                (rootfs / "lib/firmware/brcm" / name).write_text("test")
            for module in ("cfg80211", "brcmutil", "brcmfmac", "brcmfmac-wcc"):
                target = rootfs / "lib/modules/6.18.58" / f"{module}.ko"
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("test")
            for path in ("sbin/wifi", "lib/wifi/mac80211.uc", "lib/netifd/wireless/mac80211.sh", "usr/share/ucode/wifi/hostapd.uc", "usr/sbin/hostapd", "usr/sbin/wpa_supplicant", "usr/sbin/iw", "usr/bin/iwinfo", "usr/lib/rpcd/iwinfo.so", "lib/firmware/regulatory.db"):
                target = rootfs / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("test")
            (rootfs / "usr/bin").mkdir(parents=True, exist_ok=True)
            for name in ("btrfs", "sfdisk", "partx", "blockdev"):
                (rootfs / "usr/bin" / name).write_text("test")
            (rootfs / "root").mkdir()
            (rootfs / "root/.todo_rootfs_resize").write_text("yes")
            n1_packer.finalize(directory, overlay, rootfs)
            self.assertFalse((rootfs / "root/.todo_rootfs_resize").exists())
            self.assertFalse((rootfs / "lib/firmware/brcm/unused.bin").exists())
            self.assertTrue((rootfs / "lib/firmware/brcm/brcmfmac43455-sdio.phicomm,n1.txt").is_file())
            self.assertTrue((rootfs / "lib/firmware/regulatory.db").is_file())
            self.assertEqual((rootfs / "etc/modules.d/brcmfmac").read_text(), "cfg80211\nbrcmutil\nbrcmfmac\n")
            self.assertTrue((rootfs / "lib/firmware/rtl_nic").is_dir())
            self.assertEqual((rootfs / "etc/config/network").read_bytes(), (overlay / "etc/config/network").read_bytes())
            self.assertEqual((rootfs / "www/device.json").read_bytes(), (overlay / "www/device.json").read_bytes())
            required = rootfs / "lib/firmware/brcm/brcmfmac43455-sdio.phicomm,n1.bin"
            required.unlink()
            with self.assertRaisesRegex(ValueError, "BCM43455"):
                n1_packer.finalize(directory, overlay, rootfs)
            required.write_text("test")
            (rootfs / "usr/sbin/iw").unlink()
            with self.assertRaisesRegex(ValueError, "usr/sbin/iw"):
                n1_packer.finalize(directory, overlay, rootfs)
            (rootfs / "usr/sbin/iw").write_text("test")
            (rootfs / "usr/bin/btrfs").unlink()
            with self.assertRaisesRegex(ValueError, "btrfs"):
                n1_packer.finalize(directory, overlay, rootfs)

    def test_n1_wireless_requires_userspace_and_matching_kernel(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp)
            config = firmware.merge_config("phicomm-n1", "router") + "CONFIG_DRIVER_11AC_SUPPORT=y\n"
            (source / ".config").write_text(config)
            firmware.verify(source, "phicomm-n1", "router")
            for package in ("wpad-basic-openssl", "wifi-scripts", "iw", "rpcd-mod-iwinfo", "wireless-regdb"):
                with self.subTest(package=package):
                    (source / ".config").write_text(config.replace(f"CONFIG_PACKAGE_{package}=y", f"# CONFIG_PACKAGE_{package} is not set"))
                    with self.assertRaises(ValueError): firmware.verify(source, "phicomm-n1", "router")
            for package in ("kmod-brcmfmac", "kmod-cfg80211", "kmod-mac80211"):
                with self.subTest(package=package):
                    (source / ".config").write_text(config + f"CONFIG_PACKAGE_{package}=y\n")
                    with self.assertRaises(ValueError): firmware.verify(source, "phicomm-n1", "router")
            for option in ("CONFIG_WIFI_SCRIPTS_UCODE", "CONFIG_DRIVER_11AC_SUPPORT"):
                with self.subTest(option=option):
                    (source / ".config").write_text(config.replace(f"{option}=y", f"# {option} is not set"))
                    with self.assertRaisesRegex(ValueError, option): firmware.verify(source, "phicomm-n1", "router")
            metadata = firmware.overlay(source / "overlay", "phicomm-n1", "router", "eth2")
            self.assertEqual(metadata["wan"], "eth2")
            wireless = (source / "overlay/etc/config/wireless").read_text()
            self.assertIn("option disabled '1'", wireless)
            self.assertIn("option country 'CN'", wireless)
            self.assertIn("option ifname 'wlan0'", wireless)
            self.assertNotIn("option key", wireless)

    def test_prepare_config_writes_merged_configuration(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp)
            firmware.prepare_config(source, "phicomm-n1", "router")
            config = (source / ".config").read_text(encoding="utf-8")
            self.assertIn("CONFIG_PACKAGE_btrfs-progs=y\n", config)
            self.assertIn("CONFIG_PACKAGE_sfdisk=y\n", config)
            self.assertIn("CONFIG_TARGET_armsr_armv8_DEVICE_generic=y\n", config)
            self.assertIn("CONFIG_PACKAGE_ppp=y\n", config)


if __name__ == "__main__":
    unittest.main()
