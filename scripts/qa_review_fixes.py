"""Compatibility entry point for the offline Selar flow checks."""
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
subprocess.run(["node", "scripts/test_selar_flows.mjs"], cwd=root, check=True)