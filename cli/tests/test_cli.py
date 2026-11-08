from typer.testing import CliRunner

from schemamap.cli import app


def test_version_prints_0_0_1() -> None:
    result = CliRunner().invoke(app, ["--version"])
    assert result.exit_code == 0
    assert result.stdout.strip() == "0.0.1"
