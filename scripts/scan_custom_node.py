from __future__ import annotations

import ast
import importlib.util
import os
import re
import sys
import types
import uuid
from multiprocessing import get_context
from queue import Empty
from typing import Any, Dict, List, Optional, Tuple

DYNAMIC_TIMEOUT_SECONDS = 5

URL_RE = re.compile(r"https?://[^\s'\"\\)]+", re.IGNORECASE)
IP_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
BASE64_RE = re.compile(r"(?:[A-Za-z0-9+/]{200,}={0,2})")
OBFUSCATED_VAR_RE = re.compile(r"^[ \t]*([A-Za-z_][A-Za-z0-9_]{29,})\s*=")
PIP_INSTALL_RE = re.compile(r"\bpip3?\s+install\b", re.IGNORECASE)
PIP_ARGS_RE = re.compile(r"^pip\d*$", re.IGNORECASE)

RISKY_IMPORTS = {
    "os": "LOW",
    "subprocess": "MEDIUM",
    "socket": "MEDIUM",
    "winreg": "MEDIUM",
    "ctypes": "MEDIUM",
    "requests": "LOW",
    "urllib": "LOW",
}

DANGEROUS_CALLS = {
    "eval": ("HIGH", "Uses eval() for dynamic code execution."),
    "exec": ("HIGH", "Uses exec() for dynamic code execution."),
    "os.system": ("HIGH", "Uses os.system() to execute shell commands."),
    "subprocess.Popen": ("HIGH", "Uses subprocess.Popen() to spawn a process."),
    "subprocess.run": ("MEDIUM", "Uses subprocess.run() to execute a process."),
    "subprocess.call": ("MEDIUM", "Uses subprocess.call() to execute a process."),
}

NETWORK_CALL_PREFIXES = {
    "requests.get",
    "requests.post",
    "requests.put",
    "requests.delete",
    "requests.request",
    "urllib.request.urlopen",
    "urllib.urlopen",
}

MALICIOUS_INDICATORS = [
    (re.compile(r"discord(app)?\.com/api/webhooks", re.IGNORECASE), "HIGH", "Discord webhook URL found."),
    (re.compile(r"stratum\+tcp://", re.IGNORECASE), "HIGH", "Possible mining pool (stratum) URL found."),
    (re.compile(r"\b(nicehash|nanopool|ethermine|minergate|supportxmr|f2pool|2miners|viabtc|slushpool)\b", re.IGNORECASE),
     "HIGH", "Known crypto-mining pool reference found."),
]

DANGEROUS_LINE_PATTERNS: Dict[re.Pattern[str], Tuple[str, str]] = {
    re.compile(r"\beval\s*\("): ("HIGH", "Uses eval() for dynamic code execution."),
    re.compile(r"\bexec\s*\("): ("HIGH", "Uses exec() for dynamic code execution."),
    re.compile(r"\bos\.system\s*\("): ("HIGH", "Uses os.system() to execute shell commands."),
    re.compile(r"\bsubprocess\.Popen\s*\("): ("HIGH", "Uses subprocess.Popen() to spawn a process."),
    re.compile(r"\bsubprocess\.(run|call)\s*\("): ("MEDIUM", "Uses subprocess to execute a process."),
}


def scan_custom_node(node_path: str) -> Dict[str, Any]:
    issues: List[Dict[str, str]] = []
    abs_path = os.path.abspath(node_path)

    if not os.path.isfile(abs_path):
        return {
            "file": abs_path,
            "issues": [{"severity": "HIGH", "detail": "Node path does not exist or is not a file."}],
            "secure": False,
        }

    try:
        with open(abs_path, "r", encoding="utf-8", errors="replace") as handle:
            source = handle.read()
    except OSError as exc:
        return {
            "file": abs_path,
            "issues": [{"severity": "HIGH", "detail": f"Failed to read file: {exc}"}],
            "secure": False,
        }

    issues.extend(_run_bandit(abs_path))
    issues.extend(_static_scan(source, abs_path))
    issues.extend(_run_dynamic_analysis(abs_path))

    secure = not any(issue["severity"] in {"HIGH", "MEDIUM"} for issue in issues)

    return {
        "file": abs_path,
        "issues": issues,
        "secure": secure,
    }


def _run_bandit(node_path: str) -> List[Dict[str, str]]:
    issues: List[Dict[str, str]] = []
    try:
        from bandit.core import config as bandit_config
        from bandit.core import manager as bandit_manager
    except Exception as exc:  # pragma: no cover - only hits when bandit is missing
        return [{
            "severity": "LOW",
            "detail": f"Bandit scan skipped: {exc}",
        }]

    try:
        b_conf = bandit_config.BanditConfig()
        b_mgr = bandit_manager.BanditManager(b_conf, "file", False)
        b_mgr.discover_files([node_path], recursive=False)
        b_mgr.run_tests()
        for issue in b_mgr.get_issue_list():
            detail = f"Bandit {issue.test_id}: {issue.text}"
            if issue.lineno:
                detail = f"{detail} (line {issue.lineno})"
            issues.append({"severity": issue.severity.upper(), "detail": detail})
    except Exception as exc:
        issues.append({"severity": "LOW", "detail": f"Bandit scan failed: {exc}"})

    return issues


