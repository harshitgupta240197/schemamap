import { buildFlowMaps } from "./flow-maps";

/** Generate the AdventureWorks and WWI maps once per run, with the real CLI. */
export default function globalSetup(): void {
  buildFlowMaps();
}
