export type RiskLevel = "low" | "medium" | "high";

export interface ScanInputs {
  website_url: string;
  sending_email: string;
  send_window: {
    enabled: boolean;
    timezone: string;
    scheduled_send_at?: string | null;
  };
}

export interface ScanScores {
  email_readiness: { score: number; max: 100 };
  website_readiness: { score: number; max: 100 };
  campaign_risk: { level: RiskLevel; score: number; max: 100 };
}

export interface ScanResult {
  schema_version: "1.0";
  scan_id: string;
  created_at: string;
  tenant?: {
    brand_id?: string | null;
    owner_user_id?: string | null;
    white_label?: {
      brand_name?: string | null;
      logo_url?: string | null;
      primary_color?: string | null;
      report_domain?: string | null;
      cta_url?: string | null;
    };
  };
  inputs: ScanInputs;
  scores: ScanScores;

  // For MVP we keep these loose. We'll type them when scanners land.
  email_scan: Record<string, unknown>;
  website_scan: Record<string, unknown>;

  summary?: {
    key_insight?: string | null;
    top_priorities?: Array<{ finding_id: string; priority: number }>;
  };

  meta: {
    run_mode: "single" | "scheduled_window";
    scanner_region: string;
    runtime_ms: number;
  };
}

