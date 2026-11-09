"""Opens a read-only connection to SQL Server. Only this module and extract touch the database."""

from schemamap.connect.config import AuthMode, ConnectionConfig
from schemamap.connect.connection import Connection, connect
from schemamap.connect.doctor import Check, DoctorReport, Status, diagnose
from schemamap.connect.driver import driver_fix_message, load_driver
from schemamap.connect.redact import redact

__all__ = [
    "AuthMode",
    "Check",
    "Connection",
    "ConnectionConfig",
    "DoctorReport",
    "Status",
    "connect",
    "diagnose",
    "driver_fix_message",
    "load_driver",
    "redact",
]
