require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const express = require('express');
const cors = require('cors'); 
const bodyParser = require('body-parser');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

const apikey = process.env.API_KEY;
const genAI = new GoogleGenerativeAI(apikey);
// Corrected model name to 1.5-flash
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

let latestData = {};
let lastAIResponse = "";

app.post('/data', async (req, res) => {
  latestData = req.body || {};
  console.log('Received sensor data:', latestData);

  const { error } = await supabase
    .from('sensor_readings')
    .insert([{
      heart_rate:    latestData.heartRate,
      spo2:          latestData.spo2,
      temperature:   latestData.temperature,
      pressure:      latestData.pressure,
      steps:         latestData.steps,
      fall_detected: latestData.fall_detected,
      location:      latestData.location, // Added location field
      reading_time:  latestData.time
    }]);

  if (error) console.error('Supabase insert error:', error);
  res.status(200).send('Data received');
});

app.get('/data', (req, res) => {
  res.json(latestData || {});
});

app.post('/ask-ai', async (req, res) => {
  const userQuery = (req.body && req.body.query) ? String(req.body.query) : "";

  if (!latestData || Object.keys(latestData).length === 0) {
    const { data, error } = await supabase
      .from('sensor_readings')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (data) {
      latestData = {
        heartRate:     data.heart_rate,
        spo2:          data.spo2,
        temperature:   data.temperature,
        pressure:      data.pressure,
        steps:         data.steps,
        fall_detected: data.fall_detected,
        location:      data.location, // Added location to fallback
        time:          data.reading_time
      };
    }
  }

  if (!latestData || Object.keys(latestData).length === 0) {
    return res.status(400).send({ error: 'No health data available yet.' });
  }
  if (!userQuery.trim()) {
    return res.status(400).send({ error: 'Empty query' });
  }

  // Updated prompt to include Location context
  const prompt = `You are a health assistant AI. Here is the user health data:  
- Heart Rate: ${latestData.heartRate} bpm
- SpO2: ${latestData.spo2}%
- Temp: ${latestData.temperature}°C
- Steps: ${latestData.steps}
- Location: ${latestData.location || "Unknown"} 
- Fall Detected: ${latestData.fall_detected ? "YES - CRITICAL" : "No"}
- Time: ${latestData.time}

User asked: "${userQuery}"
Provide helpful and concise health advice based on the data.
Note: If a fall was detected, prioritize safety advice. Mention the user's location (${latestData.location}) if suggesting help.`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    lastAIResponse = text;
    console.log('AI Response:', text);
    res.send({ response: text });
  } catch (err) {
    console.error('Gemini API Error:', err);
    res.status(500).send({ error: 'AI request failed' });
  }
});

app.get('/last-ai', (req, res) => {
  res.json({ response: lastAIResponse || "" });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Server running at http://localhost:${port}`);
});