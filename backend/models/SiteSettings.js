const mongoose = require('mongoose');

const siteSettingsSchema = new mongoose.Schema(
  {
    businessName: { type: String, default: 'RAM KRISHNA TOUR & TRAVELS' },
    contactEmail: { type: String, default: 'support@example.com' },
    contactPhone: { type: String, default: '8081181368' },
    address: { type: String, default: 'Lucknow, Uttar Pradesh' },
    logoText: { type: String, default: 'RK' },
    billing: {
      gstin: { type: String, default: '09ABCDE1234F1Z5' },
      taxPercent: { type: Number, default: 5 },
      upiId: { type: String, default: 'rktravel@upi' },
      bankAccountName: { type: String, default: 'RAM KRISHNA TOUR & TRAVELS' },
      bankAccountNumber: { type: String, default: '000000000000' },
      bankIfsc: { type: String, default: 'BANK0000000' },
      bankBranch: { type: String, default: 'Lucknow Main' },
      paymentLink: { type: String, default: '' },
      footerNote: { type: String, default: 'Thank you for choosing our premium chauffeur and travel services.' }
    },
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
    pricingSettings: {
      gstPercent: { type: Number, default: 5 },
      nightChargePercent: { type: Number, default: 10 },
      driverAllowance: { type: Number, default: 0 },
      extraKmRate: { type: Number, default: 0 },
      waitingChargePerHour: { type: Number, default: 0 },
      defaultIncludedKm: { type: Number, default: 0 },
      baseFare: { type: Number, default: 0 },
      pricePerKm: { type: Number, default: 0 }
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