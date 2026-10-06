require('dotenv').config({ path: require('path').join(__dirname, '.env') });
async function test() {
    const llmPrompt = "User 'Kavya' just joined. They are a brand new viewer. Give them a funny welcome and tell them to subscribe.";
    const apiUrl = process.env.LLM_API_URL || 'http://127.0.0.1:8080/v1/chat/completions';
    const apiModel = process.env.LLM_MODEL || 'qwen3-0.6b';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: apiModel,
                messages: [
                    { role: "system", content: "You are a witty chat bot for a cricket stream. Generate 1 short, funny Hinglish sentence to greet the user. Include emojis.\nExamples of style:\n- 'Aao bhai, pitch pe swagat hai! 🏏'\n- 'Late kyu aaye? Match toh shuru ho gaya! 😂'\n- 'Naye khiladi ka chat me swagat hai, subscribe thok do! 🔥'\nGenerate a NEW greeting in this exact style based on the user prompt." },
                    { role: "user", content: llmPrompt }
                ],
                temperature: 0.8,
                max_tokens: 1024
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            console.log("Failed HTTP", response.status, await response.text());
            return;
        }
        const data = await response.json();
        console.log("SUCCESS:", data.choices[0].message.content);
    } catch (error) {
        console.error("ERROR:", error.message);
    }
}
test();
