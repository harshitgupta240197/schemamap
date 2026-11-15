export const DATA_SCRIPT_ID: string;
export function scriptSource(text: string): string;
export function buildPolicy(sources: string[]): string;
export function metaTag(policy: string): string;
export function inlineScriptSources(html: string): string[];
export function inlineStyleSources(html: string): string[];
export function addCsp(html: string): string;
export function cspProblems(html: string): string[];
