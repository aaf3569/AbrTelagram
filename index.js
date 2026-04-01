const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// function to send message
async function sendTelegramMessage(chatId, text) {
  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
    }),
  });

  const data = await response.json();
  console.log("Telegram response:", data);
}

// webhook endpoint
app.post("/api/telegram-webhook", async (req, res) => {
  const update = req.body;

  console.log("Incoming update:", JSON.stringify(update, null, 2));

  const chatId = update?.message?.chat?.id;
  const text = update?.message?.text || "";

  if (text.startsWith("/start") && chatId) {
    console.log("chat_id:", chatId);
    console.log("text:", text);

    await sendTelegramMessage(chatId, "Connected successfully ✅");
  }

  res.sendStatus(200);
});

// test route
app.get("/", (req, res) => {
  res.send("Bot server is running");
});

// start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});