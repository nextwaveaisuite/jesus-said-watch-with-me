// File: api/generatePrayer.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', used: 'none' });
  }

  try {
    const {
      query,
      level,
      topics = [],
      count = 10,
      previousText = '',
      style = 'pastoral',
      temperature = 0.95,
    } = req.body || {};

    if (!query || !level) {
      return res.status(400).json({ error: 'Missing query or level', used: 'none' });
    }

    const toneGuide = {
      pastoral: 'Warm, shepherding, empathetic; anchored in Scripture.',
      warfare: 'Bold, authoritative, faith-filled; never accusatory.',
      contemplative: 'Quiet, reverent, reflective; imagery and listening.',
      encourager: 'Upbeat, hope-filled, promise-forward.',
    };

    const sys = `
You are a Spirit-led Christian prayer writer. Write alive, personal, varied prayers.
Voice: ${toneGuide[style] || toneGuide.pastoral}
Use KJV for Scripture quotes. Avoid headings. Vary cadence. Avoid cliché and repetition.
Return ONLY strict JSON.
`.trim();

    const userPrompt = `
User Request: "${query}"
Level: ${level}
Topics: ${topics.length ? topics.join(', ') : 'general'}

Previous Content (continue thread, avoid repetition):
${previousText || '(none)'}

Produce EXACTLY ${count} paragraphs, 2–4 sentences each, addressing God, specific to this situation.
Vary verbs, imagery, and structure. Avoid repeating openings or phrasing from earlier content.
Include up to 2 congruent KJV Scripture snippets (short excerpts ok).

Return JSON ONLY:
{
  "paragraphs": [ "string", ... (${count} total) ],
  "scriptures": [ { "ref": "Book N:N", "text": "KJV snippet" } ]
}
`.trim();

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      // No key available in this environment
      const fb = buildLocalFallback(count);
      return res.status(200).json({ ...fb, used: 'fallback_no_key' });
    }

    const completionRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: Number.isFinite(temperature) ? temperature : 0.95,
        presence_penalty: 0.7,
        frequency_penalty: 0.6,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
      }),
    });

    if (!completionRes.ok) {
      const text = await completionRes.text().catch(() => '');
      console.error('OpenAI upstream error:', text);
      const fb = buildLocalFallback(count);
      return res.status(200).json({ ...fb, used: 'fallback_upstream_error' });
    }

    const completion = await completionRes.json();
    const raw = completion?.choices?.[0]?.message?.content || '{}';

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.error('JSON parse error:', e, raw?.slice?.(0, 200));
      const fb = buildLocalFallback(count);
      return res.status(200).json({ ...fb, used: 'fallback_upstream_error' });
    }

    let paragraphs = Array.isArray(data.paragraphs) ? data.paragraphs : [];
    let scriptures = Array.isArray(data.scriptures) ? data.scriptures : [];

    paragraphs = sanitizeParagraphs(paragraphs);
    if (previousText) {
      paragraphs = filterNearDuplicates(paragraphs, previousText, 0.82);
    }
    paragraphs = enforceCount(paragraphs, count);
    scriptures = sanitizeScriptures(scriptures).slice(0, 2);

    return res.status(200).json({ paragraphs, scriptures, used: 'ai' });
  } catch (err) {
    console.error('Server error:', err);
    const fb = buildLocalFallback(10);
    return res.status(200).json({ ...fb, used: 'fallback_server_error' });
  }
}

/* ----------------------- Helpers ----------------------- */

function buildLocalFallback(count = 10) {
  const pool = [
    'Father, meet this need with Your nearness; steady every thought and breathe peace over this heart.',
    'Lord Jesus, draw close and guide each step; let Your counsel be a lamp in this dark hallway.',
    'Spirit of God, quiet the worry and anchor this heart in Your faithful love and sovereign care.',
    'Merciful Father, speak wisdom that settles the storm inside and orders the path before them.',
    'Prince of Peace, let Your calm prevail; cradle this situation in Your everlasting arms.',
    'Good Shepherd, carry the weary and restore hope; let courage rise with every promise remembered.',
    'Holy God, guard their mind and fill their breath with Your presence; teach them to rest in You.',
    'Faithful Lord, turn heaviness into a holy hunger for Your voice; make obedience light and joyful.',
    'Abba, surround them with favor like a shield; open doors that no one can shut.',
    'Jesus, be their song in the night and their strength in the morning; keep them in perfect peace.',
  ];
  const paragraphs = Array.from({ length: count }, (_, i) => pool[i % pool.length]);
  const scriptures = [
    { ref: 'Philippians 4:6–7', text: 'Be careful for nothing; but in every thing by prayer and supplication with thanksgiving let your requests be made known unto God...' },
  ];
  return { paragraphs, scriptures };
}

function sanitizeParagraphs(arr) {
  return (arr || [])
    .map(s => (typeof s === 'string' ? s : String(s || '')))
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function sanitizeScriptures(list) {
  return (list || [])
    .map(x => ({
      ref: truncate((x && x.ref) || '', 80),
      text: truncate((x && x.text) || '', 240),
    }))
    .filter(x => x.ref && x.text);
}

function truncate(s, n) {
  if (!s) return s;
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function filterNearDuplicates(paragraphs, previousText, threshold = 0.82) {
  const prev = normalize(previousText);
  const seen = new Set();
  const out = [];
  for (const p of paragraphs) {
    const np = normalize(p);
    if (seen.has(np)) continue;
    const sim = similarity(prev, np);
    if (sim >= threshold) continue;
    seen.add(np);
    out.push(p);
  }
  return out;
}

function normalize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function similarity(a, b) {
  if (!a || !b) return 0;
  const A = new Set(a.split(' '));
  const B = new Set(b.split(' '));
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const u = A.size + B.size - inter || 1;
  return inter / u;
}

function enforceCount(paragraphs, count) {
  let out = paragraphs.slice(0, count);
  const need = count - out.length;
  if (need > 0) {
    const pads = [
      'Father, let Your kindness lead and Your wisdom steady every step taken from here.',
      'Lord, wrap this heart in Your peace and write courage across every tomorrow.',
      'God of hope, turn this valley into a vineyard; bring fruit from the waiting.',
    ];
    for (let i = 0; i < need; i++) out.push(pads[i % pads.length]);
  }
  return out;
}
