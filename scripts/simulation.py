"""在 QEMU ARM64 中安装真实软件包，验证网络并运行浏览器测试。"""

import argparse
import hashlib
import ipaddress
import json
import os
import shlex
import shutil
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import firmware
from qemu_host import network_device

ROOT = firmware.ROOT
SIMULATION_VERSION = json.loads((ROOT / "configs/simulation.json").read_text(encoding="utf-8"))["version"]
REPORT = ROOT / "build/simulation-report"
WORK = ROOT / "build/simulation-private"
BRIDGE = "br-router-ci"
TAP = "tap-router-ci"
IPV6_TAP = "tap-router-v6"
NAMESPACE = "router-ci-client"


def run(*args, **kwargs):
    return subprocess.run([str(arg) for arg in args], check=True, text=True, **kwargs)


def prepare_overlay(device, role):
    overlay = WORK / "overlay"
    metadata = firmware.overlay(overlay, device, role)
    # 通用虚拟机只有 VirtIO 网卡；物理设备的交换机/USB/无线驱动不在模拟范围内。
    network = firmware.n1_network(role, "eth1").replace("192.168.69.1", metadata["address"])
    (overlay / "etc/config/network").write_text(network, encoding="utf-8")
    template = (ROOT / "files/n1-dhcp.template").read_text(encoding="utf-8")
    (overlay / "etc/config/dhcp").write_text(template.replace("@IGNORE@", "0" if role == "router" else "1").replace("@IPV6@", "server" if role == "router" else "disabled"), encoding="utf-8")
    dropbear = overlay / "etc/dropbear"
    dropbear.mkdir(parents=True, exist_ok=True)
    run("ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", WORK / "ssh-key")
    shutil.copyfile(WORK / "ssh-key.pub", dropbear / "authorized_keys")
    if device == "jdcloud-ax1800":
        # 只验证无线 UCI 表单与应用协议；虚拟机没有 AX1800 的射频硬件。
        (overlay / "etc/config/wireless").write_text("""config wifi-device 'radio0'
    option type 'mac80211'
    option path 'platform/ci-configuration-fixture'
    option band '2g'
    option channel '1'
    option disabled '1'

config wifi-iface 'default_radio0'
    option device 'radio0'
    option network 'lan'
    option mode 'ap'
    option encryption 'none'
    option ssid 'CI configuration fixture'
    option disabled '1'

config wifi-device 'radio1'
    option type 'mac80211'
    option path 'platform/ci-5g-configuration-fixture'
    option band '5g'
    option channel '36'
    option disabled '1'

config wifi-iface 'default_radio1'
    option device 'radio1'
    option network 'lan'
    option mode 'ap'
    option encryption 'none'
    option ssid 'CI 5 GHz configuration fixture'
    option disabled '1'
""", encoding="utf-8")
    return metadata


def ssh_handshake_failure(error, address):
    # 只识别 OpenSSH 在运行远程命令前产生的固定连接/密钥交换错误。
    # client_loop、通道中断、远程退出码和已有标准输出都不能证明命令尚未执行。
    if error.returncode != 255 or error.stdout or not isinstance(error.stderr, str):
        return False
    lines = error.stderr.strip().splitlines()
    kex = {
        "kex_exchange_identification: read: Connection reset by peer",
        "kex_exchange_identification: Connection reset by peer",
        "kex_exchange_identification: Connection closed by remote host",
        "kex_exchange_identification: read: Connection closed by remote host",
    }
    if lines and lines[0] in kex:
        return len(lines) == 1 or (len(lines) == 2 and lines[1] in {
            f"Connection reset by {address} port 22",
            f"Connection closed by {address} port 22",
        })
    return len(lines) == 1 and lines[0] in {
        f"ssh: connect to host {address} port 22: Connection refused",
        f"ssh: connect to host {address} port 22: No route to host",
        f"ssh: connect to host {address} port 22: Connection timed out",
    }


