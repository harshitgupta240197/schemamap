import shlex

import pytest
import typer
import typer.core
from typer.testing import CliRunner

from schemamap.cli import app


def test_version_prints_0_0_1() -> None:
    result = CliRunner().invoke(app, ["--version"])
    assert result.exit_code == 0
    assert result.stdout.strip() == "0.0.1"


def help_examples() -> list[tuple[str, list[str]]]:
    """Every ``schemamap <command> ...`` example line in every command's docstring."""
    group = typer.main.get_command(app)
    assert isinstance(group, typer.core.TyperGroup)
    examples = []
    for name, command in sorted(group.commands.items()):
        for line in (command.help or "").splitlines():
            if line.strip().startswith(f"schemamap {name} "):
                examples.append((name, shlex.split(line.strip())[2:]))
    return examples


def test_help_has_examples() -> None:
    assert {name for name, _ in help_examples()} == {"doctor", "extract", "ui", "view"}


@pytest.mark.parametrize(("name", "args"), help_examples())
def test_every_help_example_parses(name: str, args: list[str]) -> None:
    """A copied example must at least be valid syntax (Gate 1 found ``--auth entra``)."""
    group = typer.main.get_command(app)
    assert isinstance(group, typer.core.TyperGroup)
    command = group.commands[name]
    command.make_context(name, list(args))
