SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
USE [master];
GO
-- Lab-only databases. Nothing here touches the sample databases.
IF DB_ID(N'SchemaMapEdgeCases') IS NOT NULL
BEGIN
    ALTER DATABASE [SchemaMapEdgeCases] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE [SchemaMapEdgeCases];
END
IF DB_ID(N'SchemaMapEdgeCasesOther') IS NOT NULL
BEGIN
    ALTER DATABASE [SchemaMapEdgeCasesOther] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
    DROP DATABASE [SchemaMapEdgeCasesOther];
END
GO
CREATE DATABASE [SchemaMapEdgeCasesOther];
GO
USE [SchemaMapEdgeCasesOther];
GO
CREATE TABLE dbo.Remote (Id int NOT NULL CONSTRAINT PK_Remote PRIMARY KEY, Note nvarchar(50) NULL);
GO
CREATE DATABASE [SchemaMapEdgeCases];
GO
USE [SchemaMapEdgeCases];
GO
-- Two foreign keys on identical columns: one edge, two constraints.
CREATE TABLE dbo.Parent (Id int NOT NULL CONSTRAINT PK_Parent PRIMARY KEY);
CREATE TABLE dbo.Child (
    Id int NOT NULL CONSTRAINT PK_Child PRIMARY KEY,
    ParentId int NOT NULL,
    Status tinyint NOT NULL,
    CONSTRAINT FK_Child_Parent_A FOREIGN KEY (ParentId) REFERENCES dbo.Parent (Id),
    CONSTRAINT FK_Child_Parent_B FOREIGN KEY (ParentId) REFERENCES dbo.Parent (Id) ON DELETE CASCADE
);
-- A filtered index.
CREATE INDEX IX_Child_Active ON dbo.Child (ParentId) WHERE Status = 1;
GO
-- A system-versioned temporal table.
CREATE TABLE dbo.Versioned (
    Id int NOT NULL CONSTRAINT PK_Versioned PRIMARY KEY,
    Label nvarchar(50) NOT NULL,
    ValidFrom datetime2 GENERATED ALWAYS AS ROW START NOT NULL,
    ValidTo datetime2 GENERATED ALWAYS AS ROW END NOT NULL,
    PERIOD FOR SYSTEM_TIME (ValidFrom, ValidTo)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = dbo.VersionedHistory));
GO
-- A table whose name has a dot, brackets and non-ASCII characters (built with NCHAR so the
-- file itself stays ASCII).
DECLARE @table nvarchar(128) = N'Odd.Table [x] ' + NCHAR(220) + NCHAR(9731);
DECLARE @column nvarchar(128) = N'col.one [y] ' + NCHAR(233);
DECLARE @sql nvarchar(max) = N'CREATE TABLE dbo.' + QUOTENAME(@table) + N' (' + QUOTENAME(@column) + N' int NOT NULL);';
EXEC (@sql);
GO
-- An encrypted procedure.
CREATE PROCEDURE dbo.SecretProc WITH ENCRYPTION AS SELECT 1 AS One;
GO
-- A procedure that refers to an object that does not exist (deferred name resolution).
CREATE PROCEDURE dbo.UsesMissing AS SELECT * FROM dbo.DoesNotExist;
GO
-- A view and a synonym that refer to another database.
CREATE VIEW dbo.RemoteView AS SELECT Id, Note FROM [SchemaMapEdgeCasesOther].dbo.Remote;
GO
CREATE SYNONYM dbo.RemoteSynonym FOR [SchemaMapEdgeCasesOther].dbo.Remote;
GO
