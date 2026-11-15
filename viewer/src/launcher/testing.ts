import { parseCapabilities, type Capabilities } from "./model";

/** What `GET /api/capabilities` answers on each OS, as the server builds it (api.capabilities). */
export function capabilitiesBody(os: "windows" | "macos" | "linux"): unknown {
  const modes = [
    { id: "sql", group: "sql", label: "SQL Server login", needs_user: true, needs_password: true },
    { id: "windows", group: "windows", label: "Windows", needs_user: false, needs_password: false },
    {
      id: "entra-password",
      group: "entra",
      label: "Password",
      needs_user: true,
      needs_password: true,
    },
    {
      id: "entra-interactive",
      group: "entra",
      label: "Interactive (opens a Microsoft sign-in page)",
      needs_user: false,
      needs_password: false,
    },
    {
      id: "entra-integrated",
      group: "entra",
      label: "Integrated (your signed-in account)",
      needs_user: false,
      needs_password: false,
    },
  ];
  return { os, auth_modes: os === "windows" ? modes : modes.filter((m) => m.id !== "windows") };
}

export function capabilities(os: "windows" | "macos" | "linux"): Capabilities {
  const caps = parseCapabilities(capabilitiesBody(os));
  if (caps === null) throw new Error("test capabilities are malformed");
  return caps;
}
