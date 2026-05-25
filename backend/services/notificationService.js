const { emitToAdmins, emitToUser } = require('../config/socket');
const { sendEmail } = require('./emailService');
const { sendWhatsApp } = require('./whatsappService');
const Notification = require('../models/Notification');

async function createNotification(entry) {
  await Notification.create(entry).catch(() => undefined);
}

async function notifyAdmins(event, payload) {
  const title = String(payload?.title || event.replace(/[:_]/g, ' ')).replace(/\b\w/g, (match) => match.toUpperCase());
  const message = String(payload?.message || payload?.bookingId || payload?.subject || 'New admin notification');
  await createNotification({
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

  if (userId) {
    await createNotification({
      type: socketEvent || 'booking:customer-notification',
      title: String(payload?.title || subject || 'Booking update'),
      message: String(payload?.message || whatsappMessage || subject || 'Booking update'),
      recipientRole: 'user',
      recipientUserId: userId,
      metadata: payload || {}
    });
  }

  if (userId && socketEvent) {
    emitToUser(userId, socketEvent, payload);
  }
}

function getStatusLabel(status) {
  return String(status || '').trim() || 'Updated';
}

function buildStatusNotification(booking, status, note) {
  const statusLabel = getStatusLabel(status);
  const reason = note ? `<p><strong>Note:</strong> ${note}</p>` : '';
  const html = `
    <div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.6">
      <h2 style="margin:0 0 12px">Booking ${statusLabel}</h2>
      <p>Your booking <strong>${booking.bookingId}</strong> is now marked as <strong>${statusLabel}</strong>.</p>
      <p><strong>Pickup:</strong> ${booking.pickupLocation || 'N/A'}<br/>
      <strong>Drop:</strong> ${booking.dropLocation || 'N/A'}</p>
      ${reason}
      <p>If you have questions, reply to this message or contact our support team.</p>
    </div>`;

  return {
    subject: `Booking ${statusLabel} - ${booking.bookingId}`,
    html,
    whatsappMessage: `Booking ${booking.bookingId} is now ${statusLabel}${note ? `: ${note}` : '.'}`,
    adminMessage: `${booking.bookingId} moved to ${statusLabel}`,
    statusLabel
  };
}

async function notifyBookingStatusChange({
  booking,
  status,
  note = '',
  userId = null,
  socketEvent = 'booking:status-updated',
  adminEvent = 'booking:updated',
  adminTitle = 'Booking updated'
}) {
  const { subject, html, whatsappMessage, adminMessage, statusLabel } = buildStatusNotification(booking, status, note);

  await notifyAdmins(adminEvent, {
    title: adminTitle,
    message: adminMessage,
    bookingId: booking.bookingId,
    status: statusLabel,
    paymentStatus: booking.paymentStatus,
    note: note || undefined
  });

  await notifyCustomer({
    userId: userId || booking.user?._id || booking.user || null,
    email: booking.email,
    phone: booking.phone,
    subject,
    html,
    whatsappMessage,
    socketEvent,
    payload: {
      bookingId: booking.bookingId,
      status: statusLabel,
      paymentStatus: booking.paymentStatus,
      note: note || undefined,
      title: `Booking ${statusLabel}`,
      message: `${booking.bookingId} is now ${statusLabel}`
    }
  });
}

module.exports = { notifyAdmins, notifyCustomer, notifyBookingStatusChange };