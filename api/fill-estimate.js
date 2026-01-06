// api/fill-estimate.js
// POST body: { imageDataUrl: "data:image/jpeg;base64,..." }
// Returns: { percent_full: 0..100, fill_fraction: 0..1 }

function parseDataUrl(dataUrl) {
  const m = String(dataUrl || "").match(/^data:(.+?);base64,(.+)$/);
  if (!m) return null;
  return { mimeType: m[1], data: m[2] };
}

function extractPercent(text) {
  const m = String(text || "").match(/(\d{1,3})/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

async function callGemini({ apiKey, mimeType, data, prompt }) {
  const model = "gemini-3-flash-preview";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data } },
        ],
      },
    ],
    generationConfig: {
      // IMPORTANT: give enough budget so Gemini can "think" AND still output the integer
      maxOutputTokens: 128,
      temperature: 0.2,
      // Helps keep output short/one-line
      stopSequences: ["\n"],
    },
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  const json = await resp.json().catch(() => null);
  return { ok: resp.ok, status: resp.status, json };
}

export default async function handler(req, res) {
  // CORS for local dev
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing GEMINI_API_KEY on Vercel" });

    const { imageDataUrl } = req.body || {};
    if (!imageDataUrl || typeof imageDataUrl !== "string") {
      return res.status(400).json({ error: "Missing imageDataUrl" });
    }

    const parsed = parseDataUrl(imageDataUrl);
    if (!parsed) {
      return res.status(400).json({ error: "imageDataUrl must be data:image/...;base64,..." });
    }

    // Detailed prompt (Gemini-style reasoning) but still forces a single integer output
    const detailedPrompt = `
Estimate how full the liquid container is in the photo on a 0–100 scale.

Use this method BEFORE deciding the number:
1) Locate the container TOP and BOTTOM.
2) Locate the liquid surface line (waterline/meniscus).
3) Use stable landmarks (labels/logos/handle joints/printed text) as anchors.
4) Consider container geometry: tapering means height ≠ volume.
5) Consider camera angle and glare; compensate conservatively.

Return ONLY a single integer from 0 to 100.
No words. No % sign. No extra characters.
`.trim();

    // Ultra-simple fallback prompt (if Gemini returns no visible text)
    const fallbackPrompt = `
Return ONLY one integer from 0 to 100 for how full the container is.
No words. No symbols.
`.trim();

    // 1) Try detailed prompt
    let r = await callGemini({
      apiKey,
      mimeType: parsed.mimeType,
      data: parsed.data,
      prompt: detailedPrompt,
    });

    if (!r.ok) {
      return res.status(r.status).json({ error: "Gemini API error", detail: r.json });
    }

    let text =
      r.json?.candidates?.[0]?.content?.parts
        ?.map((p) => p?.text)
        .filter(Boolean)
        .join(" ") || "";

    // If Gemini spent tokens on "thinking" and returned no text, retry with fallback prompt
    if (!text) {
      r = await callGemini({
        apiKey,
        mimeType: parsed.mimeType,
        data: parsed.data,
        prompt: fallbackPrompt,
      });

      if (!r.ok) {
        return res.status(r.status).json({ error: "Gemini API error", detail: r.json });
      }

      text =
        r.json?.candidates?.[0]?.content?.parts
          ?.map((p) => p?.text)
          .filter(Boolean)
          .join(" ") || "";
    }

    const percent = extractPercent(text);
    if (percent == null) {
      return res.status(500).json({
        error: "Could not parse percent from Gemini output",
        raw: text,
        detail: r.json,
      });
    }

    return res.status(200).json({
      percent_full: percent,
      fill_fraction: percent / 100,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Serverless function crashed",
      detail: err?.message || String(err),
    });
  }
}