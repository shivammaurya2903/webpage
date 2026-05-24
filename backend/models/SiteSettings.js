const mongoose = require('mongoose');

const siteSettingsSchema = new mongoose.Schema(
  {
    businessName: { type: String, default: 'RAM KRISHNA TOUR & TRAVELS' },
    contactEmail: { type: String, default: 'support@example.com' },
    contactPhone: { type: String, default: '8081181368' },
    address: { type: String, default: 'Lucknow, Uttar Pradesh' },
    logoText: { type: String, default: 'RK' },
    socialLinks: {
      website: { type: String, default: '' },
      facebook: { type: String, default: '' },
      instagram: { type: String, default: '' },
      whatsapp: { type: String, default: '' }
    },
    paymentSettings: {
      currency: { type: String, default: 'INR' },
      advancePercent: { type: Number, default: 20 },
      gatewayName: { type: String, default: 'Stripe' }
    },
    notificationSettings: {
      emailEnabled: { type: Boolean, default: true },
      whatsappEnabled: { type: Boolean, default: true },
      realtimeEnabled: { type: Boolean, default: true }
    },
    homepage: {
      heroTitle: { type: String, default: 'Travel in luxury, arrive in style' },
      heroSubtitle: { type: String, default: 'Premium rides. Trusted drivers. Memorable journeys.' },
      bannerImage: { type: String, default: '' },
      testimonials: [{ name: String, quote: String }],
      fleetHighlights: [{ title: String, description: String }],
      seoTitle: { type: String, default: 'Luxury Tour & Travels' },
      seoDescription: { type: String, default: 'Luxury car rental and tour booking platform' }
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('SiteSettings', siteSettingsSchema);