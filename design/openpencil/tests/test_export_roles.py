#!/usr/bin/env python3
"""End-to-end tests for non-destructive, role-separated OpenPencil exports."""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
EXPORT_SCRIPT = REPO / "design" / "openpencil" / "scripts" / "export-all.sh"
PAGES = [
    {"id": "page-current", "name": "10 · Mobile Core"},
    {"id": "page-candidate", "name": "13 · Candidates"},
    {"id": "page-comparisons", "name": "90 · Comparisons"},
    {"id": "page-admin", "name": "30 · Admin"},
]


class ExportRoleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.bin_dir = self.root / "bin"
        self.bin_dir.mkdir()
        self.export_root = self.root / "exports"
        self.fake_op = self.bin_dir / "op"
        self.active_page = self.root / "active-page"
        self.fake_op.write_text(
            "#!/usr/bin/env python3\n"
            "import json, os, pathlib, sys\n"
            f"PAGES = {PAGES!r}\n"
            f"ACTIVE = pathlib.Path({str(self.active_page)!r})\n"
            "args = sys.argv[1:]\n"
            "if args[:2] == ['page', 'list']:\n"
            "    print(json.dumps({'pageCount': len(PAGES), 'pages': PAGES}, ensure_ascii=False))\n"
            "elif args and args[0] == 'get':\n"
            "    if os.environ.get('FAKE_OP_GET_EXIT'):\n"
            "        print('simulated page read failure', file=sys.stderr)\n"
            "        raise SystemExit(int(os.environ['FAKE_OP_GET_EXIT']))\n"
            "    print(json.dumps({'nodes': [{'name': 'sample frame'}]}))\n"
            "elif args and args[0] == 'set_active_page':\n"
            "    ACTIVE.write_text(args[1].split('=', 1)[1])\n"
            "elif args and args[0] == 'export_frames':\n"
            "    out = pathlib.Path(next(a.split('=', 1)[1] for a in args if a.startswith('outputDir=')))\n"
            "    out.mkdir(parents=True, exist_ok=True)\n"
            "    out.joinpath('frame.png').write_bytes(ACTIVE.read_text().encode())\n"
            "else:\n"
            "    raise SystemExit('unexpected fake op invocation: ' + repr(args))\n",
            encoding="utf-8",
        )
        self.fake_op.chmod(0o755)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def run_export(self, *, get_exit: str | None = None) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        env["OPENPENCIL_EXPORT_ROOT"] = str(self.export_root)
        env["PATH"] = f"{self.bin_dir}{os.pathsep}{env.get('PATH', '')}"
        if get_exit is not None:
            env["FAKE_OP_GET_EXIT"] = get_exit
        result = subprocess.run(
            ["bash", str(EXPORT_SCRIPT)],
            cwd=REPO,
            env=env,
            check=False,
            capture_output=True,
            text=True,
        )
        if get_exit is None:
            self.assertEqual(result.returncode, 0, result.stderr)
        return result

    def test_exports_each_role_to_its_own_directory(self) -> None:
        self.run_export()

        current = sorted(p.name for p in (self.export_root / "current").glob("*.png"))
        candidate = sorted(p.name for p in (self.export_root / "candidate").glob("*.png"))
        comparisons = sorted(p.name for p in (self.export_root / "comparisons").glob("*.png"))
        self.assertEqual(current, [
            "0-10 · Mobile Core-frame.png",
            "3-30 · Admin-frame.png",
        ])
        self.assertEqual(candidate, ["1-13 · Candidates-frame.png"])
        self.assertEqual(comparisons, ["2-90 · Comparisons-frame.png"])

    def test_page_read_failure_fails_export_instead_of_skipping_as_empty(self) -> None:
        result = self.run_export(get_exit="7")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("failed to inspect OpenPencil page 10 · Mobile Core", result.stderr)
        self.assertFalse(list(self.export_root.rglob("*.png")))

    def test_does_not_delete_unrelated_pngs_and_repeat_is_stable(self) -> None:
        for role in ("current", "candidate", "comparisons"):
            folder = self.export_root / role
            folder.mkdir(parents=True)
            (folder / "manually-imported.png").write_bytes(b"preserve me")

        self.run_export()
        self.run_export()

        for role in ("current", "candidate", "comparisons"):
            self.assertEqual(
                (self.export_root / role / "manually-imported.png").read_bytes(),
                b"preserve me",
            )
        current = list((self.export_root / "current").glob("*.png"))
        candidate = list((self.export_root / "candidate").glob("*.png"))
        comparisons = list((self.export_root / "comparisons").glob("*.png"))
        self.assertEqual(len(current), 3)
        self.assertEqual(len(candidate), 2)
        self.assertEqual(len(comparisons), 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
