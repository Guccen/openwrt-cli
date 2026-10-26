import importlib.util
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

runtime = Path(__file__).resolve().parents[1] / "runtime"
sys.path.insert(0, str(runtime))
spec = importlib.util.spec_from_file_location("routing_runtime", runtime / "routing.py")
routing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(routing)


class RoutingReloadTests(unittest.TestCase):
    def test_generated_config_does_not_mean_old_dhcp_daemon_has_reloaded(self):
        config = "dhcp-range=set:lan,192.168.69.50,192.168.69.79,255.255.255.0,5m\n"
        responses = [config, "123\n", config, "", config, "456\n"]
        with patch.object(routing, "ssh", side_effect=[subprocess.CompletedProcess([], 0, stdout=value) for value in responses]) as ssh, patch.object(routing.time, "sleep"):
            routing.wait_pool("192.168.69.1", "192.168.69.50", "192.168.69.79", {"123"})
        self.assertEqual(ssh.call_count, 6)


if __name__ == "__main__":
    unittest.main()
