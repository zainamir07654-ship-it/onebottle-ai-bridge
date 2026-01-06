import { GoogleGenAI } from "@google/genai";

function parseDataUrl(dataUrl) {
  const m = String(dataUrl || "").match(/^data:(.+);base64,(.*)$/);
  if (!m) return null;
  return { mimeType: m[1], base64: m[2] };
}

export default async function handler(req, res) {
  // CORS (helps local dev)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    const { imageDataUrl } = req.body || {};
    if (!imageDataUrl || typeof imageDataUrl !== "string") {
      return res.status(400).json({ error: "Missing imageDataUrl" });
    }

    const parsed = parseDataUrl(imageDataUrl);
    if (!parsed) {
      return res.status(400).json({
        error: "imageDataUrl must be a data URL like data:image/jpeg;base64,...",
      });
    }

    const ai = new GoogleGenAI({});

    // Gemini 3 Flash (preview)
    const model = "gemini-3-flash-preview";

    const prompt =
      "Estimate the water level in this bottle/container on a scale of 0–100%.\n" +
      "\n" +
      "Use this method BEFORE deciding the number:\n" +
      "1) Find the container TOP and BOTTOM.\n" +
      "2) Find the liquid surface line (waterline/meniscus).\n" +
      "3) Use stable landmarks (labels/logos/handle joints/printed text) as anchors.\n" +
      "4) Consider tapering: height may not equal volume.\n" +
      "5) Consider camera angle and glare.\n" +
      "\n" +
      "Return ONLY JSON exactly like this (no extra keys): {\"percent_full\": 0}\n" +
      "percent_full must be an INTEGER between 0 and 100.";

    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            { inlineData: { mimeType: parsed.mimeType, data: parsed.base64 } },
          ],
        },
      ],
      config: {
        // Keep it stable / measurement-like
        temperature: 0.2,
        // Encourage more careful reasoning (supported by Gemini 3)
        thinkingConfig: { thinkingLevel: "medium" },

        // Force JSON output (best-effort)
        responseMimeType: "application/json",

        maxOutputTokens: 80,
      },
    });

    // Parse JSON safely
    let obj;
    try {
      obj = JSON.parse(response.text);
    } catch {
      // If it returns non-JSON for any reason, try to extract a number
      const m = String(response.text).match(/(\d{1,3})/);
      if (!m) throw new Error("Model did not return JSON or a number");
      obj = { percent_full: Number(m[1]) };
    }

    const percent = Number(obj?.percent_full);
    if (!Number.isFinite(percent)) throw new Error("percent_full missing");
    if (percent < 0 || percent > 100) throw new Error("percent_full out of range");

    return res.status(200).json({ percent_full: Math.round(percent) });
  } catch (err) {
    return res.status(500).json({
      error: "Gemini request failed",
      detail: err?.message || String(err),
    });
  }
}