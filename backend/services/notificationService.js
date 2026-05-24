const { emitToAdmins, emitToUser } = require('../config/socket');
const { sendEmail } = require('./emailService');
const { sendWhatsApp } = require('./whatsappService');

async function notifyAdmins(event, payload) {
  emitToAdmins(event, payload);
  return payload;
}

async function notifyCustomer({ userId, email, phone, subject, html, whatsappMessage, socketEvent, payload }) {
  if (email && subject && html) {
    await sendEmail({ to: email, subject, html }).catch(() => undefined);
  }

  if (phone && whatsappMessage) {
    await sendWhatsApp({ to: phone, message: whatsappMessage }).catch(() => undefined);
  }

  if (userId && socketEvent) {
    emitToUser(userId, socketEvent, payload);
  }
}

module.exports = { notifyAdmins, notifyCustomer };