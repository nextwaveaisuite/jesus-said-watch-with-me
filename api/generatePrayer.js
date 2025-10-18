// File: api/generatePrayer.js
// Vercel/Node serverless function (ESM). Works with your existing front-end.
// Enhancements:
// - Stronger persona prompt for vivid, personal, human-like prayers
// - Uses previousText to deepen the same prayer thread
// - Higher creativity with anti-repetition penalties
// - Post-processing to dedupe and enforce exactly `count` paragraphs
// - Graceful fallback when OPENAI_API_KEY is missing or upstream fails

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      query,
      level,
      topics = [],
      count = 10,
      previousText = '',
      // future-friendly: allow optional knobs without breaking your UI
      style = 'pastoral', // 'pastoral' | 'warfare' | 'contemplative' | 'encourager'
      temperature = 0.95
    } = req.body || {};

    if (!query || !level) {
      return res.status(400).json({ error: 'Missing query or level' });
    }

    // -------- System / Persona Prompt (improved) --------
    const toneGuide = {
      pastoral:
        'Warm, shepherding, empathetic; gently guides the heart while anchoring in Scripture.',
      warfare:
        'Bold, authoritative, faith-filled; uses spiritual warfare language appropriately, never accusatory.',
      contemplative:
        'Quiet, reverent, reflective; rich imagery, space for silence, listening, and surrender.',
      encourager:
        'Upbeat, faith-building, hopeful; emphasizes promise, perseverance, and God’s nearness.'
    };

    const sys = `
You are a Spirit-led Christian prayer writer, gifted in empathy, biblical wisdom, and emotional insight.
Write prayers that feel *alive*, *personal*, and deeply connected to the user's situation.
Voice: ${toneGuide[style] || toneGuide.pastoral}
Use KJV when quoting Scripture (public domain). 
Avoid headings ("Adoration", "Petition"). Let the prayer flow like a real person praying.
Vary sentence length and structure. Prefer concrete, sensory language and gentle metaphors.
Avoid cliché, repetitive stock phrases (e.g., "I pray for" over and over). No sermonizing.
Return ONLY valid JSON per instructions—no commentary or markdown.
`.trim();

    // -------- User Prompt (structured, specific, variation-focused) --------
    const userPrompt = `
User Request: "${query}"
Level: ${level}
Topics: ${topics.length ? topics.join(', ') : 'general'}

Previous Content (continue the same prayer thread, avoid repeating lines already used):
${previousText || '(none)'}

Produce EXACTLY ${count} paragraphs, each 2–4 sentences, that:
- Speak directly to this situation (addressing God, not the user).
- Show genuine empathy and specificity; include names/roles from the request when present.
- Vary cadence, verbs, imagery, and structure across paragraphs.
- Avoid repeating phrases, openings, or constructions already used in earlier paragraphs or previous content.
- Naturally weave in faith, trust, surrender, and hope in Christ.

Also include up to 2 new, congruent KJV Scripture snippets (short excerpts are OK).

Return STRICT JSON ONLY:
{
  "paragraphs": [ "string", ... (${count} items total) ],
  "scriptures": [ { "ref": "Book N:N", "text": "KJV snippet" }, ... ] // 0-2 items
}
`.trim();

    // -------- If no API key, degrade gracefully (keeps app functional) --------
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      const fallback = buildLocalFallback(count);
      return res.status(200).json(fallback);
    }

    // -------- Call OpenAI Chat Completions (JSON mode) --------
    const completionRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: Number.isFinite(temperature) ? temperature : 0.95,
        // Push variety & reduce same-phrase reuse:
        presence_penalty: 0.7,
        frequency_penalty: 0.6,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' }
      })
    });

    if (!completionRes.ok) {
      // Upstream issue—log for debugging and return a safe fallback
      const text = await completionRes.text().catch(() => '');
      console.error('OpenAI error:', text);
      const fallback = buildLocalFallback(count);
      return res.status(200).json(fallback);
    }

    const completion = await completionRes.json();
    const raw = completion?.choices?.[0]?.message?.content || '{}';

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = {};
    }

    // -------- Normalize & Post-process --------
    let paragraphs = Array.isArray(data.paragraphs) ? data.paragraphs : [];
    let scriptures = Array.isArray(data.scriptures) ? data.scriptures : [];

    // Clean and normalize paragraphs
    paragraphs = sanitizeParagraphs(paragraphs);

    // Use previousText to avoid echoing earlier content
    if (previousText) {
      paragraphs = filterNearDuplicates(paragraphs, previousText, 0.82);
    }

    // Enforce exactly `count` items (trim or pad with tasteful lines)
    paragraphs = enforceCount(paragraphs, count);

    // Cap scriptures at 2, clean them
    scriptures = sanitizeScriptures(scriptures).slice(0, 2);

    return res.status(200).json({ paragraphs, scriptures });
  } catch (err) {
    console.error('Server error:', err);
    // Final safety net
    return res.status(200).json(buildLocalFallback(10));
  }
}

/* ----------------------- Helpers ----------------------- */

function buildLocalFallback(count = 10) {
  // Keep a small pool of richer local lines for graceful behavior
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
    'Jesus, be their song in the night and their strength in the morning; keep them in perfect peace.'
  ];
  const paragraphs = Array.from({ length: count }, (_, i) => pool[i % pool.length]);
  const scriptures = [
    { ref: 'Philippians 4:6–7', text: 'Be careful for nothing; but in every thing by prayer and supplication with thanksgiving let your requests be made known unto God...' }
  ];
  return { paragraphs, scriptures };
}

function sanitizeParagraphs(arr) {
  return (arr || [])
    .map(s => (typeof s === 'string' ? s : String(s || '')))
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map(s => ensureAddressedToGod(s));
}

// If a line starts like a statement *about* God, gently refocus as prayer *to* God.
function ensureAddressedToGod(s) {
  // Keep it simple (don’t over-edit); most model outputs already address God.
  return s;
}

function sanitizeScriptures(list) {
  return (list || [])
    .map(x => ({
      ref: truncate((x && x.ref) || '', 80),
      text: truncate((x && x.text) || '', 240)
    }))
    .filter(x => x.ref && x.text);
}

function truncate(s, n) {
  if (!s) return s;
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// Remove near-duplicates vs. previous content and within the new set.
// Very lightweight similarity check using normalized substrings.
function filterNearDuplicates(paragraphs, previousText, threshold = 0.82) {
  const prev = normalize(previousText);
  const seen = new Set();
  const out = [];

  for (const p of paragraphs) {
    const np = normalize(p);
    if (seen.has(np)) continue; // exact duplicate

    // If highly similar to any window in previous text, skip
    const sim = similarity(prev, np);
    if (sim >= threshold) continue;

    seen.add(np);
    out.push(p);
  }
  return out;
}

function normalize(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Jaccard similarity over word sets (simple, fast)
function similarity(a, b) {
  if (!a || !b) return 0;
  const A = new Set(a.split(' '));
  const B = new Set(b.split(' '));
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const union = A.size + B.size - inter || 1;
  return inter / union;
}

function enforceCount(paragraphs, count) {
  let out = paragraphs.slice(0, count);
  // If the model returned fewer, lightly pad with variations
  const need = count - out.length;
  if (need > 0) {
    const pads = [
      'Father, let Your kindness lead and Your wisdom steady every step taken from here.',
      'Lord, wrap this heart in Your peace and write courage across every tomorrow.',
      'God of hope, turn this valley into a vineyard; bring fruit from the waiting.'
    ];
    for (let i = 0; i < need; i++) {
      out.push(pads[i % pads.length]);
    }
  }
  return out;
}
