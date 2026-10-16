import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CONFIG_PATH = ROOT / 'packages/computer-player/config/experiment-v1.json'
CONFIG = json.loads(CONFIG_PATH.read_text())
CONFIG_SHA256 = hashlib.sha256(CONFIG_PATH.read_bytes()).hexdigest()
