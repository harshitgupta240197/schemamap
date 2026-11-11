"""The view command and snapshot embedding: escaping, byte-for-byte text, files, errors."""

from __future__ import annotations

import gzip
import hashlib
import json
import os
from pathlib import Path
from typing import Any

import pytest
from snapshot_builders import (
    HOSTILE_DATABASE,
    HOSTILE_DEFINITION,
    hostile_snapshot,
)
from typer.testing import CliRunner

from schemamap.cli import app
from schemamap.errors import EmbedError, ViewerUnavailableError
from schemamap.snapshot.io import (
    default_map_path,
    dump_snapshot,
    load_snapshot,
    write_snapshot,
)
from schemamap.snapshot.models import Generator, Snapshot, SourceInfo
from schemamap.viewer import (
    PLACEHOLDER,
    embed_snapshot,
    escape_for_script,
    load_viewer,
)

FIXTURES = Path(__file__).parent / "fixtures"
DATA_OPEN = '<script type="application/json" id="schemamap-data">'
STUB = f"<!doctype html><html><body>{PLACEHOLDER}<div id=root></div><p>$& $' \\1</p></body></html>"
runner = CliRunner()


def embedded_json(page: str) -> Any:
    """The JSON inside the one data element, found the way a browser would: first </script>."""
    start = page.index(DATA_OPEN) + len(DATA_OPEN)
    return json.loads(page[start : page.index("</script>", start)])


def stub_viewer(directory: Path, template: str = STUB, version: str = "1.2.3") -> Path:
    """Write a viewer directory (page + manifest) the way tools/build_viewer.py does."""
    directory.mkdir(parents=True, exist_ok=True)
    page = template.encode("utf-8")
    (directory / "index.html").write_bytes(page)
    manifest = {"viewer_version": version, "sha256": hashlib.sha256(page).hexdigest()}
    (directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return directory


@pytest.fixture
def viewer_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    directory = stub_viewer(tmp_path / "viewer_dist")
    monkeypatch.setattr("schemamap.viewer.VIEWER_DIR", directory)
    return directory


def plain_snapshot(database: str = "Sample") -> Snapshot:
    return Snapshot(
        generator=Generator(version="1.0.0"),
        captured_at=hostile_snapshot().captured_at,
        source=SourceInfo(server="db-host.example", database=database),
    )


# --- escaping -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("char", "escaped"),
    [
        ("<", "\\u003c"),
        (">", "\\u003e"),
        ("&", "\\u0026"),
        (chr(0x2028), "\\u2028"),
        (chr(0x2029), "\\u2029"),
    ],
)
def test_each_special_character_is_escaped(char: str, escaped: str) -> None:
    assert escape_for_script(f'{{"a{char}b":"{char}"}}') == f'{{"a{escaped}b":"{escaped}"}}'


def test_escaping_leaves_other_text_alone() -> None:
    text = '{"name":"Order é 日本","n":[1,2.5,null,true]}'
    assert escape_for_script(text) == text


def test_hostile_names_cannot_leave_the_script_element() -> None:
    page = embed_snapshot(STUB, hostile_snapshot())
    head, _, tail = page.partition(DATA_OPEN)
    data, closing, rest = tail.partition("</script>")
    assert closing == "</script>"
    for raw in ("<", ">", "&", chr(0x2028), chr(0x2029)):
        assert raw not in data
    assert "</script>" not in rest.replace("</body>", "")  # only the stub's own markup remains
    assert rest == "<div id=root></div><p>$& $' \\1</p></body></html>"
    assert head == "<!doctype html><html><body>"


def test_embedded_json_parses_back_to_the_snapshot() -> None:
    snapshot = hostile_snapshot()
    assert embedded_json(embed_snapshot(STUB, snapshot)) == snapshot.model_dump(mode="json")


def test_embedded_json_round_trips_through_the_model() -> None:
    snapshot = hostile_snapshot()
    start = embed_snapshot(STUB, snapshot)
    text = json.dumps(embedded_json(start))
    assert load_snapshot(text) == snapshot


