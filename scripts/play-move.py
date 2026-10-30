#!/usr/bin/env python3
"""Drive one real swap through agent-browser and capture the motif window.

Usage: python3 scripts/play-move.py [out-prefix] [delay-seconds]
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from typing import Any

SESSION = os.environ.get("AGENT_BROWSER_SESSION", "pixelcascade")
# Repo-local output dir; never a shared /tmp path.
DEFAULT_OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".artifacts", "motif")
OUT = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT
DELAY = float(sys.argv[2]) if len(sys.argv) > 2 else 2.2


def ab(*args: str, capture: bool = False) -> str:
    env = dict(os.environ, AGENT_BROWSER_SESSION=SESSION)
    result = subprocess.run(["agent-browser", *args], env=env, capture_output=capture, text=True)
    return result.stdout if capture else ""


def evaljs(expr: str) -> Any:
    """Evaluate JS in the page and decode agent-browser's quoted JSON reply.

    agent-browser evaluates in one persistent global scope shared across
    commands, so every expression is wrapped in an IIFE — a leaked `const` from
    an earlier call otherwise fails the whole eval with a SyntaxError.

    An empty reply means the expression produced null/undefined, which is a
    legitimate `None` rather than a failure.
    """
    wrapped = f"(()=>{{return ({expr})}})()"
    raw = ab("eval", wrapped, capture=True).strip()
    if not raw:
        return None
    # agent-browser pretty-prints objects/arrays across lines, so parse the
    # whole reply rather than the last line only.
    if raw.startswith('"') and raw.endswith('"'):
        raw = bytes(raw[1:-1], "utf-8").decode("unicode_escape")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as err:
        raise RuntimeError(f"agent-browser returned non-JSON for {expr!r}: {raw[:120]!r}") from err


def require(value: Any, label: str) -> Any:
    if value is None:
        raise RuntimeError(f"missing value for {label}")
    return value


def main() -> int:
    if evaljs("window.__pixelCascade == null") is True:
        raise RuntimeError("window.__pixelCascade is not present — is the game loaded?")

    hint = require(evaljs("window.__pixelCascade.hint()"), "hint")
    if not hint:
        print("board has no legal move:", evaljs("JSON.stringify(window.__pixelCascade.state)"))
        return 1

    a = require(evaljs(f"window.__pixelCascade.cellCenterClient({json.dumps(hint[0])})"), "cell A")
    b = require(evaljs(f"window.__pixelCascade.cellCenterClient({json.dumps(hint[1])})"), "cell B")
    print(f"swap {hint[0]} -> {hint[1]}   ({a['x']:.0f},{a['y']:.0f}) -> ({b['x']:.0f},{b['y']:.0f})")

    def drag(x: float, y: float) -> None:
        ab("mouse", "move", str(int(x)), str(int(y)))

    drag(a["x"], a["y"])
    ab("mouse", "down")
    drag((a["x"] + b["x"]) / 2, (a["y"] + b["y"]) / 2)
    drag(b["x"], b["y"])
    ab("mouse", "up")

    time.sleep(DELAY)
    try:
        os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
    except OSError as err:
        raise RuntimeError(f"cannot create output directory for {OUT!r}") from err
    for i in range(6):
        ab("screenshot", f"{OUT}-{i}.png")
        time.sleep(0.18)

    print("state:", evaljs("JSON.stringify(window.__pixelCascade.state)"))
    print(f"saved {OUT}-0..5.png")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
