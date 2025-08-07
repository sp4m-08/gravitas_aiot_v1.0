const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { GoogleGenerativeAI } = require('@google/generative-ai');
//require('dotenv').config();

const app = express();
const port = 3000;

app.use(cors());
app.use(bodyParser.json());

//initialising gemini api
const apikey = 'AIzaSyCok3rpe8lu5QruBF5J0fBlP28yFClqYIA' //replace with gemini api key ' '
const genAI = new GoogleGenerativeAI(apikey); 
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
console.log("Attempting to use API Key:",apikey); 

let latestData = {};

//endpoint to receive sensor data from ESP8266
app.post('/api/data', (req, res) => {
  latestData = req.body;
  console.log('Received sensor data:', latestData);
  res.status(200).send('Data received');
});

//endpoint to ask AI a question based on latest sensor data
app.post('/api/ask-ai', async (req, res) => {
  const userQuery = req.body.query;

  if (!latestData || Object.keys(latestData).length === 0) {
    return res.status(400).send({ error: 'No health data available yet.' });
  }

  const prompt = `You are a health assistant AI. Here is the user health data:
- Heart Rate: ${latestData.heartRate}
- SpO₂: ${latestData.spo2}
- Temp: ${latestData.temperature}°C
- Steps: ${latestData.steps}
- Time: ${latestData.time}

User asked: "${userQuery}"

Provide a helpful and concise response based on this health context.`;
  
//   const prompt = `
// You are an intelligent assistant. Use the user's sensor data only if it's relevant to the question. 
// If the question is unrelated to health, answer normally without referencing health data.

// Available user health data:
// - Heart Rate: ${latestData.heartRate}
// - SpO₂: ${latestData.spo2}
// - Temperature: ${latestData.temperature}°C
// - Steps: ${latestData.steps}
// - Time: ${latestData.time}

// User's Question: "${userQuery}"

// Give a helpful, concise, and relevant response.
// `;


  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    console.log('AI Response:', text);
    res.send({ response: text });
  } catch (err) {
    console.error('Gemini API Error:', err);
    res.status(500).send({ error: 'AI request failed', details: err.message });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});