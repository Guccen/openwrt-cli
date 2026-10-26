import io
import json
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from collect_artifacts import collect


class ArtifactSelectionTests(unittest.TestCase):
    def fixture(self, root, role="bypass"):
        source = root / "source"
        target = source / "bin/targets/armsr/armv8"
        target.mkdir(parents=True)
        metadata = {"device": "phicomm-n1", "role": role, "revision": "a" * 40}
        (source / "files/www").mkdir(parents=True)
        (source / "files/www/device.json").write_text(json.dumps(metadata))
        package = source / "bin/packages/aarch64_generic/base"
        package.mkdir(parents=True)
        (package / "router-ui-0.4.0-r1.apk").write_bytes(b"package fixture")
        return source, target, metadata

    def rootfs(self, path, metadata):
        content = json.dumps(metadata).encode()
        with tarfile.open(path, "w:gz") as archive:
            entry = tarfile.TarInfo("./www/device.json")
            entry.size = len(content)
            archive.addfile(entry, io.BytesIO(content))

    def test_target_and_device_archives_can_coexist(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source, target, metadata = self.fixture(root)
            self.rootfs(target / "immortalwrt-armsr-armv8-rootfs.tar.gz", metadata)
            selected = target / "immortalwrt-armsr-armv8-generic-rootfs.tar.gz"
            self.rootfs(selected, metadata)
            collect(source, root / "output", "phicomm-n1")
            self.assertEqual(list((root / "output").glob("*rootfs.tar.gz")), [root / "output" / selected.name])
            self.assertEqual(len(json.loads((root / "output/target-files.json").read_text())), 2)

    def test_missing_or_ambiguous_device_archive_keeps_diagnostics(self):
        for count in (0, 2):
            with self.subTest(count=count), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                source, target, metadata = self.fixture(root)
                self.rootfs(target / "immortalwrt-armsr-armv8-rootfs.tar.gz", metadata)
                for index in range(count):
                    self.rootfs(target / f"build-{index}-generic-rootfs.tar.gz", metadata)
                with self.assertRaises(ValueError):
                    collect(source, root / "output", "phicomm-n1")
                self.assertTrue((root / "output/target-files.json").is_file())
                self.assertEqual(list((root / "output").glob("*rootfs.tar.gz")), [])

    def test_archive_metadata_must_match_the_requested_mode(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source, target, metadata = self.fixture(root)
            self.rootfs(target / "immortalwrt-armsr-armv8-generic-rootfs.tar.gz", {**metadata, "role": "router"})
            with self.assertRaisesRegex(ValueError, "模式"):
                collect(source, root / "output", "phicomm-n1")


if __name__ == "__main__":
    unittest.main()
