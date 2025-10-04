// Path: SUMMARIZER-API/server.cjs
// This Microservice securely handles PDF downloading, text extraction, and Gemini API calls.

const express = require('express');
const axios = require('axios');
const pdfParser = require('pdf-parse');
// Note: We use the CommonJS syntax (require) which is now supported 
// because we are forcing this file to run as .cjs
const { GoogleGenAI } = require('@google/genai'); 
require('dotenv').config(); 

const app = express();

// --- CRITICAL DEPLOYMENT FIXES ---
// 1. Use environment variable PORT provided by Railway, default to 3001 locally.
const PORT = process.env.PORT || 3001; 
// 2. Set HOST to 0.0.0.0, required for Railway/Docker to expose the port correctly.
const HOST = '0.0.0.0'; 
// --- END CRITICAL FIXES ---

// --- CONFIGURATION ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
// Ensure your Railway Variable is named GEMINI_API_KEY
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY }); 

if (!GEMINI_API_KEY) {
    console.error("FATAL: GEMINI_API_KEY is missing. Please check your environment variables.");
    // In production, we exit to prevent starting without the key
    process.exit(1); 
}

// Middleware to parse incoming JSON requests
app.use(express.json({ limit: '10mb' })); 

// CORS setup: Essential for your frontend to call this API
app.use((req, res, next) => {
    // Allows ANY origin to call this API (for hackathon/testing)
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

app.post('/summarize', async (req, res) => {
    const { url, title } = req.body;

    if (!url || !title) {
        return res.status(400).json({ error: "Missing 'url' or 'title' in request body." });
    }
    
    try {
        // 1. Download and Extract Text 
        const documentText = await extractTextFromPdf(url);

        // 2. Generate Summary using LLM
        const summary = await generateSummary(documentText, title);

        // 3. Send the final, clean JSON response to the front-end
        res.status(200).json(summary);

    } catch (error) {
        // Log the full error to Railway logs for debugging
        console.error("Microservice Error Processing:", error); 
        res.status(500).json({ 
            error: "Failed to process document or generate summary.",
            details: error.message.includes('JSON') ? "AI structure error or malformed response." : "External PDF access failure."
        });
    }
});


// --- Start Server ---
app.listen(PORT, HOST, () => {
    // This is the message you should see in your Railway logs if successful
    console.log(`Microservice running successfully on http://${HOST}:${PORT}`);
});
