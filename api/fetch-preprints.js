// GET /api/fetch-preprints — Fetch recent preprints from bioRxiv, medRxiv, psyArXiv
// Called by Vercel cron or manually from admin

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  const results = { biorxiv: 0, medrxiv: 0, psyarxiv: 0, errors: [] }

  // ─── bioRxiv ───────────────────────────────────────────────────────────────
  try {
    const today = new Date().toISOString().split('T')[0]
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]
    const resp = await fetch(`https://api.biorxiv.org/details/biorxiv/${weekAgo}/${today}/0/15`)
    if (resp.ok) {
      const data = await resp.json()
      for (const p of (data.collection || [])) {
        const { error } = await supabase.from('papers').upsert({
          doi: p.doi,
          title: p.title,
          authors: p.authors,
          journal: 'bioRxiv',
          year: p.date?.split('-')[0] || '',
          abstract: p.abstract || null,
          is_preprint: true,
          is_open_access: true,
          source: 'biorxiv',
          subject: p.category || null,
          pdf_url: `https://www.biorxiv.org/content/${p.doi}v${p.version}.full.pdf`,
        }, { onConflict: 'doi', ignoreDuplicates: true })
        if (!error) results.biorxiv++
      }
    }
  } catch (e) { results.errors.push('bioRxiv: ' + e.message) }

  // ─── medRxiv ───────────────────────────────────────────────────────────────
  try {
    const today = new Date().toISOString().split('T')[0]
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]
    const resp = await fetch(`https://api.biorxiv.org/details/medrxiv/${weekAgo}/${today}/0/15`)
    if (resp.ok) {
      const data = await resp.json()
      for (const p of (data.collection || [])) {
        const { error } = await supabase.from('papers').upsert({
          doi: p.doi,
          title: p.title,
          authors: p.authors,
          journal: 'medRxiv',
          year: p.date?.split('-')[0] || '',
          abstract: p.abstract || null,
          is_preprint: true,
          is_open_access: true,
          source: 'medrxiv',
          subject: p.category || null,
          pdf_url: `https://www.medrxiv.org/content/${p.doi}v${p.version}.full.pdf`,
        }, { onConflict: 'doi', ignoreDuplicates: true })
        if (!error) results.medrxiv++
      }
    }
  } catch (e) { results.errors.push('medRxiv: ' + e.message) }

  // ─── psyArXiv (via OSF API) ────────────────────────────────────────────────
  try {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
    const resp = await fetch(`https://api.osf.io/v2/preprints/?filter[provider]=psyarxiv&filter[date_created][gte]=${weekAgo}&page[size]=15&sort=-date_created`)
    if (resp.ok) {
      const data = await resp.json()
      for (const item of (data.data || [])) {
        const attrs = item.attributes
        const doi = attrs.doi || item.links?.preprint_doi?.replace('https://doi.org/', '') || null
        if (!doi) continue

        const title = attrs.title || 'Untitled'
        const abstract = attrs.description || null
        const date = attrs.date_created?.split('T')[0] || ''

        // Get authors
        let authors = ''
        try {
          const contribResp = await fetch(item.relationships?.contributors?.links?.related?.href + '?page[size]=10')
          if (contribResp.ok) {
            const contribData = await contribResp.json()
            authors = (contribData.data || [])
              .map(c => c.embeds?.users?.data?.attributes?.full_name || c.attributes?.full_name)
              .filter(Boolean)
              .join(', ')
          }
        } catch {}

        const { error } = await supabase.from('papers').upsert({
          doi,
          title,
          authors: authors || 'Unknown',
          journal: 'psyArXiv',
          year: date.split('-')[0] || '',
          abstract,
          is_preprint: true,
          is_open_access: true,
          source: 'psyarxiv',
          subject: 'Psychology',
          pdf_url: attrs.preprint_doi_url || null,
        }, { onConflict: 'doi', ignoreDuplicates: true })
        if (!error) results.psyarxiv++
      }
    }
  } catch (e) { results.errors.push('psyArXiv: ' + e.message) }

  const total = results.biorxiv + results.medrxiv + results.psyarxiv
  console.log(`Preprint fetch: ${total} new (bioRxiv: ${results.biorxiv}, medRxiv: ${results.medrxiv}, psyArXiv: ${results.psyarxiv})`)

  res.status(200).json({
    message: `Fetched ${total} preprints`,
    ...results,
  })
}
