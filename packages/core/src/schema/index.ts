export const SCAN_RESULT_SCHEMA_VERSION = "1.0" as const;

// Note: importing JSON requires "resolveJsonModule" if you want TS typing.
// For now, export a path helper to keep it simple.
export const scanResultSchemaPath = new URL("./scan-result.schema.json", import.meta.url);

