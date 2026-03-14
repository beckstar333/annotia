export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { doi, metadata } = req.body;

  if (!doi || !metadata) {
    return res.status(400).json({ error: 'Missing DOI or metadata' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  const { title, authors, journal, year, abstract } = metadata;

  const prompt = `You are a research summarization assistant for Annotia, a scholarly paper discussion platform. Your job is to generate clear, accurate, accessible summaries of academic papers for a mixed audience of researchers, clinicians, and intelligent non-specialists.

Here is the paper to summarize:

TITLE: ${title}
AUTHORS: ${authors}
JOURNAL: ${journal}
YEAR: ${year}
DOI: ${doi}
ABSTRACT: ${abstract}

Generate a structured JSON summary with exactly these fields. Be accurate, specific, and draw only from what is stated or clearly implied in the abstract. Do not invent details.

{
  "whatStudied": "2-3 sentences explaining the research question in plain language. What problem or question were the researchers trying to answer?",
  "howStudied": "2-3 sentences explaining the methodology in plain language. How did they design the study, what data did they collect, how many participants/samples if mentioned?",
  "whatFound": "2-3 sentences summarizing the key findings in plain language. What did they discover or conclude?",
  "confidence": "2-3 sentences evaluating how much weight to give these findings. Comment on study design, sample size if mentioned, whether it is peer reviewed or a preprint, and any limitations visible from the abstract.",
  "jargonTerms": [
    {"term": "Technical term 1", "definition": "Plain language definition in 1-2 sentences"},
    {"term": "Technical term 2", "definition": "Plain language definition in 1-2 sentences"},
    {"term": "Technical term 3", "definition": "Plain language definition in 1-2 sentences"},
    {"term": "Technical term 4", "definition": "Plain language definition in 1-2 sentences"}
  ],
  "realWorld": "2-3 sentences explaining what these findings mean outside the lab. What are the practical implications for clinicians, policymakers, patients, or the public?",
  "whyCare": "1-2 sentences explaining why this matters to a non-specialist. What is the broader significance?"
}

Respond with ONLY the JSON object. No preamble, no explanation, no markdown code fences.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err.error?.message || 'Anthropic API error' });
    }

    const result = await response.json();
    const rawText = result.content[0].text.trim();
    const clean = rawText.replace(/```json|```/g, '').trim();
    const summaryData = JSON.parse(clean);

    return res.status(200).json({ summaryData });

  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to generate summary' });
  }
}
