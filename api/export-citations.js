// GET /api/export-citations?user_id=xxx&format=apa|mla|bibtex
// Returns formatted citations for a user's saved papers

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { user_id, format = 'apa' } = req.query
  if (!user_id) {
    return res.status(400).json({ error: 'user_id is required' })
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  // Check Pro status
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_pro')
    .eq('id', user_id)
    .single()

  if (!profile?.is_pro) {
    return res.status(403).json({ error: 'Pro subscription required for citation export' })
  }

  // Fetch saved papers
  const { data: saved } = await supabase
    .from('saved_papers')
    .select('paper:papers(doi, title, authors, journal, year)')
    .eq('user_id', user_id)
    .order('created_at', { ascending: false })

  if (!saved || saved.length === 0) {
    return res.status(200).json({ citations: '', count: 0 })
  }

  const papers = saved.map(s => s.paper).filter(Boolean)
  let citations = ''

  if (format === 'bibtex') {
    citations = papers.map((p, i) => {
      const key = (p.authors || 'unknown').split(',')[0].trim().split(' ').pop() + (p.year || '')
      return `@article{${key}_${i},
  title={${p.title || ''}},
  author={${p.authors || ''}},
  journal={${p.journal || ''}},
  year={${p.year || ''}},
  doi={${p.doi || ''}}
}`
    }).join('\n\n')
  } else if (format === 'mla') {
    citations = papers.map(p => {
      const authors = p.authors || 'Unknown'
      const title = p.title || 'Untitled'
      const journal = p.journal || ''
      const year = p.year || ''
      return `${authors}. "${title}." ${journal ? `*${journal}*, ` : ''}${year}.${p.doi ? ` doi:${p.doi}.` : ''}`
    }).join('\n\n')
  } else {
    // APA format (default)
    citations = papers.map(p => {
      const authors = p.authors || 'Unknown'
      const year = p.year || 'n.d.'
      const title = p.title || 'Untitled'
      const journal = p.journal || ''
      return `${authors} (${year}). ${title}. ${journal ? `*${journal}*. ` : ''}${p.doi ? `https://doi.org/${p.doi}` : ''}`
    }).join('\n\n')
  }

  res.status(200).json({ citations, count: papers.length, format })
}
