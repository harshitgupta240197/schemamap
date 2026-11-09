"""Opens a read-only connection to SQL Server. Only this module and extract touch the database."""

from schemamap.connect.config import AuthMode, ConnectionConfig
from schemamap.connect.connection import connect
from schemamap.connect.doctor import Check, DoctorReport, Status, diagnose
from schemamap.connect.driver import driver_fix_message, load_driver
from schemamap.connect.executor import MetadataExecutor
from schemamap.connect.permissions import (
    USER_NOTE,
    USER_PLACEHOLDER,
    Permission,
    database_user,
    grant_note,
    held_permissions,
    query_store_state,
)
from schemamap.connect.redact import redact

__all__ = [
    "USER_NOTE",
    "USER_PLACEHOLDER",
    "AuthMode",
    "Check",
    "ConnectionConfig",
    "DoctorReport",
    "MetadataExecutor",
    "Permission",
    "Status",
    "connect",
    "database_user",
    "diagnose",
    "driver_fix_message",
    "grant_note",
    "held_permissions",
    "load_driver",
    "query_store_state",
    "redact",
]