def _static_scan(source: str, node_path: str) -> List[Dict[str, str]]:
    issues: List[Dict[str, str]] = []
    lines = source.splitlines()
    seen: set[Tuple[str, str]] = set()

    def add_issue(severity: str, detail: str, line: Optional[int] = None) -> None:
        if line is not None:
            detail = f"{detail} (line {line})"
        key = (severity, detail)
        if key in seen:
            return
        seen.add(key)
        issues.append({"severity": severity, "detail": detail})

    try:
        tree = ast.parse(source, filename=node_path)
    except SyntaxError as exc:
        add_issue("MEDIUM", f"Failed to parse Python AST: {exc.msg}", exc.lineno)
        tree = None

    if tree is not None:
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    module = alias.name.split(".")[0]
                    severity = RISKY_IMPORTS.get(module)
                    if severity:
                        add_issue(severity, f"Imports risky module '{module}'.", node.lineno)
            elif isinstance(node, ast.ImportFrom):
                if node.module:
                    module = node.module.split(".")[0]
                    severity = RISKY_IMPORTS.get(module)
                    if severity:
                        add_issue(severity, f"Imports risky module '{module}'.", node.lineno)
            elif isinstance(node, ast.Call):
                call_name = _full_name(node.func)
                if call_name in DANGEROUS_CALLS:
                    severity, message = DANGEROUS_CALLS[call_name]
                    add_issue(severity, message, node.lineno)
                if call_name in NETWORK_CALL_PREFIXES or call_name.startswith("urllib."):
                    add_issue("MEDIUM", f"Network call via '{call_name}'.", node.lineno)
                    urls = _extract_urls_from_call(node)
                    for url in urls:
                        add_issue("MEDIUM", f"Network call target appears in code: {url}.", node.lineno)
                if call_name in {"subprocess.run", "subprocess.call", "subprocess.Popen", "os.system"}:
                    if _call_invokes_pip(node):
                        add_issue("HIGH", "Invokes pip install at runtime.", node.lineno)

    for idx, line in enumerate(lines, start=1):
        if PIP_INSTALL_RE.search(line):
            add_issue("HIGH", "Contains 'pip install' invocation string.", idx)

        if BASE64_RE.search(line):
            add_issue("MEDIUM", "Large base64-like string found (possible obfuscation).", idx)

        obfuscated_match = OBFUSCATED_VAR_RE.search(line)
        if obfuscated_match and any(char.isdigit() for char in obfuscated_match.group(1)):
            add_issue("LOW", "Unusually long variable name with digits (possible obfuscation).", idx)

        for pattern, severity, message in MALICIOUS_INDICATORS:
            if pattern.search(line):
                add_issue(severity, message, idx)

        if "requests." in line or "urllib" in line:
            url_match = URL_RE.search(line)
            ip_match = IP_RE.search(line)
            if url_match:
                add_issue("MEDIUM", f"Hard-coded URL in network call: {url_match.group(0)}.", idx)
            if ip_match:
                add_issue("MEDIUM", f"Hard-coded IP in network call: {ip_match.group(0)}.", idx)

        for call_pattern, (severity, message) in DANGEROUS_LINE_PATTERNS.items():
            if call_pattern.search(line):
                add_issue(severity, message, idx)

    return issues


