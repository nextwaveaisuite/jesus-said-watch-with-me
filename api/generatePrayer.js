// File: api/generatePrayer.js
// Advanced AI generation with tone control + anti-repetition filters (CommonJS)

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini"; // adjust as desired

// --- Simple similarity guard to reduce duplicates ---
function isSimilar(a, b) {
  if (!a || !b) return false;
  const sa = a.toLowerCase().split(/\s+/);
  const sb = b.toLowerCase().split(/\s+/);
  const setA = new Set(sa);
  const setB = new Set(sb);
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const ratio = intersection.size / Math.max(setA.size, setB.size);
  return ratio > 0.65;
}
function filterDuplicates(lines) {
  const result = [];
  for (const line of lines) {
    if (!result.some(l => isSimilar(l, line))) result.push(line);
  }
  return result;
}

// Tone presets infused into the prompt for style control
const TONE_GUIDE = {
  gentle: "gentle, pastoral, calm, comforting; emphasize peace and reassurance",
  intercession: "standing in the gap, pleading with faith and persistence for others",
  warfare: "bold, authoritative, scripture-rich; resist the enemy, renounce lies, declare victory in Christ",
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
        paragraphs: new Array(count).fill(
          "Heavenly Father, draw near and let Your peace settle over this need; guide every thought and steady every step."
        ),
        scriptures: [{ ref: "James 1:5", text: "If any of you lack wisdom, let him ask of God..." }]
      });
    }

    const toneDesc = TONE_GUIDE[tone] || TONE_GUIDE.gentle;

    // ---- System persona ----
    const systemPrompt = `
You are an intercessory prayer writer filled with biblical wisdom and empathy.
Write prayers that feel alive, emotionally intelligent, and spiritually guided.
Use the King James Version (KJV) for all Scripture quotations/snippets (public domain).
Vary sentence openers; do not start multiple paragraphs with the same first two words.
Avoid repetitive filler (e.g., repeating "I pray", "I ask" across paragraphs).
Each paragraph should stand alone yet build a deepening flow of communion with God.
`;

    // ---- User instruction with tone & context ----
    const userPrompt = `
User Request: "${query}"
Level: ${level}
Topics: ${topics.join(", ") || "general"}
Preferred Tone: ${tone} (${toneDesc})

Previous Content (continue/deepen if present):
${previousText || "(none)"}

TASK:
- Produce exactly ${count} paragraphs, each 2–4 sentences, forming a continuous, deepening prayer.
- Make each paragraph unique in tone and vocabulary; avoid reusing phrases across paragraphs.
- Write in the style described by the Preferred Tone.
- Speak specifically to the user’s situation; use details from the User Request when natural.
- Use vivid but reverent imagery, and ensure theological soundness.
- Include up to 2 congruent KJV Scripture snippets, at the end, as JSON.

Return STRICT JSON only:
{
  "paragraphs": ["...", "..."],
  "scriptures": [{"ref":"...", "text":"..."}]
}
`;

    // ---- Call OpenAI Chat Completions ----
    const upstream = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.95,
        top_p: 0.9,
        frequency_penalty: 0.85, // push away from repeated phrasing
        presence_penalty: 0.7,   // encourage novel ideas
        max_tokens: 1600,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      })
    });

    if (!upstream.ok) {
      const txt = await upstream.text().catch(()=> "");
      console.error("OpenAI upstream error:", upstream.status, txt);
      return res.status(502).json({ error: "LLM upstream error", details: txt.slice(0, 400) });
    }

    const json = await upstream.json().catch(()=> ({}));
    const content = json?.choices?.[0]?.message?.content || "{}";

    // ---- Parse JSON response leniently ----
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      const match = content.match(/\{[\s\S]*\}$/);
      if (match) { try { parsed = JSON.parse(match[0]); } catch {} }
    }

    let paragraphs = Array.isArray(parsed?.paragraphs)
      ? parsed.paragraphs.map(p => (p||"").trim()).filter(Boolean)
      : [];

    // De-duplicate paragraphs (remove near-identicals)
    paragraphs = filterDuplicates(paragraphs);

    // Pad or trim to desired count
    while (paragraphs.length < count) {
      paragraphs.push("Father, anchor my heart in Your truth and let Your peace rule in this unfolding situation.");
    }
    if (paragraphs.length > count) {
      paragraphs = paragraphs.slice(0, count);
    }

    const scriptures = Array.isArray(parsed?.scriptures)
      ? parsed.scriptures.filter(s => s && s.ref && s.text)
      : [];

    return res.status(200).json({ paragraphs, scriptures });

  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ error: "Server error" });
  }
};
