require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const twilio = require('twilio');

// -------------------- ENV DEBUG --------------------
console.log("🔍 ENV CHECK:");
console.log("SUPABASE_URL:", process.env.SUPABASE_URL ? "Loaded" : "Missing");
console.log("SUPABASE_KEY:", process.env.SUPABASE_ANON_KEY ? "Loaded" : "Missing");
console.log("TWILIO_SID:", process.env.TWILIO_ACCOUNT_SID ? "Loaded" : "Missing");
console.log("TWILIO_TOKEN:", process.env.TWILIO_AUTH_TOKEN ? "Loaded" : "Missing");
console.log("TWILIO_PHONE:", process.env.TWILIO_PHONE_NUMBER);
console.log("ALERT_PHONE:", process.env.ALERT_PHONE_NUMBER);

// -------------------- SUPABASE --------------------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// -------------------- TWILIO --------------------
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// -------------------- EXPRESS --------------------
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// -------------------- GEMINI --------------------
const genAI = new GoogleGenerativeAI(process.env.API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

// -------------------- GLOBAL STATE --------------------
let latestData = {};
let lastAIResponse = "";
let lastFallTime = 0;

// -------------------- SMS FUNCTION --------------------
async function sendSMSAlert(data) {
  console.log("📨 sendSMSAlert() CALLED");

  try {
    const mapsLink = data.location
      ? `https://www.google.com/maps?q=${encodeURIComponent(data.location)}`
      : "Location unavailable";

    console.log("📤 Preparing SMS...");
    console.log("FROM:", process.env.TWILIO_PHONE_NUMBER);
    console.log("TO:", process.env.ALERT_PHONE_NUMBER);

    const message = await twilioClient.messages.create({
      body: `🚨 EMERGENCY: FALL DETECTED 🚨
Location: ${data.location || "Unknown"}
Map: ${mapsLink}

Vitals:
Heart Rate: ${data.heartRate}
SpO2: ${data.spo2}

Time: ${data.time}`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: process.env.ALERT_PHONE_NUMBER
    });

    console.log("✅ SMS SENT SUCCESSFULLY!");
    console.log("📌 SID:", message.sid);

  } catch (err) {
    console.error("❌ SMS FAILED");
    console.error("Error message:", err.message);
    console.error("Full error:", err);
  }
}

// -------------------- TEST SMS ROUTE --------------------
app.get('/test-sms', async (req, res) => {
  console.log("🧪 TEST SMS TRIGGERED");

  try {
    const message = await twilioClient.messages.create({
      body: "🚀 Test SMS working!",
      from: process.env.TWILIO_PHONE_NUMBER,
      to: process.env.ALERT_PHONE_NUMBER
    });

    console.log("✅ TEST SMS SENT:", message.sid);
    res.send("SMS sent successfully!");
  } catch (err) {
    console.error("❌ TEST SMS ERROR:", err.message);
    res.status(500).send(err.message);
  }
});

// -------------------- RECEIVE DATA --------------------
app.post('/data', async (req, res) => {
  latestData = req.body || {};

  console.log("\n📥 NEW SENSOR DATA RECEIVED:");
  console.log(latestData);

  // ---------------- SUPABASE INSERT ----------------
  const { error } = await supabase
    .from('sensor_readings')
    .insert([{
      heart_rate:    latestData.heartRate,
      spo2:          latestData.spo2,
      temperature:   latestData.temperature,
      pressure:      latestData.pressure,
      steps:         latestData.steps,
      fall_detected: latestData.fall_detected,
      location:      latestData.location,
      reading_time:  latestData.time
    }]);

  if (error) {
    console.error("❌ SUPABASE INSERT ERROR:", error.message);
  } else {
    console.log("✅ Data inserted into Supabase");
  }

  // ---------------- FALL DETECTION ----------------
  console.log("🔍 Fall detected value:", latestData.fall_detected, "Type:", typeof latestData.fall_detected);

  const isFall =
    latestData.fall_detected === true ||
    latestData.fall_detected === "true";

  if (isFall) {
    console.log("🚨 FALL DETECTED!");

    const now = Date.now();
    const diff = now - lastFallTime;

    console.log("⏱ Time since last SMS:", diff, "ms");

    if (diff > 60000) {
      console.log("📩 Cooldown passed → sending SMS");
      await sendSMSAlert(latestData);
      lastFallTime = now;
    } else {
      console.log("⏳ Cooldown active → SMS skipped");
    }
  } else {
    console.log("✅ No fall detected");
  }

  res.status(200).send('Data received');
});

// ---------------- GET DATA ----------------
app.get('/data', (req, res) => {
  console.log("📤 Sending latest data to client");
  res.json(latestData || {});
});

// ---------------- AI ROUTE ----------------
app.post('/ask-ai', async (req, res) => {
  const userQuery = req.body?.query?.toString() || "";

  console.log("🤖 AI Query:", userQuery);

  if (!latestData || Object.keys(latestData).length === 0) {
    console.log("⚠️ No local data → fetching from DB");

    const { data, error } = await supabase
      .from('sensor_readings')
      .select('*')
      .order('reading_time', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      console.log("✅ Data fetched from DB");

      latestData = {
        heartRate:     data.heart_rate,
        spo2:          data.spo2,
        temperature:   data.temperature,
        pressure:      data.pressure,
        steps:         data.steps,
        fall_detected: data.fall_detected,
        location:      data.location,
        time:          data.reading_time
      };
    } else {
      console.error("❌ DB FETCH ERROR:", error?.message);
    }
  }

  if (!latestData || Object.keys(latestData).length === 0) {
    return res.status(400).send({ error: 'No health data available yet.' });
  }

  if (!userQuery.trim()) {
    return res.status(400).send({ error: 'Empty query' });
  }

  const prompt = `Vitals: ${latestData.heartRate} bpm, SpO2: ${latestData.spo2}%.
Fall: ${latestData.fall_detected}.
Location: ${latestData.location}.
Question: ${userQuery}`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    console.log("🤖 AI RESPONSE:", text);

    lastAIResponse = text;
    res.send({ response: text });
  } catch (err) {
    console.error("❌ GEMINI ERROR:", err);
    res.status(500).send({ error: 'AI request failed' });
  }
});

// ---------------- FRONTEND ----------------
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------------- START ----------------
app.listen(port, "0.0.0.0", () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});