import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import simulation


class SimulationIsolationTests(unittest.TestCase):
    def preflight_result(self, links, namespaces=""):
        return [
            subprocess.CompletedProcess([], 0, stdout=json.dumps(links)),
            subprocess.CompletedProcess([], 0, stdout=namespaces),
        ]

    def test_refuse_existing_network_resources_without_mutation(self):
        for name in (simulation.BRIDGE, simulation.TAP, "router-ci-host", "router-ci-peer"):
            with self.subTest(name=name), patch.object(simulation, "run", side_effect=self.preflight_result([{"ifname": name}])) as run:
                with self.assertRaises(ValueError):
                    simulation.network_preflight("192.168.68.1")
                self.assertFalse(any("sudo" in call.args for call in run.call_args_list))
        with patch.object(simulation, "run", side_effect=self.preflight_result([], simulation.NAMESPACE + " (id: 1)\n")):
            with self.assertRaises(ValueError):
                simulation.network_preflight("192.168.68.1")

    def test_refuse_subnet_overlap_with_real_lan(self):
        links = [{"ifname": "eth0", "addr_info": [{"family": "inet", "local": "192.168.68.50", "prefixlen": 24}]}]
        with patch.object(simulation, "run", side_effect=self.preflight_result(links)):
            with self.assertRaisesRegex(ValueError, "192.168.68.0/24"):
                simulation.network_preflight("192.168.68.2")
        links[0]["addr_info"][0]["local"] = "172.31.0.2"
        with patch.object(simulation, "run", side_effect=self.preflight_result(links)):
            simulation.network_preflight("192.168.68.2")

    def test_broken_dhcp_client_is_not_a_passing_bypass_test(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            with patch.object(simulation, "WORK", directory), patch.object(simulation, "REPORT", directory), patch.object(simulation.subprocess, "run", return_value=subprocess.CompletedProcess([], 127)), patch.object(simulation, "run") as run:
                with self.assertRaises(AssertionError):
                    simulation.test_network("bypass", "192.168.68.2")
                run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
