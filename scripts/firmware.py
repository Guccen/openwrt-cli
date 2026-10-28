"""固定构建输入、生成精简配置和设备默认文件。"""

import argparse
import json
import re
import shutil
import subprocess
from pathlib import Path

from odhcpd_patch import prepare as patch_odhcpd
from n1_storage import prepare as prepare_n1_storage

ROOT = Path(__file__).resolve().parent.parent
SOURCES = json.loads((ROOT / "configs/sources.json").read_text(encoding="utf-8"))
DEVICES = ("jdcloud-ax1800", "phicomm-n1")
CORE = ["dnsmasq", "firewall4"]
ROUTING = ["odhcp6c", "odhcpd-ipv6only", "ppp", "ppp-mod-pppoe"]
AX_STORAGE = ["e2fsprogs", "mkf2fs", "kmod-fs-ext4", "kmod-fs-f2fs"]
AX_HARDWARE = [
    "uboot-envtools", "wpad-openssl", "kmod-ath11k", "kmod-ath11k-ahb",
    "kmod-dsa", "kmod-dsa-qca8k", "kmod-phy-qca83xx",
    "kmod-gpio-button-hotplug", "kmod-leds-gpio", "kmod-leds-pwm",
    "kmod-qca-nss-dp", "kmod-qca-nss-drv", "kmod-qca-nss-ecm",
    "kmod-qca-nss-drv-bridge-mgr", "kmod-qca-nss-drv-pppoe", "kmod-qca-nss-drv-vlan-mgr",
]
FORBIDDEN = ("luci", "docker", "containerd", "runc", "samba", "ttyd", "coremark", "iperf")


def git(*args, cwd=None):
    subprocess.run(["git", *args], cwd=cwd, check=True)


def checkout(url, revision, destination):
    destination = Path(destination).resolve()
    if destination.exists() and any(destination.iterdir()):
        raise ValueError(f"源码目录必须为空：{destination}")
    destination.mkdir(parents=True, exist_ok=True)
    git("init", str(destination))
    git("remote", "add", "origin", url, cwd=destination)
    git("fetch", "--depth=1", "origin", revision, cwd=destination)
    git("checkout", "--detach", "FETCH_HEAD", cwd=destination)


def assignment(text, name, values, required=True, multiple=False):
    """替换一个完整的 Makefile 变量赋值，兼容多行续行。"""
    lines = text.splitlines(keepends=True)
    output = []
    count = 0
    index = 0
    while index < len(lines):
        match = re.match(rf"^\s*{re.escape(name)}\s*([:+?]?=)", lines[index])
        if match:
            count += 1
            while lines[index].rstrip().endswith("\\"):
                index += 1
            output.append(f"{name} {match[1]} {' '.join(values)}\n")
        else:
            output.append(lines[index])
        index += 1
    if (count > 1 and not multiple) or (required and count == 0):
        raise ValueError(f"上游变量结构发生变化：{name}（匹配 {count} 处）")
    return "".join(output)


def patch_defaults(source, device, role):
    target = source / "include/target.mk"
    text = target.read_text(encoding="utf-8")
    text = assignment(text, "DEFAULT_PACKAGES.tweak", [])
    text = assignment(text, "DEFAULT_PACKAGES.router", CORE + (ROUTING if role == "router" else []))
    target.write_text(text, encoding="utf-8", newline="\n")
    if device == "jdcloud-ax1800":
        target = source / "target/linux/qualcommax/Makefile"
        target.write_text(assignment(target.read_text(encoding="utf-8"), "DEFAULT_PACKAGES", AX_HARDWARE + AX_STORAGE), encoding="utf-8", newline="\n")
        target = source / "target/linux/qualcommax/ipq60xx/target.mk"
        target.write_text(assignment(target.read_text(encoding="utf-8"), "DEFAULT_PACKAGES", ["ath11k-firmware-ipq6018", "nss-firmware-ipq60xx"]), encoding="utf-8", newline="\n")
    else:
        target = source / "target/linux/armsr/Makefile"
        target.write_text(assignment(target.read_text(encoding="utf-8"), "DEFAULT_PACKAGES", ["blkid"], multiple=True), encoding="utf-8", newline="\n")
        target = source / "target/linux/armsr/image/Makefile"
        text = target.read_text(encoding="utf-8")
        pattern = r"(?ms)^define Device/generic\n.*?^endef"
        matches = list(re.finditer(pattern, text))
        if len(matches) != 1:
            raise ValueError("无法定位通用 ARM64 设备定义")
        text = re.sub(pattern, lambda match: assignment(match.group(), "DEVICE_PACKAGES", []), text)
        target.write_text(text, encoding="utf-8", newline="\n")


def merge_config(device, role):
    paths = [ROOT / "configs/common.config", ROOT / f"configs/{device}.config"]
    if device == "phicomm-n1" and role == "router":
        paths.append(ROOT / "configs/n1-router.config")
    values = {}
    for path in paths:
        for line in path.read_text(encoding="utf-8").splitlines():
            active = re.fullmatch(r"(CONFIG_[^=\s]+)=(.+)", line)
            inactive = re.fullmatch(r"# (CONFIG_\S+) is not set", line)
            if active:
                values[active[1]] = active[2]
            elif inactive:
                values[inactive[1]] = "n"
    return "".join(f"# {name} is not set\n" if value == "n" else f"{name}={value}\n" for name, value in values.items())


