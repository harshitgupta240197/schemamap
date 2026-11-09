"""Static guard: package code holds no SQL and cannot reach a driver cursor outside the executor.

Every .py file under cli/src/ is parsed with ``ast``. Together with the allowlist test this
proves the package can only run the allowlisted files in queries/.
"""

import ast
import re
from pathlib import Path

import pytest

SRC = Path(__file__).resolve().parents[1] / "src"
PACKAGE = SRC / "schemamap"
EXECUTOR = PACKAGE / "connect" / "executor.py"
DRIVER = PACKAGE / "connect" / "driver.py"

# Methods that run SQL or hand out something that can. Only the executor may touch them.
DRIVER_METHODS = frozenset({"cursor", "execute", "executemany", "callproc"})
EXECUTOR_PRIVATE = "_driver_connection"
DRIVER_MODULE = "mssql_python"
TEST_ONLY_MODULES = ("tests", "conftest", "raw_sql")

# Shapes of SQL statements. Upper-case keyword patterns follow this repo's SQL style; the
# case-insensitive ones need structure (schema-qualified names, call syntax) that prose lacks.
SQL_PATTERNS = [
    re.compile(r"\bSELECT\b[\s\S]*\bFROM\b"),
    re.compile(r"\bselect\s+[\w\s,*\[\].()]+?\s+from\s+\[?\w+\]?\s*\.\s*\[?\w+", re.IGNORECASE),
    re.compile(r"\bINSERT\s+INTO\b", re.IGNORECASE),
    re.compile(r"\bUPDATE\s+\S+\s+SET\b", re.IGNORECASE),
    re.compile(r"\bDELETE\s+FROM\b", re.IGNORECASE),
    re.compile(r"\bMERGE\b[\s\S]*\bUSING\b"),
    re.compile(r"\bTRUNCATE\s+TABLE\b", re.IGNORECASE),
    re.compile(
        r"\b(CREATE|ALTER|DROP)\s+(TABLE|VIEW|PROC|PROCEDURE|FUNCTION|TRIGGER|INDEX|SCHEMA|"
        r"USER|LOGIN|DATABASE)\b",
        re.IGNORECASE,
    ),
    re.compile(r"\bEXEC(UTE)?\b\s*[\w(@'\[]"),
    re.compile(r"\bDECLARE\s+@", re.IGNORECASE),
    re.compile(r"\bsp_executesql\b\s+N?'", re.IGNORECASE),
    re.compile(r"\b(openrowset|openquery|opendatasource)\s*\(", re.IGNORECASE),
]


def looks_like_sql(text: str) -> bool:
    """True when ``text`` contains the shape of a SQL statement."""
    return any(pattern.search(text) for pattern in SQL_PATTERNS)


def source_files() -> list[Path]:
    return sorted(SRC.rglob("*.py"))


def string_values(tree: ast.AST) -> list[tuple[int, str]]:
    """Every string in the module: constants, f-string text, and ``+`` chains of literals."""
    found: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            found.append((node.lineno, node.value))
        elif isinstance(node, ast.JoinedStr):
            parts = [
                part.value if isinstance(part, ast.Constant) else " x " for part in node.values
            ]
            found.append((node.lineno, "".join(str(p) for p in parts)))
        elif isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
            joined = _joined_literals(node)
            if joined is not None:
                found.append((node.lineno, joined))
    return found


def _joined_literals(node: ast.expr) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left, right = _joined_literals(node.left), _joined_literals(node.right)
        if left is not None and right is not None:
            return left + right
    return None


def relative(path: Path) -> str:
    return path.relative_to(SRC.parent).as_posix() if path.is_relative_to(SRC.parent) else path.name


