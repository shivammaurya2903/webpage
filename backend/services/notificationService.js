const { emitToAdmins, emitToUser } = require('../config/socket');
const { sendEmail } = require('./emailService');
const { sendWhatsApp } = require('./whatsappService');
const Notification = require('../models/Notification');

async function notifyAdmins(event, payload) {
  const title = String(payload?.title || event.replace(/[:_]/g, ' ')).replace(/\b\w/g, (match) => match.toUpperCase());
  const message = String(payload?.message || payload?.bookingId || payload?.subject || 'New admin notification');
  await Notification.create({
    type: event,
    title,
    message,
    recipientRole: 'admin',
    metadata: payload || {}
  }).catch(() => undefined);
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