def validate_role(device, role, wan):
    if device not in DEVICES or role not in ("router", "bypass"):
        raise ValueError("设备或运行模式无效")
    if device == "jdcloud-ax1800" and role != "router":
        raise ValueError("AX1800 当前仅提供主路由配置")
    if device == "phicomm-n1" and role == "router":
        if not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_.-]{0,14}", wan) or wan in ("eth0", "lo", "br-lan"):
            raise ValueError("N1 主路由必须指定独立的 WAN 网口，例如 USB 网卡 eth1")


def n1_network(role, wan):
    router = role == "router"
    address = "192.168.69.1" if router else "192.168.68.2"
    text = f"""config interface 'loopback'
    option device 'lo'
    option proto 'static'
    option ipaddr '127.0.0.1'
    option netmask '255.0.0.0'

config device
    option name 'br-lan'
    option type 'bridge'
    option bridge_empty '1'
    list ports 'eth0'

config interface 'lan'
    option device 'br-lan'
    option proto 'static'
    option ipaddr '{address}'
    option netmask '255.255.255.0'
"""
    if router:
        text += f"""    option ip6assign '60'

config interface 'wan'
    option device '{wan}'
    option proto 'dhcp'

config interface 'wan6'
    option device '@wan'
    option proto 'dhcpv6'
"""
    else:
        text += "    option gateway '192.168.68.1'\n    list dns '192.168.68.1'\n    option delegate '0'\n"
    return text


