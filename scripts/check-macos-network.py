"""Validate the actual .app metadata before a macOS installer is published."""
import plistlib
import sys
from pathlib import Path


def check(path):
    info = path / "Contents/Info.plist" if path.suffix == ".app" else path
    with info.open("rb") as stream:
        metadata = plistlib.load(stream)
    description = metadata.get("NSLocalNetworkUsageDescription")
    if not isinstance(description, str) or not description.strip():
        raise ValueError(f"Missing NSLocalNetworkUsageDescription in {info}")
    print(f"Local network usage declaration verified: {info}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python3 scripts/check-macos-network.py <app-or-plist>")
    check(Path(sys.argv[1]))
