function layout(title, body) {
  return `
    <div style="margin:0;background:#f5f1ea;font-family:Arial,sans-serif;padding:24px;color:#2b1d14;">
      <div style="max-width:680px;margin:0 auto;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 18px 55px rgba(0,0,0,.08);">
        <div style="background:linear-gradient(135deg,#1f2937,#7c5d2f);color:#fff;padding:28px 32px;">
          <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;opacity:.85;">Luxury Tour & Travel</div>
          <h1 style="margin:10px 0 0;font-size:28px;line-height:1.15;">${title}</h1>
        </div>
        <div style="padding:32px;line-height:1.7;font-size:15px;">${body}</div>
        <div style="padding:18px 32px 28px;color:#7b6b59;font-size:12px;border-top:1px solid #eee;">This is an automated message from Luxury Tour & Travel.</div>
      </div>
    </div>`;
}

function bookingConfirmation(booking) {
  return layout('Booking Received', `
    <p>Dear ${booking.customerName},</p>
    <p>Your booking request has been received and is now pending review.</p>
    <p><strong>Booking ID:</strong> ${booking.bookingId}<br/>
    <strong>Pickup:</strong> ${booking.pickupLocation}<br/>
    <strong>Drop:</strong> ${booking.dropLocation}<br/>
    <strong>Payment:</strong> Pay after ride completion</p>
    <p>Your booking is subject to admin approval. Our team will review it and update you shortly.</p>
  `);
}

function bookingAccepted(booking) {
  return layout('Booking Approved', `
    <p>Your booking <strong>${booking.bookingId}</strong> has been accepted.</p>
    <p>The ride has been approved. We will coordinate the driver assignment and next steps.</p>
  `);
}

function driverAssigned(booking, driver) {
  return layout('Driver Assigned', `
    <p>Your driver has been assigned for booking <strong>${booking.bookingId}</strong>.</p>
    <p><strong>Driver:</strong> ${driver.driverName}<br/>
    <strong>Phone:</strong> ${driver.phone}<br/>
    <strong>Vehicle:</strong> ${driver.vehicleAssigned}</p>
  `);
}

function rideReminder(booking) {
  return layout('Ride Reminder', `<p>This is a reminder for your upcoming ride: <strong>${booking.bookingId}</strong>.</p>`);
}

function rideCompleted(booking) {
  return layout('Ride Completed', `<p>Your ride for booking <strong>${booking.bookingId}</strong> has been completed.</p><p>Your invoice is being prepared and will be shared shortly.</p>`);
}

function invoiceGenerated(invoice, booking) {
  return layout('Invoice Generated', `
    <p>Your invoice for booking <strong>${booking.bookingId}</strong> is ready.</p>
    <p><strong>Invoice ID:</strong> ${invoice.invoiceId}<br/>
    <strong>Final Amount:</strong> ₹${invoice.totalFare}<br/>
    <strong>Payment Status:</strong> ${invoice.paymentStatus}</p>
    <p>Your premium PDF invoice is attached. You can also review, print, or download it from your booking details.</p>
  `);
}

function paymentReceipt(payment, booking) {
  return layout('Payment Receipt', `
    <p>We received your ${payment.paymentMethod || payment.paymentType} payment for booking <strong>${booking.bookingId}</strong>.</p>
    <p><strong>Amount:</strong> ₹${payment.amount}<br/>
    <strong>Status:</strong> ${payment.status}<br/>
    <strong>Invoice:</strong> ${booking.invoiceId || 'Pending'}</p>
    <p>Your updated PDF receipt is attached for records and printing.</p>
  `);
}

function contactReceived(contact) {
  return layout('Support Request Received', `<p>Thanks ${contact.name}. We received your message and will respond soon.</p>`);
}

module.exports = {
  bookingConfirmation,
  bookingAccepted,
  driverAssigned,
  rideReminder,
  rideCompleted,
  invoiceGenerated,
  paymentReceipt,
  contactReceived
};