def overlay(destination, device, role, wan="eth1"):
    validate_role(device, role, wan)
    destination.mkdir(parents=True, exist_ok=True)
    shutil.copytree(ROOT / "files/common", destination, dirs_exist_ok=True)
    address = "192.168.68.1" if device == "jdcloud-ax1800" else ("192.168.69.1" if role == "router" else "192.168.68.2")
    metadata = {"device": device, "model": "京东云 AX1800" if device == "jdcloud-ax1800" else "斐讯 N1", "role": role, "address": address, "source": SOURCES[device]["version"], "revision": SOURCES[device]["revision"]}
    if device == "phicomm-n1" and role == "router":
        metadata["wan"] = wan
    (destination / "www").mkdir(exist_ok=True)
    (destination / "www/device.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    config = destination / "etc/config"
    if device == "phicomm-n1":
        shutil.copytree(ROOT / "files/n1", destination, dirs_exist_ok=True)
        for name in ("etc/uci-defaults/00-router-ui-storage", "usr/libexec/router-ui/expand-rootfs"):
            (destination / name).chmod(0o755)
        (config / "network").write_text(n1_network(role, wan), encoding="utf-8", newline="\n")
        dhcp = (ROOT / "files/n1-dhcp.template").read_text(encoding="utf-8")
        dhcp = dhcp.replace("@IGNORE@", "0" if role == "router" else "1")
        dhcp = dhcp.replace("@IPV6@", "server" if role == "router" else "disabled")
        (config / "dhcp").write_text(dhcp, encoding="utf-8", newline="\n")
    defaults = destination / "etc/uci-defaults/zz-router-lite"
    defaults.parent.mkdir(exist_ok=True)
    text = (ROOT / "files/router-defaults.sh").read_text(encoding="utf-8")
    text = text.replace("@HOSTNAME@", device).replace("@ADDRESS@", address)
    defaults.write_text(text, encoding="utf-8", newline="\n")
    defaults.chmod(0o755)
    return metadata


def prepare(source, device, role, wan):
    validate_role(device, role, wan)
    bundle = ROOT / "build/router-ui"
    if not (bundle / "htdocs/index.html").is_file():
        raise ValueError("请先运行 bun run build 生成前端安装包")
    patch_defaults(source, device, role)
    relay_patch = patch_odhcpd(source / "package/network/services/odhcpd") if role == "router" else None
    config = SOURCES[device]
    feeds = "".join(f"src-git {name} {feed['url']}^{feed['revision']}\n" for name, feed in config["feeds"].items())
    (source / "feeds.conf.default").write_text(feeds, encoding="utf-8", newline="\n")
    shutil.copytree(bundle, source / "package/router-ui", dirs_exist_ok=True)
    metadata = overlay(source / "files", device, role, wan)
    # N1 打包结束时会再次覆盖这些文件，保证两台设备使用同一份前端。
    shutil.copytree(bundle / "htdocs", source / "files/www", dirs_exist_ok=True)
    (source / "build-inputs.json").write_text(json.dumps({"device": metadata, "sources": config, "odhcpd_link_recovery": relay_patch, "n1_packager": SOURCES["n1_packager"] if device == "phicomm-n1" else None}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def prepare_config(source, device, role):
    # 在所有 feeds 与补丁就绪后写入合并配置，避免 feeds 刷新提前剔除外部包。
    (source / ".config").write_text(merge_config(device, role), encoding="utf-8", newline="\n")


def verify_revisions(source, device):
    expected = SOURCES[device]
    revisions = {"source": (source, expected["revision"])}
    revisions.update({name: (source / "feeds" / name, feed["revision"]) for name, feed in expected["feeds"].items()})
    resolved = {}
    for name, (directory, revision) in revisions.items():
        actual = subprocess.run(["git", "-C", str(directory), "rev-parse", "--verify", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()
        if actual != revision:
            raise ValueError(f"源码提交不匹配：{name}，预期 {revision}，实际 {actual}")
        resolved[name] = actual
    (source / "resolved-sources.json").write_text(json.dumps(resolved, indent=2) + "\n", encoding="utf-8")


def verify(source, device, role):
    config = dict(re.findall(r"^(CONFIG_[^=\s]+)=(.+)$", (source / ".config").read_text(encoding="utf-8"), re.M))
    required = ["base-files", "busybox", "procd", "netifd", "logd", "uci", "router-ui", "dropbear", "dnsmasq", "firewall4", "rpcd", "jsonfilter", "ucode", "ucode-mod-fs", "uhttpd", "uhttpd-mod-ubus", "px5g-openssl", "libustream-openssl"]
    if device == "jdcloud-ax1800":
        required += AX_STORAGE + ["wpad-openssl", "rpcd-mod-iwinfo", "ath11k-firmware-ipq6018", "ipq-wifi-jdcloud_re-ss-01", "kmod-ath11k-ahb", "kmod-qca-nss-dp", "kmod-qca-nss-drv", "kmod-qca-nss-ecm", "nss-firmware-ipq60xx"]
        target = "CONFIG_TARGET_qualcommax_ipq60xx_DEVICE_jdcloud_re-ss-01"
    else:
        required += ["sfdisk", "partx-utils", "blockdev", "btrfs-progs", "wpad-basic-openssl", "wifi-scripts", "iw", "iwinfo", "rpcd-mod-iwinfo", "wireless-regdb"]
        if any(config.get(f"CONFIG_PACKAGE_{name}") in ("y", "m") for name in ("kmod-fs-btrfs", "kmod-cfg80211", "kmod-mac80211", "kmod-brcmfmac")):
            raise ValueError("N1 必须使用 ophub 配套内核，不能混入通用内核模块")
        missing_options = [name for name in ("CONFIG_WIFI_SCRIPTS_UCODE", "CONFIG_DRIVER_11AC_SUPPORT") if config.get(name) != "y"]
        if missing_options:
            raise ValueError(f"N1 无线能力选项未启用：{', '.join(missing_options)}")
        target = "CONFIG_TARGET_armsr_armv8_DEVICE_generic"
        if config.get("CONFIG_TARGET_ROOTFS_TARGZ") != "y":
            raise ValueError("N1 必须生成根文件系统压缩包")
    if role == "router":
        required += ROUTING
    missing = [name for name in required if config.get(f"CONFIG_PACKAGE_{name}") != "y"]
    forbidden = [name.removeprefix("CONFIG_PACKAGE_") for name, value in config.items() if value in ("y", "m") and name.startswith("CONFIG_PACKAGE_") and name.removeprefix("CONFIG_PACKAGE_").startswith(FORBIDDEN)]
    selected = [name for name, value in config.items() if value == "y" and re.fullmatch(r"CONFIG_TARGET_.+_DEVICE_.+", name)]
    if selected != [target] or missing or forbidden:
        raise ValueError(f"配置校验失败：目标={selected}，缺少={missing}，多余={forbidden}")
    print(f"配置通过：{device} / {role}；已选择 {sum(name.startswith('CONFIG_PACKAGE_') and value == 'y' for name, value in config.items())} 个内置包")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("fetch", "prepare", "prepare-storage", "prepare-config", "verify", "verify-revisions", "overlay"))
    parser.add_argument("--device", choices=DEVICES, required=True)
    parser.add_argument("--role", choices=("router", "bypass"), default="router")
    parser.add_argument("--wan", default="eth1")
    parser.add_argument("--source", type=Path, required=True)
    args = parser.parse_args()
    source = args.source.resolve()
    validate_role(args.device, args.role, args.wan)
    if args.command == "fetch":
        checkout(SOURCES[args.device]["url"], SOURCES[args.device]["revision"], source)
    elif args.command == "prepare":
        prepare(source, args.device, args.role, args.wan)
    elif args.command == "prepare-storage":
        if args.device == "phicomm-n1":
            inputs = json.loads((source / "build-inputs.json").read_text(encoding="utf-8"))
            inputs["n1_storage"] = prepare_n1_storage(source)
            (source / "build-inputs.json").write_text(json.dumps(inputs, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    elif args.command == "prepare-config":
        prepare_config(source, args.device, args.role)
    elif args.command == "verify":
        verify(source, args.device, args.role)
    elif args.command == "verify-revisions":
        verify_revisions(source, args.device)
    else:
        overlay(source, args.device, args.role, args.wan)


if __name__ == "__main__":
    main()
