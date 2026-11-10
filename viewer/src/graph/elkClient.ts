import ELK, { type ELK as ElkApi, type ElkNode } from "elkjs/lib/elk-api.js";
// The worker source is inlined as plain text (not base64) so check:bundle still sees all of it.
import elkWorkerSource from "elkjs/lib/elk-worker.min.js?raw";

let elk: ElkApi | null = null;

/**
 * Create the ELK client on first use. The worker runs from a Blob URL, so the single built file
 * works when opened over file:// with no network and no separate worker file.
 */
function getElk(): ElkApi {
  if (elk === null) {
    const url = URL.createObjectURL(new Blob([elkWorkerSource], { type: "text/javascript" }));
    elk = new ELK({ workerFactory: () => new Worker(url, { name: "elk-layout" }) });
  }
  return elk;
}

/** Lay out `graph` in the ELK Web Worker. */
export function runElkLayout(graph: ElkNode): Promise<ElkNode> {
  return getElk().layout(graph);
}