def _full_name(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = _full_name(node.value)
        if base:
            return f"{base}.{node.attr}"
        return node.attr
    return ""


def _extract_urls_from_call(node: ast.Call) -> List[str]:
    urls: List[str] = []
    for value in _extract_string_literals(node):
        if URL_RE.search(value):
            urls.append(value)
        elif IP_RE.search(value):
            urls.append(value)
    return urls


def _extract_string_literals(node: ast.AST) -> List[str]:
    literals: List[str] = []
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        literals.append(node.value)
    elif isinstance(node, ast.JoinedStr):
        for part in node.values:
            if isinstance(part, ast.Constant) and isinstance(part.value, str):
                literals.append(part.value)
    elif isinstance(node, (ast.List, ast.Tuple, ast.Set)):
        for elt in node.elts:
            literals.extend(_extract_string_literals(elt))
    elif isinstance(node, ast.Dict):
        for key, value in zip(node.keys, node.values):
            if key is not None:
                literals.extend(_extract_string_literals(key))
            if value is not None:
                literals.extend(_extract_string_literals(value))
    elif isinstance(node, ast.Call):
        for arg in node.args:
            literals.extend(_extract_string_literals(arg))
        for keyword in node.keywords:
            if keyword.value is not None:
                literals.extend(_extract_string_literals(keyword.value))
    return literals


def _call_invokes_pip(node: ast.Call) -> bool:
    values = [value.lower() for value in _extract_string_literals(node)]
    if "pip install" in " ".join(values):
        return True
    if any(PIP_ARGS_RE.match(value) for value in values) and "install" in values:
        return True
    return False


def _run_dynamic_analysis(node_path: str) -> List[Dict[str, str]]:
    issues: List[Dict[str, str]] = []
    ctx = get_context("spawn")
    queue = ctx.Queue()
    process = ctx.Process(target=_dynamic_import_worker, args=(node_path, queue))
    process.daemon = True
    process.start()
    process.join(DYNAMIC_TIMEOUT_SECONDS)

    if process.is_alive():
        process.terminate()
        process.join(1)
        issues.append({
            "severity": "HIGH",
            "detail": "Dynamic analysis timed out during module import.",
        })

    while True:
        try:
            entry = queue.get_nowait()
        except Empty:
            break
        else:
            issues.append(entry)

    return issues


def _dynamic_import_worker(node_path: str, queue: Any) -> None:
    def log(severity: str, detail: str) -> None:
        queue.put({"severity": severity, "detail": detail})

    class DummyProcess:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            self.args = args
            self.kwargs = kwargs
            self.returncode = 0

        def communicate(self, *args: Any, **kwargs: Any) -> Tuple[str, str]:
            return "", ""

        def wait(self, *args: Any, **kwargs: Any) -> int:
            return 0

        def poll(self) -> int:
            return 0

    def blocked_call(name: str, severity: str) -> Any:
        def _inner(*args: Any, **kwargs: Any) -> Any:
            log(severity, f"Runtime call blocked: {name} args={args} kwargs={kwargs}")
            return 0
        return _inner

    def blocked_popen(*args: Any, **kwargs: Any) -> DummyProcess:
        log("HIGH", f"Runtime call blocked: subprocess.Popen args={args} kwargs={kwargs}")
        return DummyProcess(*args, **kwargs)

    def blocked_run(*args: Any, **kwargs: Any) -> Any:
        log("HIGH", f"Runtime call blocked: subprocess.run args={args} kwargs={kwargs}")
        try:
            from subprocess import CompletedProcess
            return CompletedProcess(args=args, returncode=0, stdout="", stderr="")
        except Exception:
            return DummyProcess(*args, **kwargs)

    def blocked_call_proc(*args: Any, **kwargs: Any) -> int:
        log("HIGH", f"Runtime call blocked: subprocess.call args={args} kwargs={kwargs}")
        return 0

    def blocked_network(name: str) -> Any:
        def _inner(*args: Any, **kwargs: Any) -> Any:
            target = None
            if args:
                target = args[0]
            if target is None:
                target = kwargs.get("url")
            log("HIGH", f"Runtime network call blocked: {name} target={target}")
            return DummyResponse()
        return _inner

    class DummyResponse:
        status_code = 200
        text = ""

        def json(self) -> Dict[str, Any]:
            return {}

    class DummySession:
        def request(self, method: str, url: str, *args: Any, **kwargs: Any) -> DummyResponse:
            log("HIGH", f"Runtime network call blocked: requests.Session.{method} target={url}")
            return DummyResponse()

        def get(self, url: str, *args: Any, **kwargs: Any) -> DummyResponse:
            return self.request("get", url, *args, **kwargs)

        def post(self, url: str, *args: Any, **kwargs: Any) -> DummyResponse:
            return self.request("post", url, *args, **kwargs)

    class DummySocket:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            log("MEDIUM", f"Runtime socket created args={args} kwargs={kwargs}")

        def connect(self, *args: Any, **kwargs: Any) -> None:
            log("HIGH", f"Runtime socket connect blocked args={args} kwargs={kwargs}")

        def send(self, *args: Any, **kwargs: Any) -> int:
            log("MEDIUM", f"Runtime socket send blocked args={args} kwargs={kwargs}")
            return 0

        def recv(self, *args: Any, **kwargs: Any) -> bytes:
            log("MEDIUM", f"Runtime socket recv blocked args={args} kwargs={kwargs}")
            return b""

        def close(self) -> None:
            return None

    import os as _os
    import subprocess as _subprocess
    import socket as _socket
    import urllib.request as _urllib_request

    _os.system = blocked_call("os.system", "HIGH")
    _subprocess.Popen = blocked_popen
    _subprocess.run = blocked_run
    _subprocess.call = blocked_call_proc
    _socket.socket = DummySocket
    _socket.create_connection = blocked_call("socket.create_connection", "HIGH")
    _urllib_request.urlopen = blocked_network("urllib.request.urlopen")

    requests_stub = types.SimpleNamespace(
        get=blocked_network("requests.get"),
        post=blocked_network("requests.post"),
        put=blocked_network("requests.put"),
        delete=blocked_network("requests.delete"),
        request=blocked_network("requests.request"),
        Session=DummySession,
    )
    sys.modules["requests"] = requests_stub

    module_name = f"scan_target_{uuid.uuid4().hex}"
    spec = importlib.util.spec_from_file_location(module_name, node_path)
    if spec is None or spec.loader is None:
        log("MEDIUM", "Dynamic analysis failed: unable to load module spec.")
        return

    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module

    node_dir = os.path.dirname(node_path)
    if node_dir not in sys.path:
        sys.path.insert(0, node_dir)

    try:
        spec.loader.exec_module(module)
    except Exception as exc:
        log("LOW", f"Dynamic import raised {exc.__class__.__name__}: {exc}")
