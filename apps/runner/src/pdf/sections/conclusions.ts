import { buildRecommendations } from "@crs/core/src/report/recommendations.js";
export function renderConclusionsSection(report: any): string {
  const actions = buildRecommendations(report)

  if (!actions.length) {
    return `
      <div class="card section">
        <h2>Conclusions & next steps</h2>
        <div class="muted">No recommended actions available.</div>
      </div>
    `;
  }

  const items = actions
    .map((a: any, index: number) => {
      const priority = normalizePriority(a?.priority);
      const effort = normalizeEffort(a?.effort);

      const problem =
        a?.problem ??
        a?.why ??
        a?.description ??
        "No problem description available.";

      const action =
        a?.action ??
        a?.title ??
        "Review this issue and apply the recommended fix.";

      return `
        <div class="note" style="margin-top:${index === 0 ? "0" : "8px"};">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
            <div style="font-weight:800; font-size:12px;">${index + 1}.</div>
            <span class="pill ${priorityClass(priority)}">${esc(priority)}</span>
          </div>

          <div style="margin-top:8px; font-size:12px; line-height:1.35;">
            <b>Problem:</b> ${esc(problem)}
          </div>

          <div style="margin-top:6px; font-size:12px; line-height:1.35;">
            <b>Action:</b> ${esc(action)}
          </div>

          <div style="margin-top:6px; font-size:12px; line-height:1.35;">
            <b>Effort:</b> ${esc(effort)}
          </div>
        </div>
      `;
    })
    .join("");

    return `
    <div class="card section">
      <h2>Conclusions & next steps</h2>
      <div class="meta">Prioritized actions based on the current scan evidence.</div>
  
      <div style="margin-top:10px;">
        ${items}
      </div>
  
      <div class="divider"></div>
  
      <div class="note">
        <div style="font-weight:700; font-size:13px;">Continue your analysis</div>
        <div class="muted" style="margin-top:6px;">
          This report validates DNS configuration and landing-page performance. 
          For a deeper deliverability analysis you can run a <b>Verified scan</b>, 
          which analyzes a real received email and validates header-level signals.
        </div>
  
        <ul class="list">
          <li>DKIM signature and domain alignment</li>
          <li>SPF alignment verification</li>
          <li>Email header authentication results</li>
          <li>Spam-filter risk indicators</li>
        </ul>
  
        <div class="muted small">
          Use your <b>Scan ID</b> when ordering a Verified scan to receive a <b>€10 discount</b>.
        </div>
      </div>
  
      <div class="note" style="margin-top:12px;">
        <div style="font-weight:700;">Report disclaimer</div>
        <div class="muted small" style="margin-top:6px;">
          This report represents a technical assessment based on the signals available at the time of scanning. 
          Results may change as website infrastructure, DNS configuration, sending infrastructure, 
          or mailbox-provider filtering systems evolve.
          <br/><br/>
          No rights can be derived from this report. In many environments significant technical 
          changes occur within short timeframes, therefore scans older than <b>30 days</b> 
          should generally be considered outdated and a new scan is recommended.
        </div>
      </div>
  
    </div>
  `;  
}

function normalizePriority(priority: any): "High" | "Medium" | "Low" {
  const value = String(priority ?? "").trim().toLowerCase();

  if (value === "high") return "High";
  if (value === "medium") return "Medium";
  if (value === "low") return "Low";

  return "Medium";
}

function normalizeEffort(effort: any): "Quick fix" | "Requires developer" | "Requires hosting change" {
  const value = String(effort ?? "").trim().toLowerCase();

  if (value === "quick fix") return "Quick fix";
  if (value === "requires developer") return "Requires developer";
  if (value === "requires hosting change") return "Requires hosting change";

  return "Quick fix";
}

function priorityClass(priority: "High" | "Medium" | "Low"): string {
  if (priority === "High") return "bad";
  if (priority === "Medium") return "warn";
  return "good";
}

// local escape (sections are self-contained)
function esc(s: any) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


