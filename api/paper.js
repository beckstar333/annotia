// Fetch a single paper by DOI from OpenAlex + Semantic Scholar
// GET /api/paper?doi=10.1234/example

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { doi } = req.query
  if (!doi) {
    return res.status(400).json({ error: 'DOI parameter is required' })
  }

  // Clean DOI — strip URL prefix if provided
  const cleanDoi = doi.replace(/^https?:\/\/doi\.org\//i, '').trim()

  try {
    // Try both sources in parallel
    const [oaResult, ssResult] = await Promise.all([
      fetchFromOpenAlex(cleanDoi).catch(() => null),
      fetchFromSemanticScholar(cleanDoi).catch(() => null),
    ])

    // Prefer OpenAlex (more metadata), fall back to Semantic Scholar
    const paper = oaResult || ssResult

    if (!paper) {
      return res.status(404).json({ error: 'Paper not found. Check the DOI and try again.' })
    }

    // Merge: use Semantic Scholar abstract if OpenAlex doesn't have one
    if (!paper.abstract && ssResult?.abstract) {
      paper.abstract = ssResult.abstract
    }

    // Merge citation count (use higher)
    if (ssResult && ssResult.citation_count > (paper.citation_count || 0)) {
      paper.citation_count = ssResult.citation_count
    }

    res.status(200).json({ paper })
  } catch (err) {
    console.error('Paper fetch error:', err)
    res.status(500).json({ error: 'Failed to fetch paper', details: err.message })
  }
}

async function fetchFromOpenAlex(doi) {
  const url = `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}?mailto=annotia@example.com`
  const resp = await fetch(url)
  if (!resp.ok) return null

  const work = await resp.json()

  const authorList = (work.authorships || [])
    .map(a => a.author?.display_name)
    .filter(Boolean)

  const concepts = (work.concepts || [])
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 5)
    .map(c => c.display_name)

  return {
    source: 'openalex',
    doi: doi,
    title: work.title || 'Untitled',
    authors: authorList,
    journal: work.primary_location?.source?.display_name || null,
    year: work.publication_year || null,
    abstract: work.abstract_inverted_index
      ? reconstructAbstract(work.abstract_inverted_index)
      : null,
    citation_count: work.cited_by_count || 0,
    is_open_access: work.open_access?.is_oa || false,
    is_preprint: work.type === 'preprint',
    oa_url: work.open_access?.oa_url || null,
    pdf_url: work.primary_location?.pdf_url || work.open_access?.oa_url || null,
    type: work.type || 'article',
    concepts,
    published_date: work.publication_date || null,
    subject: concepts[0] || null,
    license_url: work.primary_location?.license || null,
  }
}

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

async function fetchFromSemanticScholar(doi) {
  const fields = 'paperId,externalIds,title,authors,year,abstract,citationCount,isOpenAccess,openAccessPdf,journal,publicationDate,fieldsOfStudy'
  const url = `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}?fields=${fields}`

  const resp = await fetch(url, {
    headers: { 'Accept': 'application/json' },
  })
  if (!resp.ok) return null

  const paper = await resp.json()

  return {
    source: 'semantic_scholar',
    doi: doi,
    title: paper.title || 'Untitled',
    authors: (paper.authors || []).map(a => a.name),
    journal: paper.journal?.name || null,
    year: paper.year || null,
    abstract: paper.abstract || null,
    citation_count: paper.citationCount || 0,
    is_open_access: paper.isOpenAccess || false,
    is_preprint: false,
    oa_url: paper.openAccessPdf?.url || null,
    pdf_url: paper.openAccessPdf?.url || null,
    type: 'article',
    concepts: paper.fieldsOfStudy || [],
    published_date: paper.publicationDate || null,
    subject: paper.fieldsOfStudy?.[0] || null,
  }
}
