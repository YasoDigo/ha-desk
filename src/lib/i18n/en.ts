// English. A missing key falls back to Turkish (tr.ts), so a gap never shows an empty label.
// To fix a wording: edit the line here, nothing else is needed.
import type { Key } from "./tr";

export const en: Partial<Record<Key, string>> = {
  "tab.connection": "Connection",
  "tab.general": "General",
  "tab.shortcuts": "Shortcuts",
  "tab.notifications": "Notifications",
  "tab.backup": "Backup",

  "conn.primary": "Primary address",
  "conn.fallback": "Backup address (optional)",
  "conn.fallbackPh": "Used if the primary one does not open",
  "conn.token": "Access token",
  "conn.tokenSaved": "Saved. Type to replace it",
  "conn.tokenPh": "Long-lived access token",
  "conn.saveConnect": "Save and connect",
  "conn.deleteToken": "Delete token",
  "conn.status": "Status: {status}",

  "general.theme": "Theme",
  "theme.dark": "Dark",
  "theme.light": "Light",
  "theme.system": "System",
  "general.accent": "Accent color",
  "general.autostart": "Start with Windows (opens hidden in the tray)",
  "general.paletteSensors": "Also search sensors in the command palette (→ key for the chart)",
  "general.language": "Language",
  "lang.auto": "System language",
};
