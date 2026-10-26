import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import qemu_host


class QemuHostTests(unittest.TestCase):
    def test_missing_rom_is_reported_before_downloading_or_booting_an_image(self):
        process = MagicMock(returncode=1)
        process.communicate.return_value = ('failed to find romfile "efi-virtio.rom"', None)
        process.poll.return_value = 1
        with patch.object(qemu_host.subprocess, "Popen", return_value=process):
            with self.assertRaisesRegex(RuntimeError, "efi-virtio.rom"):
                qemu_host.check_host()
        process.terminate.assert_not_called()

    def test_running_smoke_guest_is_terminated_after_success(self):
        process = MagicMock()
        process.communicate.side_effect = [subprocess.TimeoutExpired("qemu", 1), ("", None)]
        process.poll.return_value = None
        with patch.object(qemu_host.subprocess, "Popen", return_value=process):
            qemu_host.check_host()
        process.terminate.assert_called_once()
        process.kill.assert_not_called()


if __name__ == "__main__":
    unittest.main()
