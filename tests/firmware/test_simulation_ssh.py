"""SSH 只重试确定尚未执行远程命令的握手故障，不能重放未知结果的写操作。"""

import io
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import call, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import simulation


class SimulationSshTests(unittest.TestCase):
    address = "192.168.68.1"
    command = "uci set system.@system[0].hostname=router-restore-probe && uci commit system"

    def failure(self, stderr, code=255, stdout=""):
        return subprocess.CalledProcessError(code, ["ssh"], output=stdout, stderr=stderr)

    def test_reboot_handshake_reset_is_retried_with_identical_command_and_options(self):
        error = self.failure("kex_exchange_identification: read: Connection reset by peer\n")
        result = subprocess.CompletedProcess(["ssh"], 0, stdout="done", stderr="")
        with patch.object(simulation, "run", side_effect=[error, result]) as run, patch.object(simulation.time, "sleep") as sleep:
            actual = simulation.ssh(self.address, self.command, capture_output=True, timeout=8, input="unchanged\n")
        self.assertIs(actual, result)
        self.assertEqual(run.call_args_list[0], run.call_args_list[1])
        self.assertEqual(run.call_args.args[-2:], ("root@" + self.address, self.command))
        self.assertEqual(run.call_args.kwargs, {"capture_output": True, "timeout": 8, "input": "unchanged\n"})
        sleep.assert_called_once_with(0.5)

    def test_only_known_connect_and_kex_messages_are_eligible(self):
        messages = [
            "kex_exchange_identification: Connection closed by remote host\n",
            "kex_exchange_identification: read: Connection closed by remote host\n",
            "kex_exchange_identification: read: Connection reset by peer\nConnection reset by 192.168.68.1 port 22\n",
            "kex_exchange_identification: Connection closed by remote host\nConnection closed by 192.168.68.1 port 22\n",
            *[f"ssh: connect to host {self.address} port 22: {reason}\n" for reason in ("Connection refused", "No route to host", "Connection timed out")],
        ]
        for message in messages:
            with self.subTest(message=message), patch.object(simulation, "run", side_effect=[self.failure(message), subprocess.CompletedProcess([], 0)]) as run, patch.object(simulation.time, "sleep"):
                simulation.ssh(self.address, self.command, capture_output=True)
                self.assertEqual(run.call_count, 2)

    def test_three_attempt_limit_preserves_final_error(self):
        errors = [self.failure("kex_exchange_identification: read: Connection reset by peer\n") for _ in range(3)]
        with patch.object(simulation, "run", side_effect=errors) as run, patch.object(simulation.time, "sleep") as sleep:
            with self.assertRaises(subprocess.CalledProcessError) as raised:
                simulation.ssh(self.address, self.command, capture_output=True)
        self.assertIs(raised.exception, errors[-1])
        self.assertEqual(run.call_count, 3)
        self.assertEqual(sleep.call_args_list, [call(0.5), call(1.0)])

    def test_remote_errors_post_command_disconnect_and_mixed_output_are_not_replayed(self):
        errors = [
            self.failure("uci: Entry not found\n", code=1),
            self.failure("kex_exchange_identification: read: Connection reset by peer\n", code=1),
            self.failure("client_loop: send disconnect: Connection reset by peer\n"),
            self.failure("Connection to 192.168.68.1 closed by remote host.\n"),
            self.failure("Connection reset by peer\n"),
            self.failure("Permission denied (publickey).\n"),
            self.failure("ssh: connect to host 192.168.99.1 port 22: Connection refused\n"),
            self.failure("kex_exchange_identification: read: Connection reset by peer\nremote command failed\n"),
            self.failure("kex_exchange_identification: read: Connection reset by peer\n", stdout="command already ran\n"),
        ]
        for error in errors:
            with self.subTest(stderr=error.stderr, code=error.returncode, stdout=error.stdout), patch.object(simulation, "run", side_effect=error) as run, patch.object(simulation.time, "sleep") as sleep:
                with self.assertRaises(subprocess.CalledProcessError) as raised:
                    simulation.ssh(self.address, self.command, capture_output=True)
                self.assertIs(raised.exception, error)
                run.assert_called_once()
                sleep.assert_not_called()

    def test_streaming_without_captured_stderr_and_command_timeouts_are_not_replayed(self):
        for kwargs in ({}, {"stdout": io.StringIO(), "stderr": subprocess.STDOUT}):
            with self.subTest(kwargs=kwargs), patch.object(simulation, "run", side_effect=self.failure("kex_exchange_identification: read: Connection reset by peer\n")) as run, patch.object(simulation.time, "sleep") as sleep:
                with self.assertRaises(subprocess.CalledProcessError):
                    simulation.ssh(self.address, self.command, **kwargs)
                run.assert_called_once()
                sleep.assert_not_called()
        error = subprocess.TimeoutExpired(["ssh"], 8, stderr="kex_exchange_identification: read: Connection reset by peer\n")
        with patch.object(simulation, "run", side_effect=error) as run, patch.object(simulation.time, "sleep") as sleep:
            with self.assertRaises(subprocess.TimeoutExpired) as raised:
                simulation.ssh(self.address, self.command, capture_output=True, timeout=8)
            self.assertIs(raised.exception, error)
            run.assert_called_once()
            sleep.assert_not_called()

    def test_explicit_stderr_pipe_preserves_stream_handles_and_success_is_not_retried(self):
        source, destination = io.BytesIO(b"upload"), io.StringIO()
        result = subprocess.CompletedProcess([], 0)
        error = self.failure(f"ssh: connect to host {self.address} port 22: Connection refused\n")
        with patch.object(simulation, "run", side_effect=[error, result]) as run, patch.object(simulation.time, "sleep"):
            self.assertIs(simulation.ssh(self.address, self.command, stdin=source, stdout=destination, stderr=subprocess.PIPE), result)
            self.assertEqual(run.call_count, 2)
            self.assertEqual(run.call_args_list[0], run.call_args_list[1])
            self.assertIs(run.call_args.kwargs["stdin"], source)
            self.assertIs(run.call_args.kwargs["stdout"], destination)
        with patch.object(simulation, "run", return_value=result) as run, patch.object(simulation.time, "sleep") as sleep:
            self.assertIs(simulation.ssh(self.address, "true", capture_output=True), result)
            run.assert_called_once()
            sleep.assert_not_called()


if __name__ == "__main__":
    unittest.main()
