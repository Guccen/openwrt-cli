"""验证首次启动扩容的布局限制和失败恢复，不接触任何真实块设备。"""

import copy
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import firmware
import n1_storage


class N1StorageSourceTests(unittest.TestCase):
    def test_only_n1_gets_tools_and_first_boot_entry(self):
        for device in firmware.DEVICES:
            with self.subTest(device=device), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                firmware.overlay(root, device, "router")
                self.assertEqual((root / "etc/uci-defaults/00-router-ui-storage").exists(), device == "phicomm-n1")
                config = firmware.merge_config(device, "router")
                for package in ("sfdisk", "partx-utils", "blockdev", "btrfs-progs"):
                    self.assertEqual(f"CONFIG_PACKAGE_{package}=y" in config, device == "phicomm-n1")

    def test_external_kernel_dependency_patch_is_narrow_and_rejects_drift(self):
        original = "PKG_VERSION:=6.11\nPKG_RELEASE:=3\nDEPENDS:= \\\n    +libattr \\\n    +kmod-fs-btrfs \\\n    +libzstd\n"
        for text in (original, original.replace("6.11", "6.12"), original.replace("+kmod-fs-btrfs", "+other-kernel")):
            with self.subTest(text=text), tempfile.TemporaryDirectory() as temp:
                source = Path(temp)
                target = source / "feeds/packages/utils/btrfs-progs/Makefile"
                target.parent.mkdir(parents=True)
                target.write_text(text, encoding="utf-8", newline="\n")
                if text != original:
                    with self.assertRaises(ValueError): n1_storage.prepare(source)
                    self.assertEqual(target.read_text(), text)
                else:
                    metadata = n1_storage.prepare(source)
                    self.assertEqual(metadata["version"], "6.11-r4")
                    self.assertEqual(target.read_text(), original.replace("    +kmod-fs-btrfs \\\n", "").replace("PKG_RELEASE:=3", "PKG_RELEASE:=4"))


