/**
 * Campaign Readiness Scanner — Google Sheets CRM
 *
 * SETUP (eenmalig):
 * 1. Ga naar https://script.google.com → Nieuw project
 * 2. Plak deze code, sla op
 * 3. Klik op "Implementeren" → "Nieuwe implementatie"
 *    - Type: Webtoepassing
 *    - Uitvoeren als: Mijzelf
 *    - Toegang: Iedereen
 * 4. Kopieer de web app URL (begint met https://script.google.com/macros/s/...)
 * 5. Voeg toe aan je Railway/lokale .env:
 *    GOOGLE_SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/JOUW_ID/exec
 *
 * LET OP: na elke codewijziging moet je een NIEUWE versie deployen,
 *         anders blijft de oude code actief.
 */

// ── Kolom-definities ────────────────────────────────────────────────────────
// Volgorde in de sheet. Voeg hier kolommen toe als je meer data wilt.
var HEADERS = [
  "Datum",
  "Scan ID",
  "Purchase ID",
  "Plan",
  "Betaald",
  "Hostname",
  "Sending e-mail",
  "Contact e-mail",
  "Ontvangers",
  "Score E-mail",
  "Score Website",
  "Score Campaign",
  "Verdict",
  "Ready to send",
  "Blockers",
  "PDF link",
  "Inbound adres",
];

// Naam van het tabblad in de spreadsheet
var SHEET_NAME = "Scans";

// ── Webhook ontvanger ────────────────────────────────────────────────────────
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    appendRow(data);
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── Rij toevoegen ────────────────────────────────────────────────────────────
function appendRow(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);

  // Maak tabblad aan als het nog niet bestaat
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  // Voeg header-rij toe als het sheet leeg is
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);

    // Opmaak header-rij
    var headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
    headerRange.setBackground("#1e293b");
    headerRange.setFontColor("#ffffff");
    headerRange.setFontWeight("bold");
    headerRange.setFontSize(10);
    sheet.setFrozenRows(1);

    // Kolombreedtes
    sheet.setColumnWidth(1, 140);  // Datum
    sheet.setColumnWidth(2, 280);  // Scan ID
    sheet.setColumnWidth(3, 280);  // Purchase ID
    sheet.setColumnWidth(4, 80);   // Plan
    sheet.setColumnWidth(5, 90);   // Betaald
    sheet.setColumnWidth(6, 160);  // Hostname
    sheet.setColumnWidth(7, 200);  // Sending e-mail
    sheet.setColumnWidth(8, 200);  // Contact e-mail
    sheet.setColumnWidth(9, 90);   // Ontvangers
    sheet.setColumnWidth(10, 90);  // Score E-mail
    sheet.setColumnWidth(11, 100); // Score Website
    sheet.setColumnWidth(12, 110); // Score Campaign
    sheet.setColumnWidth(13, 100); // Verdict
    sheet.setColumnWidth(14, 100); // Ready to send
    sheet.setColumnWidth(15, 240); // Blockers
    sheet.setColumnWidth(16, 340); // PDF link
    sheet.setColumnWidth(17, 320); // Inbound adres
  }

  // Datum netjes opmaken
  var datum = data.created_at
    ? new Date(data.created_at)
    : new Date();

  // Blockers samenvoegen tot leesbare string
  var blockers = "";
  if (Array.isArray(data.blockers) && data.blockers.length > 0) {
    blockers = data.blockers.map(function(b) {
      return b.id + ": " + b.message;
    }).join(" | ");
  }

  var row = [
    datum,
    data.scan_id        || "",
    data.purchase_id    || "",
    data.plan           || "basic",
    data.payment_status || "",
    data.hostname       || "",
    data.sending_email  || "",
    data.contact_email  || "",
    data.recipient_count != null ? data.recipient_count : "",
    data.score_email    != null ? data.score_email    : "",
    data.score_website  != null ? data.score_website  : "",
    data.score_campaign != null ? data.score_campaign : "",
    data.verdict        || "",
    data.ready_to_send  ? "Ja" : "Nee",
    blockers,
    data.pdf_url        || "",
    data.inbound_address || "",
  ];

  sheet.appendRow(row);

  // Kleur de rij op basis van betaalstatus / plan
  var lastRow = sheet.getLastRow();
  var rowRange = sheet.getRange(lastRow, 1, 1, HEADERS.length);

  if (data.payment_status === "paid") {
    rowRange.setBackground("#f0fdf4"); // lichtgroen
  } else if (data.payment_status === "freebeta") {
    rowRange.setBackground("#fefce8"); // lichtgeel
  }

  if (data.plan === "verified") {
    sheet.getRange(lastRow, 4).setFontWeight("bold");
  }

  // Datum-kolom mooi opmaken
  sheet.getRange(lastRow, 1).setNumberFormat("dd-mm-yyyy hh:mm");
}

// ── Test vanuit Apps Script editor ──────────────────────────────────────────
// Selecteer deze functie en klik op "Uitvoeren" om een testrow toe te voegen.
function testAppendRow() {
  appendRow({
    created_at:      new Date().toISOString(),
    scan_id:         "test-scan-123",
    purchase_id:     "",
    plan:            "basic",
    payment_status:  "freebeta",
    hostname:        "example.com",
    sending_email:   "marketing@example.com",
    contact_email:   "you@example.com",
    recipient_count: null,
    score_email:     72,
    score_website:   85,
    score_campaign:  68,
    verdict:         "caution",
    ready_to_send:   false,
    blockers:        [{ id: "dmarc_policy_weak", message: "DMARC policy is none" }],
    pdf_url:         "https://api.sendshield.nl/api/scan/test-scan-123/report.pdf",
    inbound_address: null,
  });
}
