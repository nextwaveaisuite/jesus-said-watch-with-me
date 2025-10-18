// File: api/generatePrayer.js
// Advanced AI generation with tone control + robust anti-repetition (CommonJS)

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini"; // adjust if you prefer

// ---------- Text utils ----------
function normalize(s = "") {
  return s
    .toLowerCase()
    .replace(/[“”"’']/g, "'")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function leadingBigram(s) {
  const t = normalize(s).split(" ");
  return t.slice(0, 2).join(" ");
}
function trigrams(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length - 2; i++) out.push(tokens.slice(i, i + 3).join(" "));
  return out;
}
function trigramJaccard(a, b) {
  const A = trigrams(normalize(a).split(" "));
  const B = trigrams(normalize(b).split(" "));
  if (!A.length || !B.length) return 0;
  const setA = new Set(A);
  const setB = new Set(B);
  let inter = 0;
  for (const x of setA) if (setB.has(x)) inter++;
  return inter / (setA.size + setB.size - inter);
}
function tooSimilar(a, b) {
  // Stricter than before
  return trigramJaccard(a, b) >= 0.5 || leadingBigram(a) === leadingBigram(b);
}
function filterDuplicates(lines) {
  const kept = [];
  for (const line of lines) {
    if (!line) continue;
    const clash = kept.some(k => tooSimilar(k, line));
    if (!clash) kept.push(line);
  }
  return kept;
}
function uniqueStarts(lines) {
  const used = new Set();
  return lines.map(p => {
    const lb = leadingBigram(p);
    if (!used.has(lb)) {
      used.add(lb);
      return p;
    }
    // If opening bigram repeats, swap a different soft opener
    const softOpeners = [
      "Father,",
      "Lord,",
      "Gracious God,",
      "Abba Father,",
      "Holy One,"
    ];
    const repl = softOpeners[Math.floor(Math.random() * softOpeners.length)];
    return `${repl} ${p}`;
  });
}
function stripBannedPhrases(lines) {
  const banned = [
    "i stand in the gap and plead for mercy and breakthrough",
    "i ask that you would move in power",
    "lord we just",
  ];
  return lines.map(p => {
    let x = p;
    for (const phrase of banned) {
      const re = new RegExp(phrase, "ig");
      x = x.replace(re, "");
    }
    return x.replace(/\s{2,}/g, " ").trim();
  });
}
function sanitizeParagraphs(lines, targetCount) {
  let out = lines.map(s => (s || "").trim()).filter(Boolean);
  out = stripBannedPhrases(out);
  out = filterDuplicates(out);
  out = uniqueStarts(out);
  // pad/trim
  while (out.length < targetCount) {
    out.push(
      "Father, anchor my heart in Your truth and let Your peace rule in this unfolding situation."
    );
  }
  return out.slice(0, targetCount);
}

const TONE_GUIDE = {
  gentle: "gentle, pastoral, calm, comforting; emphasize peace and reassurance",
  intercession: "standing in the gap with faith and persistence for others; specific names and needs",
  warfare: "bold, authoritative, Scripture-rich; resist the enemy, renounce lies, declare victory in Christ",
  thanksgiving: "overflowing gratitude and remembrance of God's faithfulness and past mercies",
  lament: "honest sorrow, reverent lament, comfort from God's nearness; tender and compassionate",
  celebration: "joyful praise and celebration of God's goodness; exultant and uplifting",
  confession: "humble repentance, honesty about sin, longing for cleansing and renewal",
  guidance: "seeking wisdom, clarity, discernment, alignment with God's will"
};

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { query, level, topics = [], count = 10, previousText = "", tone = "gentle" } = body;

    if (!query || !level) {
      return res.status(400).json({ error: "Missing 'query' or 'level'." });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      // graceful fallback for local/dev so the UI keeps working
      return res.status(200).json({
        paragraphs: sanitizeParagraphs(
          new Array(count).fill(
            "Heavenly Father, draw near and let Your peace settle over this need; guide every thought and steady every step."
          ),
          count
        ),
        scriptures: [{ ref: "James 1:5", text: "If any of you lack wisdom, let him ask of God..." }]
      });
    }

    const toneDesc = TONE_GUIDE[tone] || TONE_GUIDE.gentle;

    // --- System persona ---
    const systemPrompt = `
You are an intercessory prayer writer filled with biblical wisdom and empathy.
Write prayers that feel alive, emotionally intelligent, and spiritually guided.
Use the King James Version (KJV) for all Scripture quotations/snippets (public domain).
Vary sentence openings; avoid starting multiple paragraphs with the same first two words.
Avoid repetitive filler (e.g., "I pray", "I ask" repeated across paragraphs).
Each paragraph must be distinct, vivid, and theologically sound.
`;

    // --- User instruction with strong anti-dup constraints ---
    // We explicitly show the model examples of repeated strings to avoid
    const userPrompt = `
User Request: "${query}"
Level: ${level}
Topics: ${topics.join(", ") || "general"}
Preferred Tone: ${tone} (${toneDesc})

Previous Content (do NOT repeat any sentences or phrasing from this; build forward only):
${previousText || "(none)"}

Important constraints:
- Produce exactly ${count} paragraphs, each 2–4 sentences, forming a continuous, deepening prayer.
- NEVER reuse the same sentence or clause from earlier in this response or from the "Previous Content".
- Vary the first words of each paragraph. No two paragraphs may share the same first two words.
- Avoid repeating stock phrases like "I stand in the gap and plead for mercy and breakthrough" or "Lord, we just".
- Speak specifically to the user's situation; weave in details naturally from the User Request without over-quoting it.
- Use vivid but reverent imagery and ensure theological soundness.
- Include up to 2 congruent KJV Scripture snippets, at the end, as JSON.

Return STRICT JSON only:
{
  "paragraphs": ["...", "..."],
  "scriptures": [{"ref":"...", "text":"..."}]
}
`;

    // --- Call OpenAI ---
    const upstream = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 1.0,
        top_p: 0.92,
        frequency_penalty: 1.1, // stronger than before
        presence_penalty: 0.9,
        max_tokens: 1700,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      })
    });

    if (!upstream.ok) {
      const txt = await upstream.text().catch(() => "");
      console.error("OpenAI upstream error:", upstream.status, txt);
      return res.status(502).json({ error: "LLM upstream error", details: txt.slice(0, 400) });
    }

    const json = await upstream.json().catch(() => ({}));
    const content = json?.choices?.[0]?.message?.content || "{}";

    // --- Parse JSON permissively ---
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      const match = content.match(/\{[\s\S]*\}$/);
      if (match) { try { parsed = JSON.parse(match[0]); } catch {} }
    }

    let paragraphs = Array.isArray(parsed?.paragraphs)
      ? parsed.paragraphs.map(p => (p || "").trim()).filter(Boolean)
      : [];

    // Server-side sanitation & anti-dup
    paragraphs = sanitizeParagraphs(paragraphs, count);

    const scriptures = Array.isArray(parsed?.scriptures)
      ? parsed.scriptures.filter(s => s && s.ref && s.text)
      : [];

    return res.status(200).json({ paragraphs, scriptures });

  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ error: "Server error" });
  }
};