def test_definitions_with_replacement_syntax_are_embedded_byte_for_byte() -> None:
    """`$'`, `$&`, `\\1`, `\\g<0>` are replacement syntax in re.sub; here they are plain text."""
    snapshot = hostile_snapshot()
    for needle in ("$&", "$'", "$`", "\\1", "\\g<0>", "{0}", "%s"):
        assert needle in HOSTILE_DEFINITION
    embedded = embedded_json(embed_snapshot(STUB, snapshot))
    assert embedded["views"][0]["definition"] == HOSTILE_DEFINITION
    # The template around the data is copied exactly too.
    page = embed_snapshot(STUB, snapshot)
    assert page.endswith("<div id=root></div><p>$& $' \\1</p></body></html>")


def test_only_the_placeholder_changes() -> None:
    page = embed_snapshot(STUB, plain_snapshot())
    start = page.index(DATA_OPEN)
    end = page.index("</script>", start) + len("</script>")
    assert page[:start] + PLACEHOLDER + page[end:] == STUB


def test_the_embedding_is_deterministic() -> None:
    assert embed_snapshot(STUB, hostile_snapshot()) == embed_snapshot(STUB, hostile_snapshot())


@pytest.mark.parametrize("template", ["<html></html>", f"{PLACEHOLDER}x{PLACEHOLDER}"])
def test_a_missing_or_repeated_placeholder_is_an_error(template: str) -> None:
    with pytest.raises(EmbedError, match="exactly once"):
        embed_snapshot(template, plain_snapshot())


def test_a_placeholder_that_differs_by_a_space_is_not_one() -> None:
    template = PLACEHOLDER.replace(" id=", "  id=")
    with pytest.raises(EmbedError):
        embed_snapshot(template, plain_snapshot())


def test_no_credential_or_host_appears_unless_the_snapshot_has_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SCHEMAMAP_PASSWORD", "Sup3rSecret")
    monkeypatch.setenv("SCHEMAMAP_USER", "reader-login")
    redacted = hostile_snapshot()
    assert redacted.source.server is None
    page = embed_snapshot(STUB, redacted)
    assert page.replace(page[page.index(DATA_OPEN) :], "") == "<!doctype html><html><body>"
    for secret in ("Sup3rSecret", "reader-login", "db-host.example"):
        assert secret not in page
    assert "db-host.example" in embed_snapshot(STUB, plain_snapshot())  # present only if given


# --- the packaged viewer --------------------------------------------------------------------


def test_load_viewer_returns_the_page_and_version(tmp_path: Path) -> None:
    template = load_viewer(stub_viewer(tmp_path / "v", version="4.5.6"))
    assert template.html == STUB
    assert template.version == "4.5.6"


def test_missing_viewer_names_the_build_tool(tmp_path: Path) -> None:
    with pytest.raises(ViewerUnavailableError, match=r"tools/build_viewer\.py"):
        load_viewer(tmp_path / "nothing-here")


def test_changed_viewer_is_refused(tmp_path: Path) -> None:
    directory = stub_viewer(tmp_path / "v")
    (directory / "index.html").write_text(STUB + "<!-- edited -->", encoding="utf-8")
    with pytest.raises(ViewerUnavailableError, match="manifest"):
        load_viewer(directory)


@pytest.mark.parametrize("manifest", ["not json", "[]", '{"sha256": 1}', '{"viewer_version":"1"}'])
def test_malformed_manifest_is_refused(tmp_path: Path, manifest: str) -> None:
    directory = stub_viewer(tmp_path / "v")
    (directory / "manifest.json").write_text(manifest, encoding="utf-8")
    with pytest.raises(ViewerUnavailableError, match=r"tools/build_viewer\.py"):
        load_viewer(directory)


# --- the command ----------------------------------------------------------------------------


def run_view(*args: str) -> Any:
    return runner.invoke(app, ["view", *args, "--no-open"])


