export function normalizeHostname(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }

  let normalized = trimmed.toLowerCase();
  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    normalized = `https://${normalized}`;
  }

  try {
    const url = new URL(normalized);
    return url.hostname.replace(/\.$/, "");
  } catch {
    return "";
  }
}
