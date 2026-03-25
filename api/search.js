// Search for papers across OpenAlex and Semantic Scholar
// GET /api/search?q=keyword&source=openalex|semantic|both&page=1

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { q, source = 'both', page = '1', per_page = '10' } = req.query

  if (!q || !q.trim()) {
    return res.status(400).json({ error: 'Query parameter "q" is required' })
  }

  const pageNum = parseInt(page, 10)
  const perPage = Math.min(parseInt(per_page, 10), 25)
  const results = []

  try {
    const fetches = []

    // OpenAlex — free, no API key
    if (source === 'openalex' || source === 'both') {
      fetches.push(
        searchOpenAlex(q, pageNum, perPage)
          .then(r => ({ source: 'openalex', results: r }))
          .catch(err => ({ source: 'openalex', results: [], error: err.message }))
      )
    }

    // Semantic Scholar — free tier, no key needed for basic search
    if (source === 'semantic' || source === 'both') {
      fetches.push(
        searchSemanticScholar(q, pageNum, perPage)
          .then(r => ({ source: 'semantic_scholar', results: r }))
          .catch(err => ({ source: 'semantic_scholar', results: [], error: err.message }))
      )
    }

    const responses = await Promise.all(fetches)

    // Merge and deduplicate by DOI
    const seen = new Set()
    for (const resp of responses) {
      for (const paper of resp.results) {
        const key = paper.doi || paper.title
        if (!seen.has(key)) {
          seen.add(key)
          results.push(paper)
        }
      }
    }

    res.status(200).json({
      query: q,
      page: pageNum,
      per_page: perPage,
      total: results.length,
      results,
      sources: responses.map(r => ({ source: r.source, count: r.results.length, error: r.error })),
    })
  } catch (err) {
    console.error('Search error:', err)
    res.status(500).json({ error: 'Search failed', details: err.message })
  }
}

// ─── OpenAlex ────────────────────────────────────────────────────────────────

async function searchOpenAlex(query, page, perPage) {
  const offset = (page - 1) * perPage
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&filter=is_oa:true&per_page=${perPage}&page=${page}&sort=relevance_score:desc&mailto=annotia@example.com`

  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`OpenAlex API error: ${resp.status}`)

  const data = await resp.json()
  return (data.results || []).map(normalizeOpenAlex)
}

function normalizeOpenAlex(work) {
  const authorList = (work.authorships || [])
    .map(a => a.author?.display_name)
    .filter(Boolean)

  const concepts = (work.concepts || [])
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 5)
    .map(c => c.display_name)

  return {
    source: 'openalex',
    id: work.id,
    doi: work.doi?.replace('https://doi.org/', '') || null,
    title: work.title || 'Untitled',
    authors: authorList,
    journal: work.primary_location?.source?.display_name || null,
    year: work.publication_year || null,
    abstract: work.abstract_inverted_index
      ? reconstructAbstract(work.abstract_inverted_index)
      : null,
    citation_count: work.cited_by_count || 0,
    is_open_access: work.open_access?.is_oa || false,
    oa_url: work.open_access?.oa_url || null,
    pdf_url: work.primary_location?.pdf_url || work.open_access?.oa_url || null,
    type: work.type || 'article',
    concepts,
    published_date: work.publication_date || null,
  }
}

// OpenAlex stores abstracts as inverted indexes — reconstruct to text
function reconstructAbstract(invertedIndex) {
  if (!invertedIndex) return null
  const words = []
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) {
      words[pos] = word
    }
  }
  return words.join(' ')
}

// ─── Semantic Scholar ────────────────────────────────────────────────────────

async function searchSemanticScholar(query, page, perPage) {
  const offset = (page - 1) * perPage
  const fields = 'paperId,externalIds,title,authors,year,abstract,citationCount,isOpenAccess,openAccessPdf,journal,publicationDate,fieldsOfStudy'
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&offset=${offset}&limit=${perPage}&fields=${fields}&openAccessPdf`

  const resp = await fetch(url, {
    headers: { 'Accept': 'application/json' },
  })
  if (!resp.ok) throw new Error(`Semantic Scholar API error: ${resp.status}`)

  const data = await resp.json()
  return (data.data || []).map(normalizeSemanticScholar)
}

function normalizeSemanticScholar(paper) {
  return {
    source: 'semantic_scholar',
    id: paper.paperId,
    doi: paper.externalIds?.DOI || null,
    title: paper.title || 'Untitled',
    authors: (paper.authors || []).map(a => a.name),
    journal: paper.journal?.name || null,
    year: paper.year || null,
    abstract: paper.abstract || null,
    citation_count: paper.citationCount || 0,
    is_open_access: paper.isOpenAccess || false,
    oa_url: paper.openAccessPdf?.url || null,
    pdf_url: paper.openAccessPdf?.url || null,
    type: 'article',
    concepts: paper.fieldsOfStudy || [],
    published_date: paper.publicationDate || null,
  }
}
