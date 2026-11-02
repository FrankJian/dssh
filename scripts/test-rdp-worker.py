"""Offline native-worker boundary tests. No real credentials or Windows required."""
import hashlib
import os
import queue
import shutil
from pathlib import Path
import socket
import ssl
import struct
import subprocess
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]
BINARY = Path(os.environ["DSSH_RDP_WORKER"]) if "DSSH_RDP_WORKER" in os.environ else ROOT / "src-tauri/rdp-runtime" / ("dssh-rdp-client.exe" if os.name == "nt" else "dssh-rdp-client")


def packet(arguments):
    encoded = [argument.encode("utf-8") for argument in arguments]
    return struct.pack(">I", len(encoded)) + b"".join(struct.pack(">I", len(value)) + value for value in encoded)


class WorkerTests(unittest.TestCase):
    def test_crypto_works_without_developer_openssl_installation(self):
        with tempfile.TemporaryDirectory(prefix="dssh-rdp-relocated-") as directory:
            runtime = Path(directory) / "runtime"
            shutil.copytree(BINARY.parent, runtime)
            env = {key: value for key, value in os.environ.items() if key.upper() in {"HOME", "USERPROFILE", "SYSTEMROOT", "WINDIR", "TEMP", "TMP"}}
            env["OPENSSL_MODULES"] = str(Path(directory) / "no-provider-modules")
            env["OPENSSL_CONF"] = str(Path(directory) / "no-config.cnf")
            result = subprocess.run([str(runtime / BINARY.name), "--dssh-crypto-self-test"], env=env,
                                    capture_output=True, text=True, timeout=10,
                                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            self.assertEqual(result.returncode, 0, f"Relocated NTLM crypto self-test failed: {result.stdout.strip()}")
            self.assertEqual(result.stdout.strip(), "DSSH_RDP_V1 crypto-ok")

    def spawn(self, env=None, binary=None, cwd=None):
        process = subprocess.Popen([str(binary or BINARY), "--dssh-worker-v1"], stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env, cwd=cwd,
                                   creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        self.addCleanup(self.cleanup, process)
        ready = queue.Queue()
        threading.Thread(target=lambda: ready.put(process.stdout.readline(256)), daemon=True).start()
        self.assertEqual(ready.get(timeout=5).strip(), b"DSSH_RDP_V1 ready")
        return process

    def test_relocated_startup_reaches_connect_with_production_environment(self):
        # Exercise context construction too: the crypto-only probe never gets there.
        # Use a Unicode install path, no developer environment and no Windows console.
        with tempfile.TemporaryDirectory(prefix="dssh-rdp-startup-") as directory:
            runtime = Path(directory) / "安装目录 空格" / "runtime"
            shutil.copytree(BINARY.parent, runtime)
            env = {key: value for key, value in os.environ.items() if key.upper() in {
                "HOME", "USERPROFILE", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LANG", "LC_CTYPE"}}
            env["OPENSSL_MODULES"] = str(Path(directory) / "no-provider-modules")
            env["OPENSSL_CONF"] = str(Path(directory) / "no-config.cnf")
            process = self.spawn(env, runtime / BINARY.name, directory)
            process.stdin.write(packet(["/v:127.0.0.1:9", "/u:test-only", "/p:test-only",
                                        "/sec:nla", "/cert:ignore", "/log-level:OFF", "/timeout:1500",
                                        "-auto-reconnect", "-clipboard"]))
            process.stdin.flush()
            code = process.wait(timeout=15)
            output = process.stdout.read(8192).decode("ascii", errors="replace")
            # Only our fixed/numeric protocol lines are reported on failure.
            diagnostics = [line for line in output.splitlines() if line.startswith("DSSH_RDP_V1 ")]
            self.assertIn("DSSH_RDP_V1 stage connect", diagnostics,
                          f"Relocated startup exited {code}: {diagnostics}")
            self.assertNotEqual(code, 3, diagnostics)

    @staticmethod
    def cleanup(process):
        if process.poll() is None:
            process.kill()
        process.wait(timeout=5)
        for stream in [process.stdin, process.stdout]:
            if stream and not stream.closed:
                stream.close()

    def test_parent_death_before_credentials_exits(self):
        process = self.spawn()
        process.stdin.close()
        self.assertEqual(process.wait(timeout=5), 120)

    def test_oversized_payload_is_rejected(self):
        process = self.spawn()
        process.stdin.write(struct.pack(">II", 1, 65536))
        process.stdin.flush()
        self.assertEqual(process.wait(timeout=5), 120)

    def test_parent_death_during_connection_exits(self):
        process = self.spawn()
        process.stdin.write(packet(["/v:127.0.0.1:9", "/u:test-only", "/p:test-only", "/sec:nla", "/cert:deny", "/log-level:OFF"]))
        process.stdin.flush()
        process.stdin.close()
        self.assertEqual(process.wait(timeout=5), 0)

    @unittest.skipUnless(shutil.which("openssl"), "Requires openssl CLI")
    def test_certificate_policies_and_explicit_skip(self):
        with tempfile.TemporaryDirectory(prefix="dssh-rdp-tls-") as directory:
            key, cert = Path(directory) / "key.pem", Path(directory) / "cert.pem"
            subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                            "-keyout", str(key), "-out", str(cert), "-subj", "/CN=localhost"],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            der = ssl.PEM_cert_to_DER_cert(cert.read_text())
            fingerprint = hashlib.sha256(der).hexdigest()
            # Correct pin / explicit skip reach CredSSP; strict modes reject unknown certificates.
            for option, expected_auth in [(f"/cert:fingerprint:sha256:{fingerprint}", True),
                                          ("/cert:fingerprint:sha256:" + "00" * 32, False),
                                          ("/cert:deny", False), ("/cert:ignore", True)]:
                with self.subTest(policy=option[:25]):
                    listener = socket.socket()
                    self.addCleanup(listener.close)
                    listener.bind(("127.0.0.1", 0))
                    listener.listen(1)
                    listener.settimeout(10)
                    received = []
                    failures = []

                    def server():
                        try:
                            connection, _ = listener.accept()
                            with connection:
                                connection.settimeout(5)
                                connection.recv(4096)
                                # X.224 Connection Confirm selects HYBRID (TLS + CredSSP/NLA).
                                connection.sendall(bytes.fromhex("030000130ed000000000000200080002000000"))
                                context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
                                context.load_cert_chain(cert, key)
                                try:
                                    with context.wrap_socket(connection, server_side=True) as tls:
                                        received.append(tls.recv(8192))
                                except (ssl.SSLError, ConnectionError, TimeoutError):
                                    received.append(b"")
                        except Exception as error:
                            failures.append(type(error).__name__)

                    thread = threading.Thread(target=server, daemon=True)
                    thread.start()
                    env = os.environ.copy()
                    # The wrong-pin case has an explicitly trusted, name-matching cert.
                    # It must still fail, proving that pin mismatches never fall back to CA trust.
                    env["SSL_CERT_FILE"] = str(cert) if "00" * 32 in option else str(Path(directory) / "no-ca.pem")
                    process = self.spawn(env)
                    name = "/cert:name:wrong.example" if option == "/cert:ignore" else "/cert:name:localhost"
                    process.stdin.write(packet([f"/v:127.0.0.1:{listener.getsockname()[1]}", "/u:test-only", "/p:test-only",
                                                "/sec:nla", name, option, "/log-level:OFF", "-auto-reconnect", "-clipboard"]))
                    process.stdin.flush()
                    thread.join(timeout=12)
                    listener.close()
                    self.assertFalse(thread.is_alive(), "RDP TLS probe did not finish")
                    self.assertFalse(failures, failures)
                    self.assertEqual(bool(received and received[0]), expected_auth)
                    self.cleanup(process)


if __name__ == "__main__":
    unittest.main()