def sql_string_findings(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    return [
        f"{relative(path)}:{line}: SQL-like string {text[:60]!r}"
        for line, text in string_values(tree)
        if looks_like_sql(text)
    ]


def driver_access_findings(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    findings: list[str] = []
    is_executor = path == EXECUTOR
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute) and not is_executor:
            if node.attr in DRIVER_METHODS or node.attr == EXECUTOR_PRIVATE:
                findings.append(f"{relative(path)}:{node.lineno}: uses .{node.attr}")
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) and not is_executor:
            if node.value in DRIVER_METHODS or node.value == EXECUTOR_PRIVATE:
                findings.append(f"{relative(path)}:{node.lineno}: names {node.value!r}")
            if DRIVER_MODULE in node.value and path != DRIVER:
                findings.append(f"{relative(path)}:{node.lineno}: names the driver module")
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            modules = (
                [alias.name for alias in node.names]
                if isinstance(node, ast.Import)
                else [node.module or ""]
            )
            for module in modules:
                root = module.split(".")[0]
                if root == DRIVER_MODULE:
                    findings.append(f"{relative(path)}:{node.lineno}: imports the driver")
                if root in TEST_ONLY_MODULES:
                    findings.append(f"{relative(path)}:{node.lineno}: imports test-only {root}")
    return findings


def test_the_scan_sees_the_package() -> None:
    files = source_files()
    assert EXECUTOR in files
    assert DRIVER in files
    assert len(files) >= 10


def test_no_sql_strings_in_package_code() -> None:
    findings = [f for path in source_files() for f in sql_string_findings(path)]
    assert findings == [], "SQL belongs in queries/*.sql:\n" + "\n".join(findings)


def test_only_the_executor_touches_a_driver_cursor() -> None:
    findings = [f for path in source_files() for f in driver_access_findings(path)]
    assert findings == [], "Only connect/executor.py may run SQL:\n" + "\n".join(findings)


def test_the_executor_is_where_the_cursor_is_used() -> None:
    source = EXECUTOR.read_text(encoding="utf-8")
    assert ".cursor()" in source
    assert ".execute(" in source


@pytest.mark.parametrize(
    "text",
    [
        "SELECT name FROM sys.tables",
        "select name from sys.tables",
        "SELECT TOP 1 *\nFROM Person.Person",
        "insert into dbo.t values (1)",
        "UPDATE dbo.t SET a = 1",
        "delete from dbo.t",
        "MERGE dbo.t AS t USING sys.tables AS s ON 1 = 1",
        "TRUNCATE TABLE dbo.t",
        "drop table dbo.t",
        "EXEC dbo.usp_x",
        "EXECUTE('SELECT 1')",
        "DECLARE @x int",
        "sp_executesql N'SELECT 1'",
        "SELECT * FROM OPENROWSET('SQLNCLI', 'x', 'y')",
    ],
)
def test_detector_flags_sql(text: str) -> None:
    assert looks_like_sql(text)


@pytest.mark.parametrize(
    "text",
    [
        "Select a database from the list.",
        "Run only SELECT statements.",
        "The executor runs named queries from queries/.",
        "Ask a DBA to run GRANT VIEW DEFINITION TO <login>.",
        "OPENROWSET",
        "EXEC",
        "Update the settings, then run it again.",
    ],
)
def test_detector_ignores_prose(text: str) -> None:
    assert not looks_like_sql(text)


def test_driver_scan_catches_a_cursor_outside_the_executor(tmp_path: Path) -> None:
    sneaky = tmp_path / "sneaky.py"
    sneaky.write_text(
        "import mssql_python\n"
        "def f(conn):\n"
        "    getattr(conn, 'cursor')().execute('x')\n"
        "    conn._driver_connection.close()\n"
        "from raw_sql import run_raw_sql\n",
        encoding="utf-8",
    )
    findings = "\n".join(driver_access_findings(sneaky))
    for expected in (
        "uses .execute",
        "names 'cursor'",
        "uses ._driver_connection",
        "imports the driver",
        "imports test-only raw_sql",
    ):
        assert expected in findings


def test_sql_scan_catches_concatenated_and_formatted_sql(tmp_path: Path) -> None:
    sneaky = tmp_path / "sneaky.py"
    sneaky.write_text(
        "A = 'SELECT name ' + 'FROM sys.tables'\nB = f'SELECT {1} FROM dbo.t'\n",
        encoding="utf-8",
    )
    assert len(sql_string_findings(sneaky)) == 2
