const express = require('express');
const cors = require('cors'); 
const bodyParser = require('body-parser');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const port = 3000;

app.use(cors());
app.use(bodyParser.json());


app.use(express.static(path.join(__dirname, 'public')));


const apikey = 'your-api-key';
const genAI = new GoogleGenerativeAI(apikey);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

console.log("Attempting to use API Key:", apikey); 

let latestData = {};
let lastAIResponse = "";


app.post('/data', (req, res) => {
  latestData = req.body || {};

  
  if (latestData.pressure !== undefined) {
    latestData.pressure = Number(latestData.pressure).toFixed(2);
  }

  
  if (latestData.temperature !== undefined) {
    latestData.temperature = Number(latestData.temperature).toFixed(2);
  }

  console.log('Received sensor data:', latestData);
  res.status(200).send('Data received');
});


app.get('/data', (req, res) => {
  res.json(latestData || {});
});

// AI
app.post('/ask-ai', async (req, res) => {
  const userQuery = (req.body && req.body.query) ? String(req.body.query) : "";

  if (!latestData || Object.keys(latestData).length === 0) {
    return res.status(400).send({ error: 'No health data available yet.' });
  }
  if (!userQuery.trim()) {
    return res.status(400).send({ error: 'Empty query' });
  }

  const prompt = `You are a health assistant AI. Here is the latest user health data:
- Heart Rate: ${latestData.heartRate} bpm
- SpO₂: ${latestData.spo2}%
- Steps: ${latestData.steps}
- Pressure: ${latestData.pressure} hPa
- Ambient Temperature: ${latestData.temperature}°C
- Time: ${latestData.time}


User asked: "${userQuery}"`;

  try {
    const result = await model.generateContent(prompt);

    const response = result?.response;
    const text = typeof response?.text === 'function'
      ? response.text()
      : (response?.candidates?.[0]?.content?.parts?.map(p => p.text).join(' ') || 'No response');

    lastAIResponse = text;
    console.log('AI Response:', text);
    res.send({ response: text });
  } catch (err) {
    console.error('Gemini API Error:', err);
    res.status(500).send({ error: 'AI request failed', details: err.message });
  }
});

//  AI response
app.get('/last-ai', (req, res) => {
  res.json({ response: lastAIResponse || "" });
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


app.listen(port, "0.0.0.0", () => {
  console.log(` Server running at http://localhost:${port}`);
});