def ssh(address, command, **kwargs):
    args = ("ssh", "-i", WORK / "ssh-key", "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=accept-new", "-o", f"UserKnownHostsFile={WORK / 'known_hosts'}", "-o", "ConnectTimeout=3", "-o", "LogLevel=ERROR", f"root@{address}", command)
    captured_stderr = kwargs.get("capture_output") or kwargs.get("stderr") == subprocess.PIPE
    for attempt in range(3):
        try:
            return run(*args, **kwargs)
        except subprocess.CalledProcessError as error:
            if attempt == 2 or not captured_stderr or not ssh_handshake_failure(error, address):
                raise
            time.sleep(0.5 * (attempt + 1))


def wait_for_guest(address, process, previous_boot=None):
    deadline = time.monotonic() + 240
    while time.monotonic() < deadline:
        if process.poll() is not None:
            details = (REPORT / "qemu.log").read_text(encoding="utf-8", errors="replace").strip()
            raise RuntimeError(f"QEMU 提前退出（{process.returncode}）：{details[:2000]}")
        try:
            command = "test \"$(uci -q get router-lite.setup.initialized)\" = 1 && ubus list system"
            if previous_boot:
                command = f'test "$(cat /proc/sys/kernel/random/boot_id)" != {shlex.quote(previous_boot)} && ' + command
            result = ssh(address, command, capture_output=True, timeout=8)
            if "system" in result.stdout:
                return
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            pass
        time.sleep(2)
    raise TimeoutError("OpenWrt 启动超时，请查看 qemu.log 和 console.log")


def wait_for_https(address):
    # 只用于一次性模拟机的自签名证书；不修改前端的证书校验逻辑。
    context = ssl._create_unverified_context()
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"https://{address}/device.json", context=context, timeout=3) as response:
                if json.load(response)["address"] == address:
                    return
        except (urllib.error.URLError, TimeoutError, OSError):
            pass
        time.sleep(1)
    raise TimeoutError("OpenWrt HTTPS 服务启动超时")


def wait_for_network_services(address, role):
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        try:
            services = json.loads(ssh(address, "ubus call service list '{\"name\":\"dnsmasq\"}'", capture_output=True, timeout=8).stdout)
            instances = services.get("dnsmasq", {}).get("instances", {}).values()
            if not any(instance.get("running") for instance in instances):
                time.sleep(1)
                continue
            if role == "router":
                wan = json.loads(ssh(address, "ubus call network.interface.wan status", capture_output=True, timeout=8).stdout)
                if not wan.get("up"):
                    time.sleep(1)
                    continue
                # dnsmasq 第一次可能只启动 DNS，LAN/WAN 稳定后才重载为 DHCP 服务。
                ssh(address, "logread | grep -F 'DHCP, IP range ' >/dev/null", capture_output=True, timeout=8)
            return
        except (subprocess.SubprocessError, ValueError, OSError):
            pass
        time.sleep(1)
    raise TimeoutError("DNS/DHCP 服务在启动后未就绪，请查看 system.log")


def network_preflight(address):
    links = json.loads(run("ip", "-j", "addr", "show", capture_output=True).stdout)
    reserved = {BRIDGE, TAP, IPV6_TAP, "router-ci-host", "router-ci-peer"}
    if any(link["ifname"] in reserved for link in links):
        raise ValueError("模拟网桥或网口已存在，请先核对旧测试资源")
    namespaces = run("ip", "netns", "list", capture_output=True).stdout.splitlines()
    if any(line.split()[0] == NAMESPACE for line in namespaces if line.strip()):
        raise ValueError("模拟网络命名空间已存在，请先核对旧测试资源")
    planned = ipaddress.ip_network(f"{address}/24", strict=False)
    for link in links:
        for item in link.get("addr_info", []):
            if item["family"] == "inet":
                existing = ipaddress.ip_network(f"{item['local']}/{item['prefixlen']}", strict=False)
                if planned.overlaps(existing):
                    raise ValueError(f"模拟网段与本机已有网段重叠：{existing}，请在独立的 CI runner 运行")
            elif item["family"] == "inet6":
                existing = ipaddress.ip_network(f"{item['local']}/{item['prefixlen']}", strict=False)
                if any(existing.overlaps(ipaddress.ip_network(prefix)) for prefix in ("2001:db8:100::/64", "2001:db8:200::/56")):
                    raise ValueError("IPv6 模拟网段与宿主已有网络重叠")


