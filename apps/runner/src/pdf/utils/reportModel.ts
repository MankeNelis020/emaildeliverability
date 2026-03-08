 // apps/runner/src/pdf/utils/reportModel.ts
 import { esc } from "./esc.js";
 import { fmtPct } from "./fmt.js";
 
 export type PdfPlan = "basic" | "verified";
 
 export type PdfBadgeTone = "good" | "warn" | "bad" | "neutral";
 
 export type PdfBadge = {
   label: string;
   tone: PdfBadgeTone;
 };
 
 export type PdfModel = {
   scanId: string;
   generatedAt: string;
   plan: PdfPlan;
 
   headline: string;
   verdict: string;
   confidence: string;
 
   // Scores
   emailScore: number | null;
   websiteScore: number | null;
   campaignScore: number | null;
   overallPct: string;
 
   badge: PdfBadge;
 
   // Inputs
   hostname: string;
   websiteUrl: string;
   sendingEmail: string;
   contactEmail: string;
 
   // Evidence flags
   hasWebsiteEvidence: boolean;
   hasVerifiedEmailEvidence: boolean;
 
   // Auth summary (DNS)
   spfPresent: boolean | null;
   dmarcPresent: boolean | null;
   dmarcPolicy: string | null;
 
   // DKIM (only meaningful in verified; otherwise null)
   dkimMeasured: boolean;
   dkimPresent: boolean | null;
 };
 
 function isVerifiedPlan(report: any): boolean {
   const planHint = String(
     report?.inputs?.plan ??
       report?.inputs?.sku ??
       report?.inputs?.product ??
       report?.payment_sku ??
       ""
   ).toLowerCase();
 
   if (planHint.includes("verified")) return true;
 
   // Heuristics: verified tends to have email_scan.checks or inbound evidence
   if (report?.email_scan?.checks) return true;
   if (report?.inbound_email || report?.email_evidence) return true;
 
   return false;
 }
 
 function parseDmarcPolicy(record: unknown): string | null {
   if (!record) return null;
   const s = String(record).toLowerCase();
   const m = s.match(/\bp\s*=\s*(none|quarantine|reject)\b/);
   return m?.[1] ?? null;
 }
 
 function clamp01(x: number): number {
   if (!Number.isFinite(x)) return 0;
   return Math.max(0, Math.min(1, x));
 }
 
 function computeBadge(overallScore0to100: number | null, readyToSend: boolean | null): PdfBadge {
   // Prefer explicit ready_to_send if present
   if (readyToSend === true) return { label: "READY TO SEND", tone: "good" };
   if (readyToSend === false) return { label: "DO NOT SEND", tone: "bad" };
 
   // Fallback to percentage mapping
   const p = typeof overallScore0to100 === "number" ? overallScore0to100 : 0;
   if (p >= 66.6) return { label: "READY TO SEND", tone: "good" };
   if (p >= 33.0) return { label: "CAUTION", tone: "warn" };
   return { label: "DO NOT SEND", tone: "bad" };
 }
 
 export function buildPdfModel(report: any): PdfModel {
   const scanId = String(report?.scan_id ?? "—");
   const generatedAt = String(report?.generated_at ?? "—");
 
   const headline = String(report?.headline ?? "—");
   const verdict = String(report?.verdict ?? "—");
   const confidence = String(report?.confidence ?? "—");
 
   const plan: PdfPlan = isVerifiedPlan(report) ? "verified" : "basic";
 
   const emailScore = Number.isFinite(Number(report?.scores?.email?.score)) ? Number(report.scores.email.score) : null;
   const websiteScore = Number.isFinite(Number(report?.scores?.website?.score)) ? Number(report.scores.website.score) : null;
   const campaignScore = Number.isFinite(Number(report?.scores?.campaign?.score)) ? Number(report.scores.campaign.score) : null;
 
   // Overall = campaign score if present, else avg(email+website)
   const overall0to100 =
     campaignScore != null
       ? campaignScore
       : emailScore != null && websiteScore != null
       ? clamp01((emailScore + websiteScore) / 200) * 100
       : null;
 
   const overallPct = overall0to100 == null ? "—" : fmtPct(overall0to100 / 100);
 
   const readyToSend = typeof report?.ready_to_send === "boolean" ? report.ready_to_send : null;
   const badge = computeBadge(overall0to100, readyToSend);
 
   const hostname = String(report?.inputs?.hostname ?? report?.inputs?.domain ?? report?.inputs?.raw ?? "—");
   const websiteUrl = String(report?.inputs?.website_url ?? report?.website_url ?? "—");
   const sendingEmail = String(report?.inputs?.sending_email ?? "—");
   const contactEmail = String(report?.inputs?.contact_email ?? "—");
 
   const websiteSamples =
     report?.website_scan?.aggregates?.http?.samples ??
     report?.website_scan?.http?.samples ??
     [];
   const hasWebsiteEvidence = Array.isArray(websiteSamples) && websiteSamples.length > 0;
 
   const hasVerifiedEmailEvidence = Boolean(report?.email_scan?.checks || report?.inbound_email || report?.email_evidence);
 
   // DNS auth from email_auth
   const spfPresent = typeof report?.email_auth?.spf?.present === "boolean" ? report.email_auth.spf.present : null;
   const dmarcPresent =
     typeof report?.email_auth?.dmarc?.present === "boolean" ? report.email_auth.dmarc.present : null;
   const dmarcPolicy = parseDmarcPolicy(report?.email_auth?.dmarc?.record);
 
   // DKIM: only measured/meaningful when verified evidence exists
   const dkimMeasured = plan === "verified" && Boolean(report?.email_scan?.checks?.dkim);
   const dkimPresent =
     dkimMeasured && typeof report?.email_scan?.checks?.dkim?.present === "boolean"
       ? report.email_scan.checks.dkim.present
       : null;
 
   return {
     scanId,
     generatedAt,
     plan,
     headline,
     verdict,
     confidence,
     emailScore,
     websiteScore,
     campaignScore,
     overallPct,
     badge,
     hostname,
     websiteUrl,
     sendingEmail,
     contactEmail,
     hasWebsiteEvidence,
     hasVerifiedEmailEvidence,
     spfPresent,
     dmarcPresent,
     dmarcPolicy,
     dkimMeasured,
     dkimPresent,
   };
 }
 
 // Small helpers for rendering (optional but handy)
 export function yesNoUnknown(v: boolean | null): string {
   if (v === true) return "Yes";
   if (v === false) return "No";
   return "—";
 }
 
 export function planLabel(plan: PdfPlan): string {
   return plan === "verified" ? "Verified Scan" : "Basic Scan";
 }
 
 export function escInline(v: any): string {
   return esc(String(v ?? "—"));
 }
 