def test_view_writes_a_map_beside_the_current_folder(
    viewer_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    source = tmp_path / "s.snapshot.json"
    write_snapshot(hostile_snapshot(), source)
    result = run_view(str(source))
    assert result.exit_code == 0, result.output
    produced = list(tmp_path.glob("*-map.html"))
    assert [p.name for p in produced] == [default_map_path(HOSTILE_DATABASE).name]
    assert embedded_json(produced[0].read_text(encoding="utf-8"))["source"]["database"] == (
        HOSTILE_DATABASE
    )
    assert result.output.startswith("Wrote ")


@pytest.mark.parametrize(
    ("database", "expected"),
    [
        ("../../etc/passwd", "_.._etc_passwd-map.html"),
        ("a/b\\c", "a_b_c-map.html"),
        ("CON", "_CON-map.html"),
        ("nul.x", "_nul.x-map.html"),
        ("..", "database-map.html"),
        ("</script>", "__script_-map.html"),
        ("AdventureWorks2022", "AdventureWorks2022-map.html"),
    ],
)
def test_hostile_database_names_cannot_leave_the_folder(
    viewer_dir: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    database: str,
    expected: str,
) -> None:
    work = tmp_path / "work"
    work.mkdir()
    monkeypatch.chdir(work)
    source = tmp_path / "in.snapshot.json"
    write_snapshot(plain_snapshot(database), source)
    result = run_view(str(source))
    assert result.exit_code == 0, result.output
    assert sorted(p.name for p in work.iterdir()) == [expected]
    assert [p for p in tmp_path.iterdir() if p.suffix == ".html"] == []


def test_output_option_chooses_the_file(viewer_dir: Path, tmp_path: Path) -> None:
    source = tmp_path / "s.snapshot.json"
    write_snapshot(plain_snapshot(), source)
    target = tmp_path / "chosen.html"
    result = run_view(str(source), "--output", str(target))
    assert result.exit_code == 0, result.output
    assert embedded_json(target.read_text(encoding="utf-8"))["source"]["database"] == "Sample"
    assert f"Wrote {target}" in result.output.replace("\n", "")


def test_gzip_snapshots_are_accepted(viewer_dir: Path, tmp_path: Path) -> None:
    source = tmp_path / "s.snapshot.json.gz"
    write_snapshot(hostile_snapshot(), source, compress=True)
    assert source.read_bytes().startswith(b"\x1f\x8b")
    target = tmp_path / "gz.html"
    assert run_view(str(source), "-o", str(target)).exit_code == 0
    assert embedded_json(target.read_text(encoding="utf-8")) == hostile_snapshot().model_dump(
        mode="json"
    )


def test_gzip_is_detected_by_content_not_name(viewer_dir: Path, tmp_path: Path) -> None:
    source = tmp_path / "looks-plain.json"
    source.write_bytes(gzip.compress(dump_snapshot(plain_snapshot()).encode(), mtime=0))
    assert run_view(str(source), "-o", str(tmp_path / "o.html")).exit_code == 0


@pytest.mark.skipif(os.name != "posix", reason="POSIX permission bits")
def test_the_map_is_readable_only_by_its_owner(viewer_dir: Path, tmp_path: Path) -> None:
    source = tmp_path / "s.snapshot.json"
    write_snapshot(plain_snapshot(), source)
    target = tmp_path / "m.html"
    assert run_view(str(source), "-o", str(target)).exit_code == 0
    assert target.stat().st_mode & 0o777 == 0o600


def test_an_existing_map_is_replaced_atomically(viewer_dir: Path, tmp_path: Path) -> None:
    source = tmp_path / "s.snapshot.json"
    write_snapshot(plain_snapshot(), source)
    target = tmp_path / "m.html"
    target.write_text("old", encoding="utf-8")
    assert run_view(str(source), "-o", str(target)).exit_code == 0
    assert target.read_text(encoding="utf-8").startswith("<!doctype html>")
    assert sorted(p.name for p in tmp_path.iterdir()) == [
        "m.html",
        "s.snapshot.json",
        "viewer_dist",
    ]


def test_unwritable_target_exits_1_with_a_clear_message(viewer_dir: Path, tmp_path: Path) -> None:
    source = tmp_path / "s.snapshot.json"
    write_snapshot(plain_snapshot(), source)
    result = run_view(str(source), "-o", str(tmp_path / "no-such-folder" / "m.html"))
    assert result.exit_code == 1
    assert "Cannot write" in result.output
    assert "Traceback" not in result.output


@pytest.mark.parametrize(
    ("content", "message"),
    [
        ("not json at all", "not valid JSON"),
        ("[]", "not a Schema Map snapshot"),
        ('{"format": "other"}', "not a Schema Map snapshot"),
        (
            '{"format": "schemamap.snapshot", "format_version": "2.0"}',
            "unsupported snapshot format version",
        ),
        ('{"format": "schemamap.snapshot", "format_version": "1.0"}', "invalid snapshot"),
    ],
)
def test_bad_snapshots_exit_4_with_a_friendly_message(
    viewer_dir: Path, tmp_path: Path, content: str, message: str
) -> None:
    source = tmp_path / "bad.json"
    source.write_text(content, encoding="utf-8")
    result = run_view(str(source), "-o", str(tmp_path / "m.html"))
    assert result.exit_code == 4
    assert message in result.output
    assert "Traceback" not in result.output
    assert not (tmp_path / "m.html").exists()


def test_a_missing_snapshot_file_exits_4(viewer_dir: Path, tmp_path: Path) -> None:
    result = run_view(str(tmp_path / "absent.json"))
    assert result.exit_code == 4
    assert "cannot read" in result.output


def test_a_missing_viewer_exits_1_and_names_the_build_tool(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("schemamap.viewer.VIEWER_DIR", tmp_path / "not-built")
    source = tmp_path / "s.snapshot.json"
    write_snapshot(plain_snapshot(), source)
    result = run_view(str(source), "-o", str(tmp_path / "m.html"))
    assert result.exit_code == 1
    assert "tools/build_viewer.py" in result.output
    assert "Traceback" not in result.output
    assert not (tmp_path / "m.html").exists()


def test_the_browser_is_opened_with_a_file_uri_only(
    viewer_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    opened: list[str] = []

    def record(url: str) -> bool:
        opened.append(url)
        return True

    monkeypatch.setattr("webbrowser.open", record)
    source = tmp_path / "s.snapshot.json"
    write_snapshot(plain_snapshot(), source)
    target = tmp_path / "m m.html"
    result = runner.invoke(app, ["view", str(source), "-o", str(target)])
    assert result.exit_code == 0, result.output
    assert opened == [target.resolve().as_uri()]
    assert opened[0].startswith("file:///")


def test_no_open_never_starts_a_browser(
    viewer_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def refuse(url: str) -> bool:
        raise AssertionError("a browser was started")

    monkeypatch.setattr("webbrowser.open", refuse)
    source = tmp_path / "s.snapshot.json"
    write_snapshot(plain_snapshot(), source)
    assert run_view(str(source), "-o", str(tmp_path / "m.html")).exit_code == 0


def test_a_browser_that_cannot_start_is_not_an_error(
    viewer_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("webbrowser.open", lambda url: False)
    source = tmp_path / "s.snapshot.json"
    write_snapshot(plain_snapshot(), source)
    result = runner.invoke(app, ["view", str(source), "-o", str(tmp_path / "m.html")])
    assert result.exit_code == 0
    assert "Open the file above yourself" in result.output


def test_the_adventureworks_golden_embeds_and_round_trips(viewer_dir: Path, tmp_path: Path) -> None:
    source = FIXTURES / "adventureworks2022.snapshot.json"
    target = tmp_path / "aw.html"
    assert run_view(str(source), "-o", str(target)).exit_code == 0
    original = json.loads(source.read_text(encoding="utf-8"))
    assert embedded_json(target.read_text(encoding="utf-8")) == original


def test_the_hostile_fixture_is_current() -> None:
    """tests/fixtures/hostile.snapshot.json is what the Playwright spec opens; keep it in step.

    Regenerate with: cd cli && uv run python -c "import sys; sys.path.insert(0, 'tests');
    from pathlib import Path; from snapshot_builders import hostile_snapshot;
    from schemamap.snapshot.io import write_snapshot;
    write_snapshot(hostile_snapshot(), Path('tests/fixtures/hostile.snapshot.json'))"
    """
    fixture = (FIXTURES / "hostile.snapshot.json").read_text(encoding="utf-8")
    assert fixture == dump_snapshot(hostile_snapshot())
