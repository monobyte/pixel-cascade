#!/usr/bin/env python3
"""Autoplay the current level through agent-browser and capture the outcome.

Drives the real swap path (Game.playHint) until the level ends, then reports
the overlay so the win / lose branches can be verified in a browser.

Usage: python3 scripts/playthrough.py [batch-size]
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from typing import Any

SESSION = os.environ.get("AGENT_BROWSER_SESSION", "pixelcascade")
BATCH = int(sys.argv[1]) if len(sys.argv) > 1 else 5
MAX_BATCHES = int(sys.argv[2]) if len(sys.argv) > 2 else 12
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Repo-local output dir by default; never a shared world-writable /tmp path.
SHOT_DIR = os.environ.get("SHOT_DIR", os.path.join(REPO_ROOT, ".artifacts"))


def ab(*args: str, capture: bool = False) -> str:
    env = dict(os.environ, AGENT_BROWSER_SESSION=SESSION)
    result = subprocess.run(["agent-browser", *args], env=env, capture_output=capture, text=True)
    return result.stdout if capture else ""


def evaljs(expr: str) -> Any:
    """Evaluate an expression in the page.

    agent-browser keeps one persistent global scope across commands, so the
    expression is wrapped in an IIFE to avoid leaking bindings. Empty output
    means null/undefined.
    """
    wrapped = f"(()=>{{return ({expr})}})()"
    raw = ab("eval", wrapped, capture=True).strip()
    if not raw:
        return None
    if raw.startswith('"') and raw.endswith('"'):
        raw = bytes(raw[1:-1], "utf-8").decode("unicode_escape")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as err:
        raise RuntimeError(f"non-JSON reply for {expr!r}: {raw[:160]!r}") from err


AUTOPLAY = f"""
(async () => {{
  const g = window.__pixelCascade;
  const overlay = document.getElementById('overlay');
  for (let i = 0; i < {BATCH}; i++) {{
    if (!overlay.hidden) break;
    await g.waitIdle();
    if (!await g.playHint()) break;
    await g.waitIdle();
  }}
  return JSON.stringify({{
    state: g.state,
    open: !overlay.hidden,
    title: document.getElementById('overlay-title').textContent,
    eyebrow: document.getElementById('overlay-eyebrow').textContent,
    goals: [...document.querySelectorAll('#goals .goal')].map(
      (el) => el.textContent.replace(/\\s+/g, ' ').trim()),
  }});
}})()
"""


def main() -> int:
    os.makedirs(SHOT_DIR, exist_ok=True)
    if evaljs("window.__pixelCascade == null") is not False:
        raise RuntimeError("game not loaded at #stage")

    last: Any = None
    for batch in range(MAX_BATCHES):
        last = evaljs(AUTOPLAY)
        if last is None:
            print("autoplay eval returned nothing; aborting")
            return 1
        print(f"batch {batch + 1}: {last['state']}  goals={last['goals']}")
        if last["open"]:
            break
        time.sleep(0.4)

    print("\n=== overlay ===")
    print("eyebrow:", last.get("eyebrow"))
    print("title  :", last.get("title"))

    name = "overlay-outcome"
    ab("screenshot", f"{SHOT_DIR}/{name}.png")
    detail = evaljs(
        "[...document.querySelectorAll('#overlay-detail li')].map("
        "el => el.textContent.replace(/\\s+/g,' ').trim())"
    )
    stars = evaljs(
        "document.querySelectorAll('#overlay-detail .stars span.on').length"
    )
    actions = evaljs(
        "[...document.querySelectorAll('#overlay-actions button')].map(b => b.textContent)"
    )
    print("stars  :", stars)
    print("results:", detail)
    print("actions:", actions)
    print("shot   :", f"{SHOT_DIR}/{name}.png")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
