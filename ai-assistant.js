// EFH AI Assistant — secure Gemini proxy
// The Gemini API key NEVER reaches the browser. It lives only here, read from
// a Netlify environment variable (Site settings > Environment variables > GEMINI_API_KEY).
// Both admin_dashboard.html and index.html call this same function, sending a
// "mode" (admin/public), a system prompt, live site context, and the message.

const GEMINI_MODEL = 'gemini-1.5-flash'; // gemini-2.5-flash needs billing enabled; 1.5-flash is free tier
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'GEMINI_API_KEY is not set in Netlify environment variables yet.' })
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const message = (payload.message || '').toString().slice(0, 2000);
  const systemPrompt = (payload.systemPrompt || 'You are a helpful assistant.').toString().slice(0, 12000);
  const context = (payload.context || '').toString().slice(0, 12000);
  const history = Array.isArray(payload.history) ? payload.history.slice(-10) : [];

  if (!message) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing message' }) };
  }

  const contents = [];
  history.forEach(function (h) {
    if (h && h.text) {
      contents.push({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: String(h.text).slice(0, 3000) }]
      });
    }
  });
  contents.push({
    role: 'user',
    parts: [{ text: (context ? 'Current live site data:\n' + context + '\n\n' : '') + 'Question: ' + message }]
  });

  const body = {
    contents: contents,
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: { temperature: 0.4, maxOutputTokens: 800 }
  };

  try {
    const resp = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body)
    });
    const data = await resp.json();

    if (!resp.ok) {
      const msg = (data && data.error && data.error.message) || ('Gemini API error (' + resp.status + ')');
      return { statusCode: resp.status, body: JSON.stringify({ error: msg }) };
    }

    const candidate = data.candidates && data.candidates[0];
    const text = candidate && candidate.content && candidate.content.parts && candidate.content.parts[0] && candidate.content.parts[0].text;

    if (!text) {
      // Most common cause: response blocked by safety filters
      const reason = candidate && candidate.finishReason;
      return { statusCode: 200, body: JSON.stringify({ text: "I couldn't generate a reply for that one" + (reason ? ' (' + reason + ')' : '') + ". Try rephrasing?" }) };
    }

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Request to Gemini failed: ' + err.message }) };
  }
};
