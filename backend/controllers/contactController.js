const Contact = require('../models/Contact');
const asyncHandler = require('../utils/asyncHandler');
const { sendEmail } = require('../services/emailService');
const { contactReceived } = require('../services/emailTemplates');
const { notifyAdmins } = require('../services/notificationService');

const createContact = asyncHandler(async (req, res) => {
  const contact = await Contact.create(req.body);

  await notifyAdmins('contact:new', {
    name: contact.name,
    phone: contact.phone,
    email: contact.email,
    subject: contact.subject
  });

  await sendEmail({
    to: contact.email,
    subject: `We received your message - ${contact.subject}`,
    html: contactReceived(contact)
  }).catch(() => undefined);

  res.status(201).json({ success: true, message: 'Message received successfully', contact });
});

module.exports = { createContact };