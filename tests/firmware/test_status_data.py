"""真实 ucode 验证租约、内核状态及存储解析，不读取宿主私有租约。"""
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[2]


class StatusDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.command = shlex.split(os.environ.get("UCODE_TEST_COMMAND", "")) or ([shutil.which("ucode")] if shutil.which("ucode") else [])
        if not cls.command:
            raise unittest.SkipTest("需要真实 ucode")

    def run_code(self, body, bus="function connect() { return null; }"):
        source = (ROOT / "package/router-ui/files/status.uc").read_text(encoding="utf-8").split("\ntry {")[0]
        source = source.replace("import { connect } from 'ubus';", bus)
        result = subprocess.run([*self.command, "-e", source + body], capture_output=True, encoding="utf-8", timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_wireless_calls_netifd_without_gateway_arguments_and_filters_credentials(self):
        fixture = {"radio0": {"up": True, "pending": False, "disabled": False,
            "config": {"band": "2g", "channel": "1", "key": "radio-secret"},
            "interfaces": [{"section": "default_radio0", "ifname": "wlan0",
                "config": {"ssid": "N1", "mode": "ap", "key": "wifi-secret", "password": "auth-secret"},
                "stations": [{"key": "station-secret"}]}]},
            "radio1": {"up": False, "disabled": True, "retry_setup_failed": True, "interfaces": []}}
        bus = """
let calls = [], disconnected = false;
function connect(socket, timeout) {
    push(calls, ['connect', socket, timeout]);
    return { call: (object, method, args) => {
        push(calls, [object, method, args]);
        // 与实机行为一致：多余的会话字段会导致参数错误。
        return length(keys(args)) ? null : json(FIXTURE);
    }, disconnect: () => { disconnected = true; } };
}
""".replace("FIXTURE", json.dumps(json.dumps(fixture)))
        result = self.run_code("let result = wireless(); print({result, calls, disconnected});", bus)
        self.assertEqual(result["calls"], [["connect", None, 2], ["network.wireless", "status", {}]])
        self.assertTrue(result["disconnected"])
        self.assertTrue(result["result"]["ok"])
        radio = result["result"]["radios"]["radio0"]
        self.assertTrue(radio["up"])
        self.assertEqual(radio["config"], {"band": "2g", "hwmode": "", "channel": "1"})
        self.assertEqual(radio["interfaces"], [{"section": "default_radio0", "ifname": "wlan0", "config": {"ssid": "N1", "mode": "ap"}}])
        self.assertTrue(result["result"]["radios"]["radio1"]["disabled"])
        self.assertTrue(result["result"]["radios"]["radio1"]["retry_setup_failed"])
        self.assertNotIn("secret", json.dumps(result))

    def test_wireless_missing_source_is_not_reported_as_an_empty_or_disabled_radio(self):
        result = self.run_code("print([wireless(), wirelessData(null), wirelessData([]), wirelessData({})]);")
        self.assertEqual(result[:3], [{"ok": False, "error": "wireless_unavailable"}] * 3)
        self.assertEqual(result[3], {"ok": True, "radios": {}})

    def test_wireless_bounds_records_and_ignores_malformed_nested_fields(self):
        result = self.run_code("""
let fixture = {};
for (let i = 0; i < 10; i++) {
    let interfaces = [];
    for (let j = 0; j < 40; j++) push(interfaces, { ifname: 'wlan0', config: { ssid: { key: 'secret' } } });
    fixture['radio' + i] = { up: true, interfaces };
}
print(wirelessData(fixture));
""")
        self.assertEqual(len(result["radios"]), 8)
        self.assertEqual(len(result["radios"]["radio0"]["interfaces"]), 32)
        self.assertEqual(result["radios"]["radio0"]["interfaces"][0]["config"]["ssid"], "")
        self.assertNotIn("secret", json.dumps(result))

    def test_leases_ignore_expired_malformed_duplicates_and_keep_permanent(self):
        content = "\n".join([
            "2000 02:00:00:00:00:01 192.168.1.100 laptop *",
            "2000 02:00:00:00:00:01 192.168.1.100 laptop *",
            "1000 02:00:00:00:00:02 192.168.1.101 expired *",
            "0 02:00:00:00:00:03 192.168.1.102 * *",
            "2000 02:00:00:00:00:04 999.168.1.103 invalid *",
            "2000 ../bad 192.168.1.104 invalid *",
        ])
        result = self.run_code("print(parseLeases(" + json.dumps(content) + ", 1000));")
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["remaining"], 1000)
        self.assertEqual(result[1]["remaining"], None)
        self.assertEqual(result[1]["hostname"], None)

    def test_ipv6_only_bound_leases_include_addresses_and_delegated_prefixes(self):
        data = {"device": {"br-lan": {"leases": [
            {"flags": ["bound"], "duid": "0001", "hostname": "pc", "valid": 3600, "ipv6-addr": [{"address": "fd00::1"}], "ipv6-prefix": [{"address": "fd01::", "prefix-length": 64}]},
            {"flags": ["bound"], "duid": "0002", "valid": 4294967295, "ipv6-addr": [{"address": "fd00::2"}]},
            {"flags": [], "duid": "0003", "valid": 3600, "ipv6-addr": [{"address": "fd00::3"}]},
            {"flags": ["bound"], "duid": "0004", "valid": 0, "ipv6-addr": [{"address": "fd00::4"}]},
        ]}}}
        result = self.run_code("print(parseLeases6(json(" + json.dumps(json.dumps(data)) + ")));" )
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["addresses"], ["fd00::1/128", "fd01::/64"])
        self.assertIsNone(result[1]["remaining"])

    def test_df_counts_used_and_available_separately_and_rejects_bad_output(self):
        output = "Filesystem 1024-blocks Used Available Capacity Mounted on\noverlayfs:/overlay 65536 16384 45000 25% /\n"
        result = self.run_code("print([parseDisk(" + json.dumps(output) + ", 'root', '/'), parseDisk('failed', 'root', '/')]);")
        self.assertEqual(result[0]["available"], 45000 * 1024)
        self.assertEqual(result[0]["used"], 16384 * 1024)
        self.assertIsNone(result[1])

    def test_block_capacity_distinguishes_tail_space_from_filesystem_free_space(self):
        parts = [{"name": "sda1", "start": 8192, "sectors": 522240}, {"name": "sda2", "start": 532480, "sectors": 2097152}]
        result = self.run_code("print([diskLayout('sda', 30218842, " + json.dumps(parts) + ", '/dev/sda2'), diskLayout('sdb', 100, [], null), diskLayout('sdc', 100, [], '/dev/sdc'), diskLayout('loop0', 100, [], null)]);")
        self.assertEqual(result[0]["total"], 30218842 * 512)
        self.assertEqual(result[0]["unallocated"], (30218842 - 532480 - 2097152) * 512)
        self.assertTrue(result[0]["system"])
        self.assertIsNone(result[1]["unallocated"])
        self.assertEqual(result[2]["unallocated"], 0)
        self.assertIsNone(result[3])

    def test_combined_df_selects_only_requested_mountpoint(self):
        output = "/dev/sda2 100 10 80 10% /\ntmpfs 200 5 195 2% /tmp\n"
        result = self.run_code("print([parseDisk(" + json.dumps(output) + ", 'root', '/'), parseDisk(" + json.dumps(output) + ", 'tmp', '/tmp')]);")
        self.assertEqual(result[0]["source"], "/dev/sda2")
        self.assertEqual(result[1]["total"], 200 * 1024)

    def test_kernel_sensors_ports_and_missing_counters_are_not_fabricated(self):
        root = "/tmp/router-ui-status-" + uuid.uuid4().hex
        source = (ROOT / "package/router-ui/files/status.uc").read_text(encoding="utf-8").split("\ntry {")[0]
        source = source.replace("import { connect } from 'ubus';", "")
        source = source.replace("import { readfile,", "import { mkdir, unlink, rmdir, writefile, readfile,")
        source = source.replace("/sys/class/thermal/", root + "/thermal/").replace("/sys/class/net/", root + "/net/")
        setup = "mkdir('/tmp');"
        paths = [root, root + "/thermal", root + "/thermal/thermal_zone0", root + "/thermal/thermal_zone1", root + "/net", root + "/net/eth0", root + "/net/eth0/device", root + "/net/eth0/statistics", root + "/net/lo"]
        for path in paths: setup += f"mkdir({json.dumps(path)});"
        files = {"/thermal/thermal_zone0/type": "cpu-thermal", "/thermal/thermal_zone0/temp": "58500", "/thermal/thermal_zone1/temp": "999999", "/net/eth0/type": "1", "/net/eth0/carrier": "1", "/net/eth0/speed": "1000", "/net/eth0/statistics/rx_bytes": "100000", "/net/lo/type": "772"}
        for path, content in files.items(): setup += f"writefile({json.dumps(root+path)}, {json.dumps(content)});"
        cleanup = ""
        for path in files: cleanup += f"unlink({json.dumps(root+path)});"
        for path in reversed(paths): cleanup += f"rmdir({json.dumps(path)});"
        result = subprocess.run([*self.command, "-e", source + setup + "print({temperatures:temperatures(), ports:ports()});" + cleanup], capture_output=True, encoding="utf-8", timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data["temperatures"], [{"name": "cpu-thermal", "celsius": 58.5}])
        self.assertEqual(len(data["ports"]), 1)
        self.assertEqual(data["ports"][0]["speed"], 1000)
        self.assertIsNone(data["ports"][0]["tx"])

