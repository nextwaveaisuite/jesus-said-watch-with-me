// File: api/generatePrayer.js
// Vercel Node serverless function (CommonJS)

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini"; // change if you prefer another model

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Vercel can pass req.body as object or raw string
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const { query, level, topics = [], count = 10, previousText = "" } = body;

    if (!query || !level) {
      return res.status(400).json({ error: "Missing 'query' or 'level'." });
    }

    // === Prompt engineering: push for empathy, variety, and specificity ===
    const systemPrompt = [
      "You are a spiritual prayer writer gifted in empathy, biblical wisdom, and emotional insight.",
      "Write prayers that feel alive, personalized, and deeply connected to the user's situation.",
      "Use varied sentence structures, vivid imagery, and avoid repeating opening phrases.",
      "Do NOT use headings like 'Adoration' or 'Petition'—let the prayer flow naturally.",
      "Use KJV for Scripture snippets (public domain).",
      "Return STRICT JSON only (no commentary outside JSON)."
    ].join(" ");

    const userPrompt = `
User Request: "${query}"
Level: ${level}
Topics: ${topics.join(", ") || "general"}

Previous Content (continue/deepen if present):
${previousText || "(none)"}

TASK:
- Generate exactly ${count} short-to-medium paragraphs (2–4 sentences each), all unique and non-repetitive.
- Speak directly to the user's situation and emotions; sound pastoral, tender, faith-filled, and specific.
- Vary vocabulary and rhythm; avoid repeating common phrases like "I pray" over and over.
- Include up to 2 congruent KJV Scripture snippets as: [{"ref": "...", "text": "..."}].

Return ONLY this JSON:
{
  "paragraphs": ["...", "..."],
  "scriptures": [{"ref":"...", "text":"..."}]
}
`.trim();

    const apiKey = process.env.OPENAI_API_KEY;

    // If no API key → graceful fallback so frontend stays functional
    if (!apiKey) {
      const fallback = {
        paragraphs: new Array(count).fill(
          "Father, draw near and meet this need according to Your wisdom and steadfast love; steady every heart and guide every step."
        ),
        scriptures: [
          { ref: "James 1:5", text: "If any of you lack wisdom, let him ask of God..." }
        ]
      };
      return res.status(200).json(fallback);
    }

    // Call OpenAI
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
        max_tokens: 1400,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
        // Avoid response_format for broad compatibility; we'll parse manually below.
      })
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      console.error("OpenAI upstream error:", upstream.status, text);
      return res.status(502).json({ error: "LLM upstream error", details: text.slice(0, 400) });
    }

    const completion = await upstream.json().catch(() => ({}));
    const content = completion?.choices?.[0]?.message?.content || "{}";

    // Parse JSON out of the model reply
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      // If the model added stray text, attempt to pull the last JSON object
      const match = content.match(/\{[\s\S]*\}$/);
      if (match) {
        try { parsed = JSON.parse(match[0]); } catch {}
      }
    }

    const paragraphs = Array.isArray(parsed?.paragraphs) ? parsed.paragraphs.filter(Boolean) : [];
    const scriptures = Array.isArray(parsed?.scriptures) ? parsed.scriptures.filter(s => s && s.ref && s.text) : [];

    const safe = {
      paragraphs: paragraphs.length ? paragraphs.slice(0, count) :
        new Array(count).fill("Lord, let Your peace and wisdom surround this situation; draw near and speak to every need."),
      scriptures
    };

    return res.status(200).json(safe);

  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ error: "Server error" });
  }
};
