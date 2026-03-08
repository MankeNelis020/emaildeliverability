export function renderFooterSection(report: any): string {
  return `
    <div class="footer">
      <div>
        <b>Your company</b><br/>
        Company name · Address · VAT · Website
      </div>
      <div style="text-align:right;">
        <b>Get in touch</b><br/>
        advisor@yourdomain.com · +31 6 12345678
      </div>
    </div>
  `;
}
