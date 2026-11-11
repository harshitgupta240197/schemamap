import { mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { AW, viewWithCli, WWI } from "./helpers";

/** Where the flow maps are written, once per run, by the global setup. */
export const FLOW_DIR = path.resolve(".flow-maps");

/** What a flow needs to know about a map: its file and where to look in it. */
export interface FlowMap {
  readonly name: string;
  readonly snapshot: string;
  /** A table with foreign keys both ways, searched by its full name. */
  readonly table: string;
  /** A view whose panel lists what it depends on. */
  readonly view: string;
}

export const AW_MAP: FlowMap = {
  name: "aw",
  snapshot: AW,
  table: "Person.Person",
  view: "HumanResources.vEmployee",
};

export const WWI_MAP: FlowMap = {
  name: "wwi",
  snapshot: WWI,
  table: "Sales.Orders",
  view: "Website.Customers",
};

export const FLOW_MAPS: readonly FlowMap[] = [AW_MAP, WWI_MAP];

/** File URL of a flow map (with an optional hash). */
export function flowUrl(map: FlowMap, hash = ""): string {
  return pathToFileURL(path.join(FLOW_DIR, `${map.name}.html`)).href + hash;
}

/** Make every flow map with the real `schemamap view --no-open`. */
export function buildFlowMaps(): void {
  mkdirSync(FLOW_DIR, { recursive: true });
  for (const map of FLOW_MAPS) {
    viewWithCli(map.snapshot, path.join(FLOW_DIR, `${map.name}.html`));
  }
}
