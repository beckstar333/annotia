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

  // ─── arXiv (CS, physics, math, quantitative biology) ───────────────────────
  results.arxiv = 0
  try {
    // arXiv API returns Atom XML — fetch recent papers across key categories
    const categories = ['cs.AI', 'cs.LG', 'cs.CL', 'q-bio', 'stat.ML', 'physics']
    for (const cat of categories.slice(0, 3)) {
      const resp = await fetch(`https://export.arxiv.org/api/query?search_query=cat:${cat}&sortBy=submittedDate&sortOrder=descending&max_results=5`)
      if (!resp.ok) continue
      const xml = await resp.text()

      // Simple XML parsing for entries
      const entries = xml.split('<entry>').slice(1)
      for (const entry of entries) {
        const title = (entry.match(/<title>([\s\S]*?)<\/title>/) || [])[1]?.replace(/\s+/g, ' ').trim()
        const abstract = (entry.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1]?.replace(/\s+/g, ' ').trim()
        const published = (entry.match(/<published>([\s\S]*?)<\/published>/) || [])[1]?.trim()
        const arxivId = (entry.match(/<id>([\s\S]*?)<\/id>/) || [])[1]?.trim()?.replace('http://arxiv.org/abs/', '')

        // Extract authors
        const authorMatches = entry.match(/<name>([\s\S]*?)<\/name>/g) || []
        const authors = authorMatches.map(a => a.replace(/<\/?name>/g, '').trim()).join(', ')

        if (!title || !arxivId) continue

        // arXiv doesn't have DOIs for all papers — use arxiv ID as DOI-like identifier
        const doi = `arxiv:${arxivId}`
        const year = published?.split('-')[0] || ''

        const { error } = await supabase.from('papers').upsert({
          doi,
          title,
          authors: authors || 'Unknown',
          journal: 'arXiv',
          year,
          abstract: abstract || null,
          is_preprint: true,
          is_open_access: true,
          source: 'arxiv',
          subject: cat.startsWith('cs') ? 'Computer Science' : cat.startsWith('q-bio') ? 'Biology' : cat,
          field: cat.startsWith('cs') ? 'AI' : cat.startsWith('q-bio') ? 'Biology' : null,
          pdf_url: `https://arxiv.org/pdf/${arxivId}`,
        }, { onConflict: 'doi', ignoreDuplicates: true })
        if (!error) results.arxiv++
      }
    }
  } catch (e) { results.errors.push('arXiv: ' + e.message) }

  // ─── PubMed recent open access ─────────────────────────────────────────────
  results.pubmed = 0
  try {
    // Fetch recent open access papers
    const searchResp = await fetch('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=open+access[filter]&retmax=10&sort=date&retmode=json&datetype=edat&reldate=7')
    if (searchResp.ok) {
      const searchData = await searchResp.json()
      const ids = searchData.esearchresult?.idlist || []

      if (ids.length > 0) {
        const fetchResp = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`)
        if (fetchResp.ok) {
          const fetchData = await fetchResp.json()
          for (const id of ids) {
            const article = fetchData.result?.[id]
            if (!article || article.error) continue

            const eloc = (article.elocationid || '').replace('doi: ', '')
            const doi = eloc.startsWith('10.') ? eloc : null
            if (!doi) continue

            const authors = (article.authors || []).map(a => a.name).join(', ')

            const { error } = await supabase.from('papers').upsert({
              doi,
              title: article.title || 'Untitled',
              authors: authors || 'Unknown',
              journal: article.fulljournalname || article.source || 'PubMed',
              year: article.pubdate?.split(' ')[0] || '',
              abstract: null,
              is_preprint: false,
              is_open_access: true,
              source: 'pubmed',
              pdf_url: null,
            }, { onConflict: 'doi', ignoreDuplicates: true })
            if (!error) results.pubmed++
          }
        }
      }
    }
  } catch (e) { results.errors.push('PubMed: ' + e.message) }

  // ─── Europe PMC recent open access ─────────────────────────────────────────
  results.europepmc = 0
  try {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]
    const resp = await fetch(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=OPEN_ACCESS:y+FIRST_PDATE:[${weekAgo}+TO+*]&format=json&pageSize=10&sort=DATE_DESC`)
    if (resp.ok) {
      const data = await resp.json()
      for (const article of (data.resultList?.result || [])) {
        if (!article.doi) continue

        const { error } = await supabase.from('papers').upsert({
          doi: article.doi,
          title: article.title || 'Untitled',
          authors: article.authorString || 'Unknown',
          journal: article.journalTitle || 'Europe PMC',
          year: article.pubYear || '',
          abstract: article.abstractText || null,
          is_preprint: article.pubType === 'preprint',
          is_open_access: true,
          source: 'europepmc',
          pdf_url: null,
        }, { onConflict: 'doi', ignoreDuplicates: true })
        if (!error) results.europepmc++
      }
    }
  } catch (e) { results.errors.push('Europe PMC: ' + e.message) }

  const total = results.biorxiv + results.medrxiv + results.psyarxiv + results.arxiv + results.pubmed + results.europepmc
  console.log(`Preprint fetch: ${total} new (bioRxiv: ${results.biorxiv}, medRxiv: ${results.medrxiv}, psyArXiv: ${results.psyarxiv}, arXiv: ${results.arxiv}, PubMed: ${results.pubmed}, Europe PMC: ${results.europepmc})`)

  res.status(200).json({
    message: `Fetched ${total} papers`,
    ...results,
  })
}
