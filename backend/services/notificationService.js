const { emitToAdmins, emitToUser } = require('../config/socket');
const { sendEmail } = require('./emailService');
const { sendWhatsApp } = require('./whatsappService');
const Notification = require('../models/Notification');

function trimText(value) {
  return String(value || '').trim();
}

function buildBookingContext(booking = {}) {
  const tripType = trimText(booking.tripType || booking.selectedPackage);
  const normalizedTripType = tripType.toLowerCase();
  const serviceType = /rent|rental|local-package|airport-transfer|multi-day-tour/.test(normalizedTripType)
    ? 'car rental'
    : 'ride booking';

  return {
    serviceType,
    serviceLabel: serviceType === 'car rental' ? 'Car rental' : 'Ride',
    tripType: tripType || 'Ride',
    vehicle: trimText(booking.selectedCar || booking.vehicleName || booking.vehicleId || 'Vehicle') || 'Vehicle'
  };
}

function buildEventKey(event, payload = {}) {
  const parts = [event, payload.bookingId, payload.invoiceId, payload.status, payload.customerId || payload.userId].map(trimText).filter(Boolean);
  return parts.join(':');
}

async function createNotification(entry) {
  const eventKey = trimText(entry.eventKey || '');
  if (eventKey) {
    const existing = await Notification.findOne({ eventKey }).lean();
    if (existing) return existing;
  }

  const payload = {
    ...entry,
    isRead: Boolean(entry.isRead),
    readAt: entry.readAt || (entry.isRead ? new Date() : null)
  };

  try {
    return await Notification.create(payload);
  } catch (error) {
    if (error?.code === 11000 && eventKey) {
      return Notification.findOne({ eventKey }).lean();
    }

    throw error;
  }
}

function emitNotification(notification, eventName, payload, room = 'admins') {
  const envelope = {
    notification,
    eventName,
    payload
  };

  if (room === 'admins') {
    emitToAdmins('notification:new', envelope);
    if (eventName) emitToAdmins(eventName, payload);
    return;
  }

  const recipientUserId = payload?.customerId || payload?.userId || notification?.recipientUserId;
  if (recipientUserId) {
    emitToUser(recipientUserId, 'notification:new', envelope);
    if (eventName) emitToUser(recipientUserId, eventName, payload);
  }
}

async function notifyAdmins(event, payload) {
  const title = String(payload?.title || event.replace(/[:_]/g, ' ')).replace(/\b\w/g, (match) => match.toUpperCase());
  const message = String(payload?.message || payload?.bookingId || payload?.subject || 'New admin notification');
  const notification = await createNotification({
    type: event,
    title,
    message,
    recipientRole: 'admin',
    bookingId: trimText(payload?.bookingId),
    customerId: payload?.customerId || null,
    eventKey: buildEventKey(`admin:${event}`, payload),
    metadata: payload || {}
  }).catch(() => undefined);

  if (notification) {
    emitNotification(notification, event, payload, 'admins');
  }

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
    const notification = await createNotification({
      type: socketEvent || 'booking:customer-notification',
      title: String(payload?.title || subject || 'Booking update'),
      message: String(payload?.message || whatsappMessage || subject || 'Booking update'),
      recipientRole: 'user',
      recipientUserId: userId,
      customerId: userId,
      bookingId: trimText(payload?.bookingId),
      eventKey: buildEventKey(`user:${socketEvent || 'booking:customer-notification'}`, { ...payload, userId }),
      metadata: payload || {}
    });

    emitNotification(notification, socketEvent, { ...payload, userId }, 'user');
  }
}

async function notifyBookingCreated(booking) {
  const context = buildBookingContext(booking);
  const adminTitle = `${context.serviceLabel} request received`;
  const adminMessage = `${booking.customerName} submitted a ${context.serviceType} for ${booking.bookingId}`;

  await notifyAdmins('booking:new', {
    title: adminTitle,
    message: adminMessage,
    bookingId: booking.bookingId,
    customerId: booking.user?._id || booking.user || null,
    customerName: booking.customerName,
    bookingStatus: booking.bookingStatus,
    paymentStatus: booking.paymentStatus,
    tripType: booking.tripType,
    serviceType: context.serviceType,
    serviceLabel: context.serviceLabel,
    vehicle: context.vehicle,
    pickupLocation: booking.pickupLocation,
    dropLocation: booking.dropLocation,
    createdAt: booking.createdAt
  });

  await notifyCustomer({
    userId: booking.user?._id || booking.user || null,
    email: booking.email,
    phone: booking.phone,
    socketEvent: 'booking:created',
    payload: {
      title: `${context.serviceLabel} submitted`,
      message: `${booking.bookingId} has been submitted and is awaiting approval`,
      bookingId: booking.bookingId,
      bookingStatus: booking.bookingStatus,
      paymentStatus: booking.paymentStatus,
      customerName: booking.customerName,
      tripType: booking.tripType,
      serviceType: context.serviceType,
      serviceLabel: context.serviceLabel,
      vehicle: context.vehicle
    }
  });
}

function getStatusLabel(status) {
  return String(status || '').trim() || 'Updated';
}

function buildStatusNotification(booking, status, note) {
  const statusLabel = getStatusLabel(status);
  const context = buildBookingContext(booking);
  const reason = note ? `<p><strong>Note:</strong> ${note}</p>` : '';
  const html = `
    <div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.6">
      <h2 style="margin:0 0 12px">Booking ${statusLabel}</h2>
      <p>Your ${context.serviceType} <strong>${booking.bookingId}</strong> is now marked as <strong>${statusLabel}</strong>.</p>
      <p><strong>Pickup:</strong> ${booking.pickupLocation || 'N/A'}<br/>
      <strong>Drop:</strong> ${booking.dropLocation || 'N/A'}</p>
      ${reason}
      <p>If you have questions, reply to this message or contact our support team.</p>
    </div>`;

  return {
    subject: `${context.serviceLabel} ${statusLabel} - ${booking.bookingId}`,
    html,
    whatsappMessage: `${context.serviceLabel} ${booking.bookingId} is now ${statusLabel}${note ? `: ${note}` : '.'}`,
    adminMessage: `${booking.bookingId} moved to ${statusLabel}`,
    statusLabel,
    context
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
  const { subject, html, whatsappMessage, adminMessage, statusLabel, context } = buildStatusNotification(booking, status, note);

  await notifyAdmins(adminEvent, {
    title: adminTitle || `${context.serviceLabel} updated`,
    message: adminMessage,
    bookingId: booking.bookingId,
    customerId: booking.user?._id || booking.user || null,
    customerName: booking.customerName,
    status: statusLabel,
    paymentStatus: booking.paymentStatus,
    tripType: booking.tripType,
    serviceType: context.serviceType,
    serviceLabel: context.serviceLabel,
    vehicle: context.vehicle,
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
      customerName: booking.customerName,
      tripType: booking.tripType,
      serviceType: context.serviceType,
      serviceLabel: context.serviceLabel,
      vehicle: context.vehicle,
      title: `Booking ${statusLabel}`,
      message: `${booking.bookingId} is now ${statusLabel}`
    }
  });
}

module.exports = { notifyAdmins, notifyCustomer, notifyBookingStatusChange, notifyBookingCreated };