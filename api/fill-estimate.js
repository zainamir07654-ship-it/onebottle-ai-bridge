import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const FillEstimate = z.object({
  fill_fraction: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  needs_manual: z.boolean(),
  reason: z.string(),
});

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    const { imageDataUrl, referenceDataUrl } = req.body || {};
    if (!imageDataUrl || typeof imageDataUrl !== "string") {
  return res.status(400).json({ error: "Missing imageDataUrl" });
}

if (!referenceDataUrl || typeof referenceDataUrl !== "string") {
  return res.status(400).json({ error: "Missing referenceDataUrl (full bottle photo)" });
}

    const response = await openai.responses.parse({
  model: "gpt-4o-mini",
  input: [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text:
            "You will receive TWO images of the SAME transparent bottle/container.\n" +
            "Image A is the bottle when FULL (reference). Image B is the bottle NOW.\n" +
            "Task: estimate how full Image B is as a fraction of the FULL reference.\n" +
            "Use the visible waterline height relative to the container height.\n" +
            "If the waterline in Image B is not clearly visible OR the bottle seems different, set needs_manual=true and confidence <= 0.5.\n" +
            "Return fill_fraction between 0 and 1.\n" +
            "Do NOT guess 0.5 unless the waterline supports it.\n" +
            "Output MUST match the schema."
        },
        { type: "input_image", image_url: referenceDataUrl }, // Image A: FULL
        { type: "input_image", image_url: imageDataUrl }       // Image B: NOW
      ],
    },
  ],
  text: { format: zodTextFormat(FillEstimate, "fill_estimate") },
});