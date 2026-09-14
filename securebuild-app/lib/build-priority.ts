// Keep the key encoding in sync with pkg/buildpriority/priority.go.
// PostgreSQL must compare these keys using COLLATE "C".
const versionPattern = /^v?([0-9]+)(?:\.([0-9]+))?(?:\.([0-9]+))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function versionKey(...versions: string[]): string {
  let best = "";
  for (const raw of versions) {
    const match = versionPattern.exec(raw);
    // JS $ also matches before a final newline; reject that partial match.
    if (!match || match[0] !== raw) continue;
    const core = match.slice(1, 4).map(part => (part || "0").replace(/^0+/, "") || "0");
    if (core.some(part => part.length > 20)) continue;
    let key = core.map(part => part.padStart(20, "0")).join(".") + "/";
    if (!match[4]) {
      key += "~";
    } else {
      let valid = true;
      for (const part of match[4].split(".")) {
        if (/^[0-9]+$/.test(part)) {
          if (part.length > 1 && part[0] === "0") { valid = false; break; }
          key += "0" + String(part.length).padStart(10, "0") + part + "!";
        } else {
          key += "1" + part + "!";
        }
      }
      if (!valid) continue;
    }
    if (key > best) best = key;
  }
  return best;
}
