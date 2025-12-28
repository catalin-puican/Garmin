import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

export async function transcribe(wavBuffer) {
  try {
    const file = new File([wavBuffer], "audio.wav", {
      type: "audio/wav"
    });

    const text = await groq.audio.transcriptions.create({
      file,
      model: "whisper-large-v3-turbo",  // ⚡ Turbo model (8x faster!)
      response_format: "text",
      language: "en"
    });

    return text.trim();
  } catch (e) {
    console.error("❌ Groq error:", e.message);
    return "";
  }
}