def network_up(address):
    subnet = address.rsplit(".", 1)[0]
    run("sudo", "ip", "link", "add", BRIDGE, "type", "bridge")
    run("sudo", "ip", "addr", "add", subnet + ".254/24", "dev", BRIDGE)
    run("sudo", "ip", "link", "set", BRIDGE, "up")
    # GitHub runner 上 Docker 的 FORWARD=DROP 不应拦截这个独立桥中的测试客户端。
    run("sudo", "iptables", "-I", "FORWARD", "-i", BRIDGE, "-o", BRIDGE, "-j", "ACCEPT")
    run("sudo", "ip6tables", "-I", "FORWARD", "-i", BRIDGE, "-o", BRIDGE, "-j", "ACCEPT")
    run("sudo", "ip", "tuntap", "add", "dev", TAP, "mode", "tap", "user", str(os.getuid()))
    run("sudo", "ip", "link", "set", TAP, "master", BRIDGE)
    run("sudo", "ip", "link", "set", TAP, "up")
    run("sudo", "ip", "netns", "add", NAMESPACE)
    run("sudo", "ip", "link", "add", "router-ci-host", "type", "veth", "peer", "name", "router-ci-peer")
    run("sudo", "ip", "link", "set", "router-ci-host", "master", BRIDGE)
    run("sudo", "ip", "link", "set", "router-ci-host", "up")
    run("sudo", "ip", "link", "set", "router-ci-peer", "netns", NAMESPACE)
    run("sudo", "ip", "-n", NAMESPACE, "link", "set", "router-ci-peer", "name", "eth0")
    run("sudo", "ip", "-n", NAMESPACE, "link", "set", "eth0", "up")
    run("sudo", "ip", "-n", NAMESPACE, "link", "set", "lo", "up")
    # 独立第三网卡仅用于 IPv6 路由联调，不修改宿主默认路由或真实网口。
    run("sudo", "ip", "tuntap", "add", "dev", IPV6_TAP, "mode", "tap", "user", str(os.getuid()))
    run("sudo", "ip", "link", "set", IPV6_TAP, "up")
    run("sudo", "ip", "-6", "addr", "add", "2001:db8:100::1/64", "dev", IPV6_TAP)
    run("sudo", "ip", "-6", "route", "add", "2001:db8:200::/56", "via", "2001:db8:100::2", "dev", IPV6_TAP)
    run("sudo", "ip6tables", "-I", "INPUT", "-i", IPV6_TAP, "-p", "tcp", "--dport", "18093", "-j", "ACCEPT")


