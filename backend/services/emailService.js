const nodemailer = require('nodemailer');
const templates = require('./emailTemplates');

function getTransporter() {
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) return null;

  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT || 587),
    secure: Number(process.env.EMAIL_PORT || 587) === 465,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
}

async function sendEmail({ to, subject, html, attachments = [] }) {
  const transporter = getTransporter();
  if (!transporter) return { skipped: true };

  return transporter.sendMail({
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to,
    subject,
    html,
    attachments
  });
}

async function sendTemplateEmail(type, to, data, subject) {
  const html = templates[type](...data);
  return sendEmail({ to, subject, html });
}

module.exports = { sendEmail, sendTemplateEmail };