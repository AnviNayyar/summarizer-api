// Path: SUMMARIZER-API/server.js
// This Microservice securely handles PDF downloading, text extraction, and Gemini API calls.

const express = require('express');
const axios = require('axios');
const pdfParser = require('pdf-parse');
const { GoogleGenAI } = require('@google/genai');
require('dotenv').config(); 

const app = express();
const PORT = process.env.PORT || 3001;

// --- CONFIGURATION ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY }); 

if (!GEMINI_API_KEY) {
    console.error("FATAL: GEMINI_API_KEY is missing. Please check your .env file.");
    process.exit(1);
}

// Middleware to parse incoming JSON requests
app.use(express.json({ limit: '10mb' })); 

// CORS setup: Essential for your frontend to call this API
app.use((req, res, next) => {
    // Allows ANY origin to call this API
    res.header('Access-Control-Allow-Origin', '*'); 
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    next();
});

// --- CORE LOGIC FUNCTIONS ---

/**
 * Downloads the PDF from the external URL (e.g., UPSC) and extracts its raw text content.
 */
async function extractTextFromPdf(url) {
    // Axios fetches the PDF data as a raw buffer (binary data)
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    // pdf-parse library converts the binary data into a readable text string
    const data = await pdfParser(response.data);
    return data.text; 
}

/**
 * Calls Gemini to summarize the text into a structured JSON format.
 */
async function generateSummary(text, title) {
    // The prompt is engineered to provide context and demand specific JSON structure
    const prompt = `Act as an expert UPSC analyst. Summarize the text into Gist (2 sentences, positive tone), 5 Key Points (HTML bullet list), and Relevance (who needs this document). Respond ONLY in structured JSON format. Document Text: ${text.slice(0, 15000)}`;

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
            responseMimeType: "application/json",
        }
    });

    // Clean and parse the JSON response from the LLM (removes markdown fences)
    const jsonString = response.text.trim().replace(/```json\n|\n```/g, '').trim();
    return JSON.parse(jsonString);
}


// --- API ENDPOINT: POST /summarize ---
// This is the endpoint the frontend will call: POST /summarize

app.post('/summarize', async (req, res) => {
    const { url, title } = req.body;

    if (!url || !title) {
        return res.status(400).json({ error: "Missing 'url' or 'title' in request body." });
    }
    
    // NOTE: This is where database/cache logic would be implemented in a full version.

    try {
        // 1. Download and Extract Text (This accesses the external UPSC PDF)
        const documentText = await extractTextFromPdf(url);

        // 2. Generate Summary using LLM
        const summary = await generateSummary(documentText, title);

        // 3. Send the final, clean JSON response to the front-end
        res.status(200).json(summary);

    } catch (error) {
        console.error("Microservice Error Processing:", error.message);
        res.status(500).json({ 
            error: "Failed to process document or generate summary.",
            details: error.message.includes('JSON') ? "AI structure error or malformed response." : "External PDF access failure."
        });
    }
});


// --- Start Server ---
app.listen(PORT, () => {
    console.log(`Microservice running on port ${PORT}.`);
    console.log(`Local Endpoint: http://localhost:${PORT}/summarize`);
});