class N1StoragePlannerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.command = shlex.split(os.environ.get("UCODE_TEST_COMMAND", "")) or ([shutil.which("ucode")] if shutil.which("ucode") else [])
        if not cls.command: raise unittest.SkipTest("需要真实 ucode")

    def setUp(self):
        self.state = {"device": "phicomm-n1", "filesystem": "btrfs", "usb": True, "sectorSize": 512, "root": "/dev/sda2", "sectors": 30218842, "start": 532480, "size": 2097152}
        self.table = {"partitiontable": {"label": "dos", "device": "/dev/sda", "unit": "sectors", "sectorsize": 512, "partitions": [
            {"node": "/dev/sda1", "start": 8192, "size": 522240, "type": "c"},
            {"node": "/dev/sda2", "start": 532480, "size": 2097152, "type": "83"},
        ]}}

    def plan(self, table, state):
        code = (ROOT / "files/n1/usr/libexec/router-ui/n1-storage.uc").read_text(encoding="utf-8").split("\ntry {")[0]
        result = subprocess.run([*self.command, "-e", code + f"print(plan({json.dumps(table)}, {json.dumps(state)}));"], capture_output=True, encoding="utf-8", timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_grow_preserves_start_and_retries_filesystem_after_partition_grew(self):
        result = self.plan(self.table, self.state)
        self.assertTrue(result["ok"])
        self.assertTrue(result["grow"])
        self.assertEqual(result["start"], 532480)
        self.assertEqual(result["size"], 29686362)
        self.state["size"] = result["size"]
        self.table["partitiontable"]["partitions"][1]["size"] = result["size"]
        result = self.plan(self.table, self.state)
        self.assertTrue(result["ok"])
        self.assertFalse(result["grow"])

    def test_rejects_emmc_wrong_device_geometry_filesystem_and_untrusted_paths(self):
        for key, value in [("root", "/dev/mmcblk2p2"), ("device", "jdcloud-ax1800"), ("usb", False), ("filesystem", "ext4"), ("sectorSize", 4096), ("sectors", 2**32), ("sectors", 100), ("start", 532481), ("size", 1), ("root", "/dev/sda2;reboot")]:
            with self.subTest(key=key, value=value):
                state = dict(self.state, **{key: value})
                self.assertFalse(self.plan(self.table, state)["ok"])

    def test_rejects_extra_partitions_altered_boot_and_unsupported_tables(self):
        tables = [None, {}, copy.deepcopy(self.table), copy.deepcopy(self.table), copy.deepcopy(self.table), copy.deepcopy(self.table)]
        tables[2]["partitiontable"]["partitions"].append({"node": "/dev/sda3", "start": 3000000, "size": 1000, "type": "83"})
        tables[3]["partitiontable"]["partitions"][0]["start"] = 2048
        tables[4]["partitiontable"]["label"] = "gpt"
        tables[5]["partitiontable"]["partitions"][1]["size"] = 999999999
        for table in tables:
            with self.subTest(table=table): self.assertFalse(self.plan(table, self.state)["ok"])


class N1StorageShellTests(unittest.TestCase):
    def run_expansion(self, mode):
        bash = shutil.which("bash") or ("C:/Program Files/Git/bin/bash.exe" if Path("C:/Program Files/Git/bin/bash.exe").is_file() else None)
        if not bash: self.skipTest("需要 Bash")
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            for name in ("bin", "block/sda", "block/sda2", "backup"):
                (root / name).mkdir(parents=True)
            for name, value in {"sda/size": 30218842, "sda2/start": 532480, "sda2/size": 29686362 if mode == "retry" else 2097152}.items():
                (root / "block" / name).write_text(str(value))
            (root / "mounts").write_text("/dev/sda2 / btrfs rw,noatime 0 0\n")
            text = (ROOT / "files/n1/usr/libexec/router-ui/expand-rootfs").read_text(encoding="utf-8")
            # 测试只用临时普通文件和命令替身，宿主块设备永不参与。
            text = text.replace('[ -b "$root" ] && [ -b "$disk" ]', "true")
            for old, new in [("/sys/class/block", "/block"), ("/proc/mounts", "/mounts"), ("/var/lock", "/lock"), ("/tmp/router-ui-expand", "/work"), ("/root/router-ui-storage-backup", "/backup/saved")]:
                text = text.replace(old, root.as_posix() + new)
            script = root / "expand.sh"
            script.write_text(text, encoding="utf-8", newline="\n")
            mocks = {
                "logger": 'printf "%s\\n" "$*" >> "$TEST_ROOT/messages"',
                "readlink": 'printf "/devices/platform/usb1/1-1/block/sda\\n"',
                "jsonfilter": '''case "$4" in
                    '@.device') echo phicomm-n1 ;;
                    '@.ok') echo true ;;
                    '@.size') echo 29686362 ;;
                    '@.grow') if [ "$TEST_MODE" = retry ]; then echo false; else echo true; fi ;;
                esac''',
                "ucode": 'echo "{}"',
                "blockdev": 'if [ "$1" = --getss ]; then echo 512; else cat "$TEST_ROOT/block/sda2/size"; fi',
                "btrfs": '''if [ "$2" = show ]; then
                    if [ "$TEST_MODE" = multi ]; then echo 'Total devices 2 FS bytes used 1'; else echo 'Total devices 1 FS bytes used 1'; fi
                    echo 'devid 1 size 1024 used 10 path /dev/sda2'
                else
                    echo "btrfs $*" >> "$TEST_ROOT/operations"
                    [ "$TEST_MODE" != retry ]
                fi''',
                "sfdisk": '''case "$1" in
                    --json) echo '{}' ;;
                    --dump) echo 'label: dos' ;;
                    --no-act) echo dry-run >> "$TEST_ROOT/operations"; [ "$TEST_MODE" != dry-failure ] ;;
                    *) echo partition-write >> "$TEST_ROOT/operations" ;;
                esac''',
                "partx": '''echo partx >> "$TEST_ROOT/operations"
                    [ "$TEST_MODE" != kernel-failure ] || exit 1
                    echo 29686362 > "$TEST_ROOT/block/sda2/size"''',
                "dd": '''for arg in "$@"; do case "$arg" in of=*) output=${arg#of=} ;; esac; done
                    [ "$TEST_MODE" != backup-failure ] || return 1
                    head -c 4194304 /dev/zero > "$output"''',
                "sync": ":",
            }
            functions = "\n".join(f"{name}() {{\n{body}\n}}" for name, body in mocks.items())
            script.write_text(functions + "\n" + text, encoding="utf-8", newline="\n")
            env = dict(os.environ, TEST_ROOT=root.as_posix(), TEST_MODE=mode)
            env["PATH"] = str(root / "bin") + os.pathsep + env["PATH"]
            result = subprocess.run([bash, script.as_posix()], env=env, capture_output=True, text=True, timeout=20)
            if (root / "messages").exists(): result.stderr += (root / "messages").read_text(encoding="utf-8")
            operations = (root / "operations").read_text() if (root / "operations").exists() else ""
            self.assertFalse((root / "lock/router-ui-rootfs-expand").exists())
            return result, operations

    def test_grow_runs_backup_dry_run_partition_update_then_filesystem(self):
        result, operations = self.run_expansion("grow")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(operations.splitlines(), ["dry-run", "partition-write", "partx", "btrfs filesystem resize max /"], result.stderr)

    def test_failures_stop_before_next_mutation_and_retry_never_shrinks(self):
        for mode, expected in [("backup-failure", []), ("dry-failure", ["dry-run"]), ("kernel-failure", ["dry-run", "partition-write", "partx"]), ("retry", ["btrfs filesystem resize max /"])]:
            with self.subTest(mode=mode):
                result, operations = self.run_expansion(mode)
                self.assertNotEqual(result.returncode, 0, result.stderr)
                self.assertEqual(operations.splitlines(), expected)

    def test_multi_device_btrfs_is_skipped_without_writes(self):
        result, operations = self.run_expansion("multi")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(operations, "")
