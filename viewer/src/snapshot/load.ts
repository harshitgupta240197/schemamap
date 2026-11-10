import type { SchemaMapSnapshotV1 } from "../generated/snapshot";
import { SnapshotLoadError } from "./errors";
import { parseSnapshot } from "./parse";

/** Id of the inline `<script type="application/json">` the CLI writes into the map. */
export const INLINE_DATA_ID = "schemamap-data";

/** Largest decompressed snapshot accepted, a guard against decompression bombs. */
export const MAX_DECOMPRESSED_BYTES = 512 * 1024 * 1024;

/** Read the inline snapshot, or null when this page carries none. Uses textContent, never innerHTML. */
export function readInlineSnapshot(doc: Document = document): SchemaMapSnapshotV1 | null {
  const element = doc.getElementById(INLINE_DATA_ID);
  const text = element?.textContent ?? "";
  if (text.trim() === "") {
    return null;
  }
  return parseSnapshot(text);
}

function isGzip(bytes: Uint8Array<ArrayBuffer>): boolean {
  return bytes[0] === 0x1f && bytes[1] === 0x8b;
}

async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof DecompressionStream === "undefined") {
    throw new SnapshotLoadError(
      "unreadable_file",
      "This browser cannot open .json.gz files. Decompress the file first, or use a current browser.",
    );
  }
  const source = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const reader = source.pipeThrough(new DecompressionStream("gzip")).getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > MAX_DECOMPRESSED_BYTES) {
        throw new SnapshotLoadError(
          "unreadable_file",
          "The decompressed snapshot is larger than the 512 MB limit.",
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof SnapshotLoadError) {
      throw error;
    }
    throw new SnapshotLoadError(
      "unreadable_file",
      "The file looks gzipped but could not be decompressed.",
    );
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Load a dropped or picked file: plain JSON or gzip (detected by magic bytes, not file name). */
export async function loadSnapshotFile(file: Blob): Promise<SchemaMapSnapshotV1> {
  let bytes = new Uint8Array(await file.arrayBuffer());
  if (isGzip(bytes)) {
    bytes = await gunzip(bytes);
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SnapshotLoadError(
      "invalid_json",
      "The file is not valid JSON: it is not UTF-8 text.",
    );
  }
  return parseSnapshot(text);
}
