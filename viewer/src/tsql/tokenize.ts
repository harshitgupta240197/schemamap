export type TokenKind =
  "keyword" | "string" | "quoted" | "comment" | "number" | "variable" | "plain";

/** A slice of the input. Joining every token's text gives the input back exactly. */
export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
}

const KEYWORDS: ReadonlySet<string> = new Set(
  (
    "ADD ALL ALTER AND ANY AS ASC AUTHORIZATION BACKUP BEGIN BETWEEN BREAK BROWSE BULK BY CASCADE CASE " +
    "CATCH CHECK CHECKPOINT CLOSE CLUSTERED COALESCE COLLATE COLUMN COMMIT COMPUTE CONSTRAINT CONTAINS " +
    "CONTINUE CONVERT CREATE CROSS CURRENT CURSOR DATABASE DEALLOCATE DECLARE DEFAULT DELETE DENY DESC " +
    "DISTINCT DISTRIBUTED DOUBLE DROP DUMP ELSE END ERRLVL ESCAPE EXCEPT EXEC EXECUTE EXISTS EXIT " +
    "EXTERNAL FETCH FILE FILLFACTOR FOR FOREIGN FREETEXT FROM FULL FUNCTION GOTO GRANT GROUP HAVING " +
    "HOLDLOCK IDENTITY IF IN INDEX INNER INSERT INSTEAD INTERSECT INTO IS JOIN KEY KILL LEFT LIKE LINENO " +
    "MERGE NATIONAL NOCHECK NONCLUSTERED NOT NULL NULLIF OF OFF OFFSETS ON OPEN OPTION OR ORDER OUT OUTER " +
    "OUTPUT OVER PERCENT PIVOT PLAN PRIMARY PRINT PROC PROCEDURE PUBLIC RAISERROR READ READTEXT RECONFIGURE " +
    "REFERENCES REPLICATION RESTORE RESTRICT RETURN RETURNS REVERT REVOKE RIGHT ROLLBACK ROWCOUNT RULE " +
    "SAVE SCHEMA SELECT SET SETUSER SHUTDOWN SOME STATISTICS TABLE TABLESAMPLE TEXTSIZE THEN THROW TO TOP " +
    "TRAN TRANSACTION TRIGGER TRUNCATE TRY UNION UNIQUE UNPIVOT UPDATE UPDATETEXT USE USER VALUES VARYING " +
    "VIEW WAITFOR WHEN WHERE WHILE WITH WITHIN WRITETEXT"
  ).split(" "),
);

function isWordStart(ch: string): boolean {
  return ch === "_" || ch === "#" || /^\p{L}$/u.test(ch);
}

function isWordPart(ch: string): boolean {
  return ch === "_" || ch === "#" || ch === "@" || ch === "$" || /^[\p{L}\p{N}]$/u.test(ch);
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

/** End of a quoted run that opens at `start` with `close`, where a doubled `close` is an escape. */
function quotedEnd(text: string, start: number, close: string): number {
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === close) {
      if (text[i + 1] === close) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i += 1;
  }
  return text.length;
}

/** End of a block comment opening at `start`; comments nest, an unclosed one runs to the end. */
function blockCommentEnd(text: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    if (text.startsWith("/*", i)) {
      depth += 1;
      i += 2;
    } else if (text.startsWith("*/", i)) {
      depth -= 1;
      i += 2;
      if (depth === 0) {
        return i;
      }
    } else {
      i += 1;
    }
  }
  return text.length;
}

function numberEnd(text: string, start: number): number {
  let i = start;
  if (text[i] === "0" && (text[i + 1] === "x" || text[i + 1] === "X")) {
    i += 2;
    while (i < text.length && /^[0-9a-fA-F]$/.test(text[i] ?? "")) {
      i += 1;
    }
    return i;
  }
  while (isDigit(text[i])) {
    i += 1;
  }
  if (text[i] === "." && (i > start || isDigit(text[i + 1]))) {
    i += 1;
    while (isDigit(text[i])) {
      i += 1;
    }
  }
  if (text[i] === "e" || text[i] === "E") {
    const sign = text[i + 1] === "+" || text[i + 1] === "-" ? 1 : 0;
    if (isDigit(text[i + 1 + sign])) {
      i += 1 + sign;
      while (isDigit(text[i])) {
        i += 1;
      }
    }
  }
  return i;
}

/**
 * Split T-SQL into tokens for highlighting. A lexer, not a parser: it only needs to find the runs
 * that matter (strings, quoted names, comments, numbers, variables, keywords) and never fails, so
 * odd or unfinished input still comes back as tokens that join to the original text.
 */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const push = (kind: TokenKind, from: number, to: number): void => {
    const slice = text.slice(from, to);
    const last = tokens[tokens.length - 1];
    if (kind === "plain" && last?.kind === "plain") {
      tokens[tokens.length - 1] = { kind, text: last.text + slice };
    } else {
      tokens.push({ kind, text: slice });
    }
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? "";
    const next = text[i + 1];
    let end: number;
    if (ch === "'" || ((ch === "N" || ch === "n") && next === "'")) {
      end = quotedEnd(text, ch === "'" ? i : i + 1, "'");
      push("string", i, end);
    } else if (ch === "[") {
      end = quotedEnd(text, i, "]");
      push("quoted", i, end);
    } else if (ch === '"') {
      end = quotedEnd(text, i, '"');
      push("quoted", i, end);
    } else if (ch === "-" && next === "-") {
      end = i;
      while (end < text.length && text[end] !== "\n" && text[end] !== "\r") {
        end += 1;
      }
      push("comment", i, end);
    } else if (ch === "/" && next === "*") {
      end = blockCommentEnd(text, i);
      push("comment", i, end);
    } else if (isDigit(ch) || (ch === "." && isDigit(next))) {
      end = numberEnd(text, i);
      push("number", i, end);
    } else if (ch === "@") {
      end = i + (next === "@" ? 2 : 1);
      while (end < text.length && isWordPart(text[end] ?? "")) {
        end += 1;
      }
      push(end > i + 1 && text[end - 1] !== "@" ? "variable" : "plain", i, end);
    } else if (isWordStart(ch)) {
      end = i + 1;
      while (end < text.length && isWordPart(text[end] ?? "")) {
        end += 1;
      }
      push(KEYWORDS.has(text.slice(i, end).toUpperCase()) ? "keyword" : "plain", i, end);
    } else {
      end = i + 1;
      push("plain", i, end);
    }
    i = end;
  }
  return tokens;
}
