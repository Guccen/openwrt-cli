"""验证下载缓存摘要与编译缓存参数，不下载网络文件或编译真实固件。"""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class BuildCacheTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bash = shutil.which("bash") or "C:/Program Files/Git/bin/bash.exe"
        if not Path(cls.bash).is_file():
            raise unittest.SkipTest("需要 Bash 验证构建缓存")

    def download(self, payload, target, digest):
        return subprocess.run([self.bash, (ROOT / "scripts/download-verified.sh").as_posix(), payload.as_uri(), digest, target.as_posix()], capture_output=True, timeout=15)

    def test_valid_download_is_reused_without_reading_original_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            payload, target = root / "source.bin", root / "cache/kernel.bin"
            payload.write_bytes(b"verified-kernel")
            digest = hashlib.sha256(payload.read_bytes()).hexdigest()
            first = self.download(payload, target, digest)
            self.assertEqual(first.returncode, 0, first.stderr)
            payload.unlink()
            second = self.download(payload, target, digest)
            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertEqual(target.read_bytes(), b"verified-kernel")

    def test_corrupt_cache_is_replaced_only_after_download_passes_digest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            payload, target = root / "source.bin", root / "kernel.bin"
            payload.write_bytes(b"expected")
            digest = hashlib.sha256(payload.read_bytes()).hexdigest()
            target.write_bytes(b"corrupt")
            self.assertEqual(self.download(payload, target, digest).returncode, 0)
            self.assertEqual(target.read_bytes(), b"expected")
            target.write_bytes(b"keep-existing")
            payload.write_bytes(b"wrong-download")
            self.assertNotEqual(self.download(payload, target, digest).returncode, 0)
            self.assertEqual(target.read_bytes(), b"keep-existing")
            self.assertEqual(list(root.glob("kernel.bin.*")), [])

    def test_failed_download_never_leaves_a_file_that_looks_cached(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "cache/kernel.bin"
            self.assertNotEqual(self.download(root / "missing", target, "0" * 64).returncode, 0)
            self.assertFalse(target.exists())
            self.assertEqual(list(target.parent.iterdir()), [])

    def test_make_download_parallel_build_and_fallback_all_use_the_same_cache(self):
        for fail in (False, True):
            with self.subTest(fail=fail), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                scripts, binaries = root / "scripts", root / "bin"
                scripts.mkdir()
                binaries.mkdir()
                (root / "build").mkdir()
                (root / "build/ui-size.json").write_text("{}")
                shutil.copyfile(ROOT / "scripts/build-firmware.sh", scripts / "build-firmware.sh")
                (scripts / "configure-firmware.sh").write_text('mkdir -p "$(dirname "$0")/../build/openwrt"\n', newline="\n")
                (binaries / "make").write_text('''#!/bin/sh
printf '%s\\n' "$*" >> "$MAKE_LOG"
case "$*" in *-j4*) [ "$FAIL_PARALLEL" = 0 ] || exit 1 ;; esac
''', newline="\n")
                (binaries / "python3").write_text("#!/bin/sh\nexit 0\n", newline="\n")
                for file in binaries.iterdir(): file.chmod(0o755)
                log = root / "make.log"
                env = dict(os.environ, PATH=str(binaries) + os.pathsep + os.environ["PATH"], MAKE_LOG=log.as_posix(), FAIL_PARALLEL=str(int(fail)), BUILD_JOBS="4")
                result = subprocess.run([self.bash, (scripts / "build-firmware.sh").as_posix(), "phicomm-n1", "router"], env=env, capture_output=True, timeout=15)
                self.assertEqual(result.returncode, 0, result.stderr)
                calls = log.read_text().splitlines()
                self.assertEqual(len(calls), 3 if fail else 2)
                for call in calls:
                    self.assertIn("CONFIG_CCACHE=y", call)
                    self.assertIn("CONFIG_CCACHE_DIR=", call)
                    self.assertIn("/build/ccache", call)
                    self.assertNotIn("CONFIG_DEVEL", call)
                self.assertIn("download -j8", calls[0])
                if fail: self.assertIn("-j1 V=s", calls[-1])
