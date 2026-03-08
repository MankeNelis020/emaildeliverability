export function buildConclusions(report:any){

    const issues = []
   
    const ttfb = report?.website_scan?.aggregates?.http?.summary?.no_cache?.p95?.ttfb_ms
    const redirects = report?.website_scan?.aggregates?.redirects?.count
    const hits = report?.website_scan?.aggregates?.cache?.sample_hits
    const total = report?.website_scan?.aggregates?.cache?.sample_total
   
    const hitRate = total ? hits/total : null
   
   
    // TTFB
    if(ttfb && ttfb > 1200){
     issues.push({
      priority:"High",
      problem:`Landing page server response time is slow (${ttfb}ms).`,
      action:"Ask your hosting provider or developer to enable server-side caching or upgrade origin performance before sending the campaign.",
      effort:"Requires hosting change"
     })
    }
   
    // CACHE
    if(hitRate !== null && hitRate < 0.5){
     issues.push({
      priority:"High",
      problem:`Cache hit rate is only ${Math.round(hitRate*100)}%.`,
      action:"Enable CDN caching for static assets and confirm repeated requests return a cache HIT.",
      effort:"Requires hosting change"
     })
    }
   
    // REDIRECTS
    if(redirects > 3){
     issues.push({
      priority:"High",
      problem:`Campaign traffic passes through ${redirects} redirects.`,
      action:"Replace campaign links with the final landing page URL and remove redirect chains.",
      effort:"Quick fix"
     })
    }
   
    return issues
   }

