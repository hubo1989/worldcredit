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
    {"id": "page-foundations", "name": "00 · Foundations"},
    {"id": "page-components", "name": "01 · Components"},
]
FRAMES = {
    "page-current": [
        {"id": "screen-dashboard", "name": "screen.mobile.dashboard · 390×844"},
        {"id": "support-note", "name": "Design Notes"},
        {"id": "screen-bills", "name": "screen.mobile.bills · 390×844"},
        {"id": "screen-lookalike", "name": "screening.mobile.fake · 390×844"},
    ],
    "page-candidate": [
        {"id": "candidate-dashboard", "name": "candidate.mobile.dashboard · 390×844"},
    ],
    "page-comparisons": [
        {"id": "comparison-dashboard", "name": "90 · Comparisons · screen.mobile.dashboard"},
    ],
    "page-admin": [
        {"id": "screen-admin", "name": "screen.admin.dashboard · 1440×900"},
        {"id": "unclassified-admin-note", "name": "Admin Notes"},
    ],
    "page-foundations": [
        {"id": "foundation-palette", "name": "color.bg.canvas"},
    ],
    "page-components": [
        {"id": "component-masters", "name": "WorldCredit · Component Masters"},
        {"id": "review-board", "name": "WorldCredit · Review Board"},
    ],
}


class ExportRoleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.bin_dir = self.root / "bin"
        self.bin_dir.mkdir()
        self.export_root = self.root / "exports"
        self.export_log = self.root / "export-log"
        self.fake_op = self.bin_dir / "op"
        self.fake_op.write_text(
            "#!/usr/bin/env python3\n"
            "import json, os, pathlib, sys\n"
            f"PAGES = {PAGES!r}\n"
            f"FRAMES = {FRAMES!r}\n"
            "args = sys.argv[1:]\n"
            "if args[:2] == ['page', 'list']:\n"
            "    pages = PAGES\n"
            "    if os.environ.get('FAKE_OP_MANIFEST_MODE') == 'invalid_after_valid':\n"
            "        pages = [PAGES[0], {'id': '', 'name': 'invalid page after a valid one'}]\n"
            "    print(json.dumps({'pageCount': len(pages), 'pages': pages}, ensure_ascii=False))\n"
            "elif args and args[0] == 'get':\n"
            "    if os.environ.get('FAKE_OP_GET_EXIT'):\n"
            "        print('simulated page read failure', file=sys.stderr)\n"
            "        raise SystemExit(int(os.environ['FAKE_OP_GET_EXIT']))\n"
            "    page_id = args[args.index('--page') + 1]\n"
            "    nodes = [{'id': page_id, 'type': 'frame', 'name': 'Frame'}]\n"
            "    nodes.extend({'type': 'frame', **frame} for frame in FRAMES[page_id])\n"
            "    print(json.dumps({'nodes': nodes}, ensure_ascii=False))\n"
            "elif args and args[0] == 'export':\n"
            "    frame_id = args[args.index('--item') + 1]\n"
            "    output = pathlib.Path(args[args.index('--output') + 1])\n"
            "    output.parent.mkdir(parents=True, exist_ok=True)\n"
            "    output.write_bytes(frame_id.encode())\n"
            "    with open(os.environ['FAKE_OP_EXPORT_LOG'], 'a', encoding='utf-8') as log:\n"
            "        log.write(frame_id + '\\n')\n"
            "else:\n"
            "    raise SystemExit('unexpected fake op invocation: ' + repr(args))\n",
            encoding="utf-8",
        )
        self.fake_op.chmod(0o755)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def run_export(
        self,
        *,
        get_exit: str | None = None,
        manifest_mode: str | None = None,
        expect_success: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        env["OPENPENCIL_EXPORT_ROOT"] = str(self.export_root)
        env["FAKE_OP_EXPORT_LOG"] = str(self.export_log)
        env["PATH"] = f"{self.bin_dir}{os.pathsep}{env.get('PATH', '')}"
        if get_exit is not None:
            env["FAKE_OP_GET_EXIT"] = get_exit
        if manifest_mode is not None:
            env["FAKE_OP_MANIFEST_MODE"] = manifest_mode
        result = subprocess.run(
            ["bash", str(EXPORT_SCRIPT)],
            cwd=REPO,
            env=env,
            check=False,
            capture_output=True,
            text=True,
        )
        if expect_success:
            self.assertEqual(result.returncode, 0, result.stderr)
        return result

    def test_exports_only_screen_current_frames_and_keeps_other_roles_separate(self) -> None:
        self.run_export()

        current = sorted(p.name for p in (self.export_root / "current").glob("*.png"))
        candidate = sorted(p.name for p in (self.export_root / "candidate").glob("*.png"))
        comparisons = sorted(p.name for p in (self.export_root / "comparisons").glob("*.png"))
        self.assertEqual(current, [
            "0-10 · Mobile Core-0-screen.mobile.dashboard · 390×844.png",
            "0-10 · Mobile Core-1-screen.mobile.bills · 390×844.png",
            "3-30 · Admin-0-screen.admin.dashboard · 1440×900.png",
        ])
        self.assertEqual(candidate, [
            "1-13 · Candidates-0-candidate.mobile.dashboard · 390×844.png",
        ])
        self.assertEqual(comparisons, [
            "2-90 · Comparisons-0-90 · Comparisons · screen.mobile.dashboard.png",
        ])
        exported_ids = self.export_log.read_text(encoding="utf-8").splitlines()
        self.assertEqual(exported_ids, [
            "screen-dashboard",
            "screen-bills",
            "candidate-dashboard",
            "comparison-dashboard",
            "screen-admin",
        ])
        self.assertNotIn("screen-lookalike", exported_ids)
        self.assertNotIn("foundation-palette", exported_ids)
        self.assertNotIn("component-masters", exported_ids)
        self.assertNotIn("review-board", exported_ids)

    def test_page_read_failure_fails_export_instead_of_skipping_as_empty(self) -> None:
        result = self.run_export(get_exit="7", expect_success=False)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("failed to inspect OpenPencil page 10 · Mobile Core", result.stderr)
        self.assertFalse(list(self.export_root.rglob("*.png")))

    def test_invalid_manifest_after_valid_entry_fails_before_any_export(self) -> None:
        result = self.run_export(
            manifest_mode="invalid_after_valid",
            expect_success=False,
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("invalid page metadata", result.stderr)
        self.assertFalse(self.export_log.exists())
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
        self.assertEqual(len(current), 4)
        self.assertEqual(len(candidate), 2)
        self.assertEqual(len(comparisons), 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
