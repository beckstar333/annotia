// Search for papers across OpenAlex, Semantic Scholar, PubMed, Europe PMC, and CORE
// GET /api/search?q=keyword&page=1&per_page=10

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { q, page = '1', per_page = '10' } = req.query

  if (!q || !q.trim()) {
    return res.status(400).json({ error: 'Query parameter "q" is required' })
  }

  const pageNum = parseInt(page, 10)
  const perPage = Math.min(parseInt(per_page, 10), 25)

  try {
    // Search all sources in parallel
    const fetches = [
      searchOpenAlex(q, pageNum, perPage)
        .then(r => ({ source: 'openalex', results: r }))
        .catch(err => ({ source: 'openalex', results: [], error: err.message })),

      searchSemanticScholar(q, pageNum, perPage)
        .then(r => ({ source: 'semantic_scholar', results: r }))
        .catch(err => ({ source: 'semantic_scholar', results: [], error: err.message })),

      searchPubMed(q, pageNum, perPage)
        .then(r => ({ source: 'pubmed', results: r }))
        .catch(err => ({ source: 'pubmed', results: [], error: err.message })),

      searchEuropePMC(q, pageNum, perPage)
        .then(r => ({ source: 'europe_pmc', results: r }))
        .catch(err => ({ source: 'europe_pmc', results: [], error: err.message })),
    ]

    const responses = await Promise.all(fetches)

    // Merge and deduplicate by DOI, then by title similarity
    const seen = new Set()
    const results = []
    for (const resp of responses) {
      for (const paper of resp.results) {
        const key = paper.doi || paper.title?.toLowerCase().slice(0, 60)
        if (key && !seen.has(key)) {
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
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&filter=is_oa:true&per_page=${perPage}&page=${page}&sort=relevance_score:desc&mailto=annotia@example.com`
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`OpenAlex: ${resp.status}`)
  const data = await resp.json()
  return (data.results || []).map(normalizeOpenAlex)
}

function normalizeOpenAlex(work) {
  const authorList = (work.authorships || []).map(a => a.author?.display_name).filter(Boolean)
  const concepts = (work.concepts || []).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5).map(c => c.display_name)
  return {
    source: 'openalex',
    id: work.id,
    doi: work.doi?.replace('https://doi.org/', '') || null,
    title: work.title || 'Untitled',
    authors: authorList,
    journal: work.primary_location?.source?.display_name || null,
    year: work.publication_year || null,
    abstract: work.abstract_inverted_index ? reconstructAbstract(work.abstract_inverted_index) : null,
    citation_count: work.cited_by_count || 0,
    is_open_access: work.open_access?.is_oa || false,
    oa_url: work.open_access?.oa_url || null,
    pdf_url: work.primary_location?.pdf_url || work.open_access?.oa_url || null,
    type: work.type || 'article',
    concepts,
    published_date: work.publication_date || null,
  }
}

function reconstructAbstract(invertedIndex) {
  if (!invertedIndex) return null
  const words = []
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) words[pos] = word
  }
  return words.join(' ')
}

// ─── Semantic Scholar ────────────────────────────────────────────────────────

async function searchSemanticScholar(query, page, perPage) {
  const offset = (page - 1) * perPage
  const fields = 'paperId,externalIds,title,authors,year,abstract,citationCount,isOpenAccess,openAccessPdf,journal,publicationDate,fieldsOfStudy'
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&offset=${offset}&limit=${perPage}&fields=${fields}&openAccessPdf`
  const resp = await fetch(url, { headers: { 'Accept': 'application/json' } })
  if (!resp.ok) throw new Error(`Semantic Scholar: ${resp.status}`)
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

// ─── PubMed / NCBI ──────────────────────────────────────────────────────────

async function searchPubMed(query, page, perPage) {
  // Step 1: Search for PMIDs
  const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}+AND+open+access[filter]&retmax=${perPage}&retstart=${(page - 1) * perPage}&sort=relevance&retmode=json`
  const searchResp = await fetch(searchUrl)
  if (!searchResp.ok) throw new Error(`PubMed search: ${searchResp.status}`)
  const searchData = await searchResp.json()
  const ids = searchData.esearchresult?.idlist || []
  if (ids.length === 0) return []

  // Step 2: Fetch details
  const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`
  const fetchResp = await fetch(fetchUrl)
  if (!fetchResp.ok) throw new Error(`PubMed fetch: ${fetchResp.status}`)
  const fetchData = await fetchResp.json()
  const results = []

  for (const id of ids) {
    const article = fetchData.result?.[id]
    if (!article || article.error) continue

    const doi = (article.elocationid || '').replace('doi: ', '').replace('pii: ', '') || null
    const authors = (article.authors || []).map(a => a.name)

    results.push({
      source: 'pubmed',
      id: `pmid:${id}`,
      doi: doi && doi.startsWith('10.') ? doi : null,
      title: article.title || 'Untitled',
      authors,
      journal: article.fulljournalname || article.source || null,
      year: article.pubdate?.split(' ')[0] || null,
      abstract: null, // PubMed summary doesn't include abstracts
      citation_count: 0,
      is_open_access: true,
      oa_url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
      pdf_url: null,
      type: 'article',
      concepts: [],
      published_date: article.sortpubdate || null,
    })
  }
  return results
}

// ─── Europe PMC ──────────────────────────────────────────────────────────────

async function searchEuropePMC(query, page, perPage) {
  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}+OPEN_ACCESS:y&format=json&pageSize=${perPage}&page=${page}&sort=RELEVANCE`
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Europe PMC: ${resp.status}`)
  const data = await resp.json()
  return (data.resultList?.result || []).map(normalizeEuropePMC)
}

function normalizeEuropePMC(article) {
  return {
    source: 'europe_pmc',
    id: article.id || article.pmid,
    doi: article.doi || null,
    title: article.title || 'Untitled',
    authors: article.authorString ? article.authorString.split(', ') : [],
    journal: article.journalTitle || null,
    year: article.pubYear || null,
    abstract: article.abstractText || null,
    citation_count: article.citedByCount || 0,
    is_open_access: article.isOpenAccess === 'Y',
    oa_url: article.fullTextUrlList?.fullTextUrl?.[0]?.url || (article.doi ? `https://doi.org/${article.doi}` : null),
    pdf_url: null,
    type: article.pubType || 'article',
    concepts: article.meshHeadingList?.meshHeading?.map(m => m.descriptorName) || [],
    published_date: article.firstPublicationDate || null,
  }
}
