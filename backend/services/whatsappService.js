const twilio = require('twilio');

function formatWhatsAppNumber(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  return digits.startsWith('91') ? `whatsapp:+${digits}` : `whatsapp:+91${digits}`;
}

async function sendWhatsApp({ to, message }) {
  const provider = (process.env.WHATSAPP_PROVIDER || 'twilio').toLowerCase();
  if (!to || !message) return { skipped: true };

  if (provider === 'cloud') {
    if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) return { skipped: true };

    const response = await fetch(`https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: String(to).replace(/\D/g, ''),
        type: 'text',
        text: { body: message }
      })
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(`WhatsApp Cloud API failed: ${details}`);
    }
    return response.json();
  }

  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_WHATSAPP_FROM) {
    return { skipped: true };
  }

  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  return client.messages.create({
    from: process.env.TWILIO_WHATSAPP_FROM,
    to: formatWhatsAppNumber(to),
    body: message
  });
}

module.exports = { sendWhatsApp };