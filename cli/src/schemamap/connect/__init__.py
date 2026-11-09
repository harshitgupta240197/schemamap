"""Opens a read-only connection to SQL Server. Only this module and extract touch the database."""

from schemamap.connect.config import AuthMode, ConnectionConfig
from schemamap.connect.connection import connect
from schemamap.connect.doctor import Check, DoctorReport, Status, diagnose
from schemamap.connect.driver import driver_fix_message, load_driver
from schemamap.connect.executor import MetadataExecutor
from schemamap.connect.redact import redact

__all__ = [
    "AuthMode",
    "Check",
    "ConnectionConfig",
    "DoctorReport",
    "MetadataExecutor",
    "Status",
    "connect",
    "diagnose",
    "driver_fix_message",
    "load_driver",
    "redact",
]
