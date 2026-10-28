"""维护归档解析器回归：使用真实 ucode，未安装时由 QEMU 运行时测试覆盖。"""
import io
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tarfile
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[2]
IDENTITY = {"device": "jdcloud-ax1800", "role": "router", "revision": "fixture", "release": "release-fixture"}


def fixture(extra=(), identity=IDENTITY):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w", format=tarfile.USTAR_FORMAT) as archive:
        entries = [("router-ui-backup.json", json.dumps(identity).encode(), tarfile.REGTYPE)]
        entries += [(f"etc/config/{name}", b"config fixture\n", tarfile.REGTYPE) for name in ("network", "dhcp", "rpcd")]
        for name, data, kind in entries + list(extra):
            entry = tarfile.TarInfo(name)
            entry.type = kind
            entry.size = len(data)
            archive.addfile(entry, io.BytesIO(data))
    return output.getvalue()


class MaintenanceDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.command = shlex.split(os.environ.get("UCODE_TEST_COMMAND", "")) or ([shutil.which("ucode")] if shutil.which("ucode") else [])
        if not cls.command:
            raise unittest.SkipTest("未安装 ucode；本机可设置 UCODE_TEST_COMMAND，QEMU 执行真实接口测试")

    def run_ucode(self, body):
        root = f"/tmp/router-ui-test-{uuid.uuid4().hex}"
        source = (ROOT / "package/router-ui/files/maintenance-data.uc").read_text(encoding="utf-8").split("\ntry {")[0]
        source = source.replace("'/tmp/router-ui-upload'", json.dumps(root + "/upload"))
        source = source.replace("'/www/device.json'", json.dumps(root + "/device.json"))
        source = source.replace("'/etc/openwrt_release'", json.dumps(root + "/release"))
        source += f"\nmkdir('/tmp'); mkdir({json.dumps(root)}); mkdir(directory);"
        source += f"writefile({json.dumps(root + '/device.json')}, {json.dumps(json.dumps(IDENTITY))});"
        source += f"writefile({json.dumps(root + '/release')}, 'release-fixture');\n"
        source += "try { " + body + " } catch(e) { print(e.message); }\n"
        source += f"cleanup(); unlink({json.dumps(root + '/device.json')}); unlink({json.dumps(root + '/release')}); rmdir({json.dumps(root)});"
        result = subprocess.run([*self.command, "-e", source], capture_output=True, encoding="utf-8", timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def inspect(self, data):
        return self.run_ucode(f"print(archive(hexdec('{data.hex()}'), true));")

    def test_operation_record_filters_fields_and_rejects_malformed_state(self):
        value = {"id": "12345678-1234-1234-1234-123456789abc", "kind": "upgrade", "state": "failed",
                 "error": "upgrade_failed", "updatedAt": 1793187238,
                 "bootId": "87654321-1234-1234-1234-123456789abc"}
        self.assertEqual(json.loads(self.run_ucode(f"print(operationRecord({json.dumps(value)}));")), value)
        for update in ({"id": "bad"}, {"kind": "shell"}, {"state": "done"}, {"error": "bad;command"}, {"updatedAt": -1}):
            self.assertEqual(self.run_ucode(f"print(sprintf('%J', operationRecord({json.dumps(value | update)})));"), "null")

    def test_standard_ustar_is_validated_and_manifest_is_not_restored(self):
        data = fixture()
        output = self.run_ucode(f"archive(hexdec('{data.hex()}'), true); print(hexenc(readfile(directory + '/restore.tar')));")
        with tarfile.open(fileobj=io.BytesIO(bytes.fromhex(output))) as archive:
            self.assertEqual(set(archive.getnames()), {f"etc/config/{name}" for name in ("network", "dhcp", "rpcd")})

    def test_archive_rejects_traversal_absolute_paths_duplicates_and_special_members(self):
        for name, kind in [("../evil", tarfile.REGTYPE), ("/etc/evil", tarfile.REGTYPE),
                           ("etc/../evil", tarfile.REGTYPE), ("etc/./evil", tarfile.REGTYPE),
                           ("etc/config/network", tarfile.REGTYPE), ("etc/link", tarfile.SYMTYPE),
                           ("etc/hardlink", tarfile.LNKTYPE), ("etc/device", tarfile.CHRTYPE)]:
            with self.subTest(name=name, kind=kind):
                self.assertEqual(self.inspect(fixture([(name, b"", kind)])), "invalid_archive")

    def test_archive_rejects_checksum_truncation_trailing_data_and_mismatched_identity(self):
        valid = fixture()
        invalid = bytearray(valid)
        invalid[20] = 88
        for data in (bytes(invalid), valid[:1000], valid + b"X" * 512, valid[:512]):
            self.assertEqual(self.inspect(data), "invalid_archive")
        for field in IDENTITY:
            identity = dict(IDENTITY, **{field: "wrong"})
            self.assertEqual(self.inspect(fixture(identity=identity)), "archive_mismatch")

    def test_sealed_member_has_a_valid_tar_header(self):
        output = self.run_ucode("print(hexenc(member('router-ui-backup.json', '{}') + nulpad('', 1024)));")
        with tarfile.open(fileobj=io.BytesIO(bytes.fromhex(output))) as archive:
            self.assertEqual(archive.extractfile("router-ui-backup.json").read(), b"{}")


if __name__ == "__main__":
    unittest.main()
