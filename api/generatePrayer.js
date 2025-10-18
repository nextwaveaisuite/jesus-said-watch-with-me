// File: api/generatePrayer.js
// Vercel/Node serverless function
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { query, level, topics = [], count = 10, previousText = '' } = req.body || {};

    // --- Safety: minimal input validation ---
    if (!query || !level) {
      return res.status(400).json({ error: 'Missing query or level' });
    }

    // Build the prompt for paragraphs
    const sys = [
      'You are a Christian prayer-writing assistant.',
      'Write heartfelt, biblically-sound prayers in a warm, pastoral tone.',
      'Use KJV Scripture references (public domain) when quoting.',
      'Do NOT include headers like "Adoration" or "Petition".',
      'Return JSON only. No commentary.'
    ].join(' ');

    const user = {
      query,
      level,
      topics,
      count,
      previousText
    };

    const prompt = `
Return a strict JSON object with:
{
  "paragraphs": string[${count}], // deeply personal, varied, and non-repetitive prayer lines
  "scriptures": [{"ref": string, "text": string}] // optional, 0-3 congruent KJV snippets
}

Guidelines:
- Prayer must reflect this user request: "${query}" (Level ${level})
- Consider topics: ${topics.join(', ') || 'general guidance'}
- Build on previous content (if provided), deepen and vary the language.
- Avoid repeating phrases. Avoid headings. Keep it intimate and Spirit-led.
- Scriptures should be congruent and short (snippets ok, KJV).
Previous so far:
${previousText || '(none)'}
`;

    // --- Call OpenAI (or your chosen LLM) ---
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      // If no key configured, return a simple local-style fallback so the app still works.
      const fallback = {
        paragraphs: new Array(count).fill(
          'Father, draw near and meet this need according to Your wisdom and steadfast love.'
        ),
        scriptures: [
          { ref: 'James 1:5', text: 'If any of you lack wisdom, let him ask of God...' }
        ]
      };
      return res.status(200).json(fallback);
    }

    // Using OpenAI responses via fetch to the Chat Completions API
    const completionRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini', // Good balance of quality/cost; change if you prefer
        temperature: 0.8,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' }
      })
    });

    if (!completionRes.ok) {
      const text = await completionRes.text();
      console.error('OpenAI error:', text);
      return res.status(502).json({ error: 'LLM upstream error' });
    }

    const completion = await completionRes.json();
    const raw = completion?.choices?.[0]?.message?.content || '{}';

    let data;
    try { data = JSON.parse(raw); } catch { data = {}; }

    // Normalize result
    const paragraphs = Array.isArray(data.paragraphs) && data.paragraphs.length
      ? data.paragraphs.slice(0, count)
      : [];
    const scriptures = Array.isArray(data.scriptures) ? data.scriptures : [];

    // Final safety: ensure array, fallback if empty
    const safe = {
      paragraphs: paragraphs.length ? paragraphs : new Array(count).fill(
        'Lord, let Your peace and wisdom prevail in this situation, and guide every step.'
      ),
      scriptures
    };

    return res.status(200).json(safe);

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}
