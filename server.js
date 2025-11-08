// server.js

const express = require('express');
const axios = require('axios');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { recordRequest, getLastNDaysData, getLastNDaysAvgTimeData } = require('./analytics');
require('dotenv').config();

// --- Prompts (same as Python) ---
const PROMPT_NORMAL = `
Based on the user's original query, provide a concise summary in shot form of the following text. Focus only on query releted information mention source url and Answer should be in correct order in timeline.
USER'S QUERY: "{query}"
TEXT TO SUMMARIZE:
---
{context_text}
---
`;
const PROMPT_DEEP = `
As a meticulous research analyst, your task is to synthesize the information from the provided web search results into a maximum detailed and comprehensive report.
**Current Date:** {current_date}.
**VERY IMPORTANT:** Your top priority is to provide information relevant to this current date and the future. If the user's query is about a recurring event (like an exam), you MUST focus on the upcoming or current event.
**User's Original Query:** "{query}"
**Instructions:**
1.You are a researcher who does deep research on the query and explains in detail without leaving any topic and adds as much detail in the explanation as possible which is given in the web page.
2.You do not have to give your opinion, you only have to speak according to the source. You also have to tell in your answers from which source you got the information and you have to give that too.
3.  In the result, give only query related details which are completely different from the topic of the query, ignore them and make a summary in the detailed summary in the order of the timeline. .
**Provided Search Results:**
---
{context_text}
---
`;

// --- Core Search Logic ---
async function searchWebLogic(query, serperApiKey, searchType, numResults) {
    const startTime = Date.now();
    if (!serperApiKey) return { error: "Error: Serper API Key is required." };
    
    numResults = Math.max(1, Math.min(20, numResults));
    searchType = ["search", "news"].includes(searchType) ? searchType : "search";

    try {
        const endpoint = searchType === "news" ? "https://google.serper.dev/news" : "https://google.serper.dev/search";
        const payload = { q: query, num: numResults };
        const headers = { "X-API-KEY": serperApiKey, "Content-Type": "application/json" };
        
        const resp = await axios.post(endpoint, payload, { headers });
        if (resp.status !== 200) return { error: `Error: Search API returned status ${resp.status}.` };

        const results = resp.data[searchType === "news" ? "news" : "organic"] || [];
        if (results.length === 0) return { content: `No ${searchType} results found for '${query}'.` };
        
        const urls = results.map(r => r.link);
        const fetchPromises = urls.map(url => axios.get(url, { timeout: 20000, maxRedirects: 5 }).catch(e => e));
        const responses = await Promise.all(fetchPromises);

        let chunks = [], successfulExtractions = 0;
        for (let i = 0; i < results.length; i++) {
            const meta = results[i];
            const response = responses[i];

            if (response instanceof Error || !response.data) continue;
            
            try {
                const dom = new JSDOM(response.data, { url: meta.link });
                const reader = new Readability(dom.window.document);
                const article = reader.parse();
                if (!article || !article.textContent) continue;

                successfulExtractions++;
                let chunk;
                if (searchType === "news") {
                    const dateIso = meta.date ? new Date(meta.date).toISOString().split('T')[0] : "Unknown";
                    chunk = `## ${meta.title}\n**Source:** ${meta.source || 'Unknown'} | **Date:** ${dateIso}\n**URL:** ${meta.link}\n\n${article.textContent.trim()}\n`;
                } else {
                    const domain = new URL(meta.link).hostname.replace('www.', '');
                    chunk = `## ${meta.title}\n**Domain:** ${domain}\n**URL:** ${meta.link}\n\n${article.textContent.trim()}\n`;
                }
                chunks.push(chunk);
            } catch (e) {
                console.error(`Error processing URL ${meta.link}:`, e);
                continue;
            }
        }
        
        if (chunks.length === 0) return { content: `Found results for '${query}', but couldn't extract content.` };

        const summary = `Successfully extracted content from ${successfulExtractions}/${results.length} results.\n\n---\n\n`;
        const duration = (Date.now() - startTime) / 1000;
        await recordRequest(duration, numResults);
        return { content: summary + chunks.join("\n---\n") };

    } catch (e) {
        console.error("Web search error:", e);
        return { error: `An error occurred during web search: ${e.message}` };
    }
}

// --- Gemini Summarization Logic ---
async function summarizeWithGemini(textToSummarize, query, geminiKey, modelName, researchMode) {
    try {
        const genAI = new GoogleGenerativeAI(geminiKey);
        const model = genAI.getGenerativeModel({ model: modelName });
        const currentDate = new Date().toISOString().split('T')[0];

        const promptTemplate = researchMode === 'deep' ? PROMPT_DEEP : PROMPT_NORMAL;
        
        let prompt = promptTemplate.replace('{query}', query)
                                    .replace('{context_text}', textToSummarize)
                                    .replace('{current_date}', currentDate);

        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text();
    } catch (e) {
        console.error("Gemini error:", e);
        return `\n\n--- ⚠️ Gemini Summarization Failed ---\nError: ${e.message}\nReturning raw text instead.`;
    }
}

// --- Express App ---
const app = express();
app.use(express.json());
app.use(express.static('public')); // Serve frontend files from the 'public' directory

// API endpoint for search and summarize
app.post('/api/search', async (req, res) => {
    const { 
        query, serper_api_key, search_type, num_results, 
        gemini_api_key, gemini_model, research_mode 
    } = req.body;
    
    // API keys can also be read from environment variables as a fallback
    const serperKey = serper_api_key || process.env.SERPER_API_KEY;
    const geminiKey = gemini_api_key || process.env.GEMINI_API_KEY;

    const { content: scrapedText, error } = await searchWebLogic(query, serperKey, search_type, num_results);
    
    if (error) {
        return res.status(500).json({ result: error });
    }

    if (geminiKey && scrapedText) {
        const summarizedText = await summarizeWithGemini(scrapedText, query, geminiKey, gemini_model, research_mode);
        if (summarizedText.includes("⚠️ Gemini Summarization Failed")) {
            return res.json({ result: scrapedText + summarizedText });
        } else {
            return res.json({ result: summarizedText });
        }
    }
    
    res.json({ result: scrapedText });
});

// API endpoint for analytics
app.get('/api/analytics', async (req, res) => {
    try {
        const [requestsData, avgTimeData] = await Promise.all([
            getLastNDaysData(14),
            getLastNDaysAvgTimeData(14)
        ]);
        res.json({ requestsData, avgTimeData });
    } catch (e) {
        res.status(500).json({ error: "Failed to fetch analytics data." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

// Export the app for Vercel
module.exports = app;