def network_down():
    commands = [
        ("ip6tables", "-D", "INPUT", "-i", IPV6_TAP, "-p", "tcp", "--dport", "18093", "-j", "ACCEPT"),
        ("ip", "link", "delete", IPV6_TAP),
        ("iptables", "-D", "FORWARD", "-i", BRIDGE, "-o", BRIDGE, "-j", "ACCEPT"),
        ("ip6tables", "-D", "FORWARD", "-i", BRIDGE, "-o", BRIDGE, "-j", "ACCEPT"),
        ("ip", "netns", "delete", NAMESPACE),
        ("ip", "link", "delete", "router-ci-host"),
        ("ip", "link", "delete", TAP),
        ("ip", "link", "delete", BRIDGE),
    ]
    for command in commands:
        subprocess.run(["sudo", *command], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def build_image(role, device):
    imagebuilder = ROOT / "build/simulation-tools/imagebuilder"
    # 官方仓库没有 fork 中的 px5g-openssl，测试系统使用 uhttpd 原生 OpenSSL 回退。
    packages = "uhttpd uhttpd-mod-ubus rpcd jsonfilter ucode ucode-mod-fs ucode-mod-ubus ucode-mod-uci coreutils-timeout rpcd-mod-iwinfo libustream-openssl openssl-util ca-bundle -luci -luci-light -luci-ssl -wpad-basic-mbedtls -libustream-mbedtls -libustream-wolfssl"
    if device == "jdcloud-ax1800":
        packages += " wifi-scripts"
    if role == "bypass":
        packages += " -ppp -ppp-mod-pppoe -odhcpd-ipv6only"
    with (REPORT / "imagebuilder.log").open("w") as log:
        run("make", "-C", imagebuilder, "image", "PROFILE=generic", f"PACKAGES={packages}", f"FILES={WORK / 'overlay'}", f"BIN_DIR={WORK / 'images'}", "ROOTFS_PARTSIZE=128", stdout=log, stderr=subprocess.STDOUT)
    kernels = list((WORK / "images").glob("*-generic-kernel.bin"))
    rootfs = list((WORK / "images").glob("*-generic-ext4-rootfs.img.gz"))
    if len(kernels) != 1 or len(rootfs) != 1:
        raise ValueError("ImageBuilder 未生成唯一的 ARM64 内核和 ext4 根文件系统")
    import gzip
    disk = WORK / "rootfs.img"
    with gzip.open(rootfs[0], "rb") as source, disk.open("wb") as target:
        shutil.copyfileobj(source, target)
    return kernels[0], disk


def install_package(address, package):
    # 用 SSH 标准输入传输，避免依赖固件中没有的 SFTP 服务。
    with package.open("rb") as stream:
        ssh(address, "cat > /tmp/router-ui.apk", stdin=stream, capture_output=True)
    expected = hashlib.sha256(package.read_bytes()).hexdigest()
    actual = ssh(address, "sha256sum /tmp/router-ui.apk", capture_output=True).stdout.split()[0]
    if actual != expected:
        raise ValueError("传入虚拟机的安装包校验失败")
    with (REPORT / "install.log").open("w") as log:
        # 私有构建包未签入官方源，仅对这个明确的本地包允许未受信任签名。
        ssh(address, "apk add --no-network --allow-untrusted /tmp/router-ui.apk && apk info -e router-ui && /etc/init.d/rpcd restart && /etc/init.d/uhttpd restart", stdout=log, stderr=subprocess.STDOUT, timeout=90)
    # 确认实际安装的每个静态文件和权限文件与本次构建一致。
    bundle = ROOT / "build/router-ui"
    lines = []
    for path in sorted((bundle / "htdocs").rglob("*")):
        if path.is_file():
            lines.append(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  /www/{path.relative_to(bundle / 'htdocs').as_posix()}")
    acl = bundle / "files/router-ui.json"
    lines.append(f"{hashlib.sha256(acl.read_bytes()).hexdigest()}  /usr/share/rpcd/acl.d/router-ui.json")
    plugin = bundle / "files/router.maintenance"
    lines.append(f"{hashlib.sha256(plugin.read_bytes()).hexdigest()}  /usr/libexec/rpcd/router.maintenance")
    for name, destination in {'router.status': '/usr/libexec/rpcd/router.status', 'status.uc': '/usr/libexec/router-ui/status.uc'}.items():
        lines.append(f"{hashlib.sha256((bundle / 'files' / name).read_bytes()).hexdigest()}  {destination}")
    data_helper = bundle / "files/maintenance-data.uc"
    lines.append(f"{hashlib.sha256(data_helper.read_bytes()).hexdigest()}  /usr/libexec/router-ui/maintenance-data.uc")
    password_helper = bundle / "files/password.uc"
    lines.append(f"{hashlib.sha256(password_helper.read_bytes()).hexdigest()}  /usr/libexec/router-ui/password.uc")
    for name, destination in {
        'router.diagnostics': '/usr/libexec/rpcd/router.diagnostics',
        'diagnostics.uc': '/usr/libexec/router-ui/diagnostics.uc',
        'time-settings.uc': '/usr/libexec/router-ui/time-settings.uc',
        'schedule.uc': '/usr/libexec/router-ui/schedule.uc',
        'scheduled-reboot': '/usr/libexec/router-ui/scheduled-reboot',
        'led-policy.uc': '/usr/libexec/router-ui/led-policy.uc',
        'led-state': '/usr/libexec/router-ui/led-state',
        'router-ui-led': '/etc/init.d/router-ui-led',
        'router-ui-led-boot': '/etc/init.d/router-ui-led-boot',
        'led-hotplug': '/etc/hotplug.d/iface/95-router-ui-led',
    }.items():
        lines.append(f"{hashlib.sha256((bundle / 'files' / name).read_bytes()).hexdigest()}  {destination}")
    with (REPORT / "installed-files.log").open("w") as log:
        ssh(address, "sha256sum -c -", input="\n".join(lines) + "\n", stdout=log, stderr=subprocess.STDOUT)


def test_network(role, address, expected_pool=None, report_name="network"):
    hook = WORK / "dhcp-hook.sh"
    hook.write_text("""#!/bin/sh
set -eu
case "$1" in
  bound|renew)
    ip addr flush dev "$interface"
    ip addr add "$ip/${mask:-24}" dev "$interface"
    for gateway in $router; do ip route replace default via "$gateway" dev "$interface"; break; done
    ;;
esac
""", encoding="utf-8")
    hook.chmod(0o755)
    dhcp_log = "dhcp.log" if report_name == "network" else report_name + "-dhcp.log"
    with (REPORT / dhcp_log).open("w") as log:
        result = subprocess.run(["sudo", "ip", "netns", "exec", NAMESPACE, "busybox", "udhcpc", "-i", "eth0", "-n", "-q", "-t", "4", "-T", "3", "-s", str(hook)], stdout=log, stderr=subprocess.STDOUT, timeout=35)
    if role == "bypass":
        log = (REPORT / dhcp_log).read_text()
        if result.returncode != 1 or "no lease, failing" not in log:
            raise AssertionError("旁路由应完成 DHCP 探测且收不到租约，请查看 dhcp.log")
        # 证明客户端连通性，防止因为虚拟链路断开而误判 DHCP 已关闭。
        run("sudo", "ip", "-n", NAMESPACE, "addr", "add", "192.168.68.200/24", "dev", "eth0")
    elif result.returncode != 0:
        raise AssertionError("主路由未能分配 DHCP 地址")
    network = run("sudo", "ip", "-n", NAMESPACE, "-j", "addr", "show", "eth0", capture_output=True).stdout
    data = json.loads(network)
    addresses = [item["local"] for link in data for item in link["addr_info"] if item["family"] == "inet"]
    if role == "router" and not any(value.startswith(address.rsplit(".", 1)[0] + ".") for value in addresses):
        raise AssertionError("DHCP 客户端没有取得正确 LAN 子网地址")
    if expected_pool and not any(ipaddress.IPv4Address(expected_pool[0]) <= ipaddress.IPv4Address(value) <= ipaddress.IPv4Address(expected_pool[1]) for value in addresses):
        raise AssertionError("DHCP 客户端取得的地址不在新地址池内")
    run("sudo", "ip", "netns", "exec", NAMESPACE, "curl", "--fail", "--silent", "--insecure", "--max-time", "15", f"https://{address}/device.json", stdout=subprocess.DEVNULL)
    if role == "router":
        # 10.0.2.2 是 QEMU WAN 侧宿主机，客户端只能经虚拟路由器的转发及 NAT 访问。
        result = run("sudo", "ip", "netns", "exec", NAMESPACE, "curl", "--fail", "--silent", "--max-time", "20", "http://10.0.2.2:18090/wan-marker", capture_output=True)
        if result.stdout != "router-ci-wan-ok\n":
            raise AssertionError("LAN 到 WAN 的 NAT 转发测试失败")
    (REPORT / (report_name + ".json")).write_text(json.dumps({"role": role, "client_addresses": addresses, "dhcp": "disabled" if role == "bypass" else "lease acquired", "lan_https": "passed", "wan_nat": "passed" if role == "router" else "not applicable"}, indent=2) + "\n")


def guest_policy(address, metadata):
    checks = {
        "router-lite.setup.initialized": "1",
        "network.lan.ipaddr": metadata["address"],
        "dhcp.lan.ignore": "1" if metadata["role"] == "bypass" else "0",
        "dhcp.lan.ra": "disabled" if metadata["role"] == "bypass" else "server",
        "uhttpd.main.redirect_https": "1",
        "uhttpd.main.no_ubusauth": "0",
    }
    for key, expected in checks.items():
        actual = ssh(address, f"uci -q get {shlex.quote(key)}", capture_output=True).stdout.strip()
        if actual != expected:
            raise AssertionError(f"运行配置不符：{key}，期望 {expected}，实际 {actual}")
    wan = ssh(address, "uci -q get network.wan.device || true", capture_output=True).stdout.strip()
    if wan != ("eth1" if metadata["role"] == "router" else ""):
        raise AssertionError("WAN 网口配置不符")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", choices=firmware.DEVICES, required=True)
    parser.add_argument("--role", choices=("router", "bypass"), required=True)
    parser.add_argument("--package", type=Path, required=True)
    args = parser.parse_args()
    firmware.validate_role(args.device, args.role, "eth1")
    if args.package.suffix != ".apk" or not args.package.is_file():
        raise ValueError("需要本次构建的 router-ui APK 文件")
    if not os.environ.get("SIM_PASSWORD"):
        raise ValueError("需要一次性 SIM_PASSWORD")
    if "udhcpc" not in run("busybox", "--list", capture_output=True).stdout.splitlines():
        raise ValueError("需要包含 udhcpc 的 busybox-static")
    if WORK.exists():
        raise ValueError("模拟目录必须是干净的 checkout")
    WORK.mkdir(parents=True, mode=0o700)
    REPORT.mkdir(parents=True, exist_ok=True)
    processes = []
    success = False
    network_created = False
    qemu_log = (REPORT / "qemu.log").open("w")
    wan_log = (REPORT / "wan-server.log").open("w")
    try:
        metadata = prepare_overlay(args.device, args.role)
        address = metadata["address"]
        network_preflight(address)
        kernel, disk = build_image(args.role, args.device)
        network_created = True
        network_up(address)
        wan_directory = WORK / "wan"
        wan_directory.mkdir()
        (wan_directory / "wan-marker").write_text("router-ci-wan-ok\n")
        processes.append(subprocess.Popen(["python3", "-m", "http.server", "18090", "--bind", "127.0.0.1", "--directory", str(wan_directory)], stdout=wan_log, stderr=subprocess.STDOUT))
        process = subprocess.Popen([
            "qemu-system-aarch64", "-machine", "virt", "-cpu", "cortex-a53", "-accel", "tcg", "-m", "512", "-smp", "2", "-display", "none", "-monitor", "none", "-serial", f"file:{REPORT / 'console.log'}",
            "-kernel", str(kernel), "-append", "root=/dev/vda rootwait console=ttyAMA0,115200",
            "-drive", f"file={disk},format=raw,if=virtio",
            "-netdev", f"tap,id=lan,ifname={TAP},script=no,downscript=no", "-device", network_device("lan", "52:54:00:12:34:01"),
            "-netdev", "user,id=wan,net=10.0.2.0/24,hostfwd=tcp:127.0.0.1:18081-:18081", "-device", network_device("wan", "52:54:00:12:34:02"),
            "-netdev", f"tap,id=ipv6,ifname={IPV6_TAP},script=no,downscript=no", "-device", network_device("ipv6", "52:54:00:12:34:03"),
            "-object", "rng-random,filename=/dev/urandom,id=rng0", "-device", "virtio-rng-pci,rng=rng0",
        ], stdin=subprocess.DEVNULL, stdout=qemu_log, stderr=subprocess.STDOUT)
        processes.append(process)
        wait_for_guest(address, process)
        password = os.environ["SIM_PASSWORD"]
        ssh(address, "passwd root", input=password + "\n" + password + "\n", capture_output=True)
        install_package(address, args.package.resolve())
        # 同一磁盘重新启动，验证已安装的文件和首次启动状态能够保留。
        boot_id = ssh(address, "cat /proc/sys/kernel/random/boot_id", capture_output=True).stdout.strip()
        ssh(address, "(sleep 1; reboot) >/dev/null 2>&1 &", capture_output=True)
        time.sleep(3)
        wait_for_guest(address, process, boot_id)
        wait_for_https(address)
        guest_policy(address, metadata)
        wait_for_network_services(address, args.role)
        test_network(args.role, address)
        run("python3", ROOT / "tests/runtime/configuration.py", "--address", address)
        env = dict(os.environ, SIM_BASE_URL=f"https://{address}", SIM_DEVICE=args.device, SIM_ROLE=args.role, SIM_ADDRESS=address)
        unit_env = dict(env, UCODE_TEST_COMMAND=shlex.join([sys.executable, str(ROOT / "tests/helpers/guest-ucode.py")]))
        with (REPORT / "ucode-tests.log").open("w") as log:
            for suite in ("test_maintenance_data.py", "test_password.py", "test_led_policy.py", "test_status_data.py", "test_router_basics.py", "test_schedule_policy.py"):
                run("python3", "-m", "unittest", "discover", "-s", ROOT / "tests/firmware", "-p", suite, "-v", env=unit_env, stdout=log, stderr=subprocess.STDOUT)
        run("python3", ROOT / "tests/runtime/maintenance.py", env=env)
        run("python3", ROOT / "tests/runtime/password.py", env=env)
        run("python3", ROOT / "tests/runtime/led.py", env=env)
        run("python3", ROOT / "tests/runtime/schedule.py", env=env)
        run("python3", ROOT / "tests/runtime/status.py", env=env)
        run("python3", ROOT / "tests/runtime/routing.py", env=env)
        run("python3", ROOT / "tests/runtime/router_basics.py", env=env)
        run("bun", "run", "test:e2e", env=env)
        success = True
    finally:
        if processes:
            try:
                with (REPORT / "system.log").open("w") as log:
                    ssh(address, "logread; echo '--- network ---'; ubus call network.interface dump; echo '--- packages ---'; apk info; echo '--- firewall ---'; nft list ruleset", stdout=log, stderr=subprocess.STDOUT, timeout=15)
            except (subprocess.SubprocessError, OSError):
                pass
        for process in reversed(processes):
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        qemu_log.close()
        wan_log.close()
        if network_created:
            network_down()
        (REPORT / "summary.json").write_text(json.dumps({"device": args.device, "role": args.role, "runtime": f"OpenWrt {SIMULATION_VERSION} ARM64 / QEMU virt", "package_sha256": hashlib.sha256(args.package.read_bytes()).hexdigest(), "passed": success, "hardware_emulated": False}, indent=2) + "\n")
        shutil.rmtree(WORK)
    if not success:
        raise RuntimeError("模拟测试失败")


if __name__ == "__main__":
    main()
