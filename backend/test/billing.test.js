const { expect } = require('chai');
const { calculateFareQuote } = require('../services/billingService');
const { calculateBillingDraft } = require('../utils/billingWorkflow');
const { buildInvoiceModel } = require('../utils/invoicePdf');

function expectReconciles(result) {
  const breakdown = result.billingBreakdown || result.fareBreakdown;
  const lineItems = result.lineItems || breakdown.lineItems || [];
  const visibleSum = lineItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);

  expect(breakdown.subtotal).to.equal(visibleSum);
  expect(breakdown.gstAmount).to.equal(Math.round(breakdown.subtotal * (breakdown.gstPercent / 100)));
  expect(breakdown.totalAmount).to.equal(breakdown.subtotal + breakdown.gstAmount - (breakdown.discountAmount || 0));
}

describe('BillingService fare calculations', function () {
  this.timeout(5000);

  it('local package - within included KM should charge only package fare + GST', async () => {
    const res = await calculateFareQuote({
      pickup: { address: 'A' },
      drop: { address: 'B' },
      route: { distanceInKm: 15, estimatedDuration: 30 },
      tripPackage: { packageName: 'local-package', price: 500, includedKm: 20, includedHours: 8 },
      tripType: 'local-package',
      pickupDateTime: '2026-05-27T10:00:00',
      settings: { pricingSettings: { localPackagePrice: 500, extraKmRate: 20, extraHourCharge: 100, gstPercent: 5 } }
    });

    expect(res.fareBreakdown.subtotal).to.equal(500);
    expect(res.fareBreakdown.gstAmount).to.equal(25);
    expect(res.fareBreakdown.totalAmount).to.equal(525);
    expectReconciles(res);
  });

  it('local package - extra KM charged correctly', async () => {
    const res = await calculateFareQuote({
      pickup: { address: 'A' },
      drop: { address: 'B' },
      route: { distanceInKm: 30, estimatedDuration: 60 },
      tripPackage: { packageName: 'local-package', price: 500, includedKm: 20, includedHours: 8 },
      tripType: 'local-package',
      pickupDateTime: '2026-05-27T10:00:00',
      settings: { pricingSettings: { localPackagePrice: 500, extraKmRate: 20, extraHourCharge: 100, gstPercent: 5 } }
    });

    // Extra KM = 10 * 20 = 200
    expect(res.fareBreakdown.distanceFare).to.equal(200);
    expect(res.fareBreakdown.subtotal).to.equal(700);
    expect(res.fareBreakdown.gstAmount).to.equal(35);
    expect(res.fareBreakdown.totalAmount).to.equal(735);
    expectReconciles(res);
  });

  it('outstation trip - per-km charge, no base fare when not configured', async () => {
    const res = await calculateFareQuote({
      pickup: { address: 'A' },
      drop: { address: 'B' },
      route: { distanceInKm: 100, estimatedDuration: 600 },
      tripType: 'outstation-package',
      pickupDateTime: '2026-05-27T10:00:00',
      settings: { pricingSettings: { outstationMinCharge: 0, pricePerKm: 10, gstPercent: 5 } }
    });

    expect(res.fareBreakdown.distanceFare).to.equal(100 * 10);
    expect(res.fareBreakdown.baseFare).to.equal(0);
    expect(res.fareBreakdown.subtotal).to.equal(1000);
    expect(res.fareBreakdown.totalAmount).to.equal(1050);
    expectReconciles(res);
  });

  it('minimum fare enforcement', async () => {
    const res = await calculateFareQuote({
      pickup: { address: 'A' },
      drop: { address: 'B' },
      route: { distanceInKm: 10, estimatedDuration: 20 },
      tripPackage: { packageName: 'local-package', price: 500, includedKm: 20, includedHours: 8 },
      tripType: 'local-package',
      pickupDateTime: '2026-05-27T10:00:00',
      settings: { pricingSettings: { localPackagePrice: 500, extraKmRate: 20, minimumFare: 1500, gstPercent: 5 } }
    });

    expect(res.fareBreakdown.subtotal).to.equal(1500);
    expect(res.fareBreakdown.totalAmount).to.equal(1575);
    expectReconciles(res);
  });

  it('surge pricing applies to distance fare', async () => {
    const res = await calculateFareQuote({
      pickup: { address: 'A' },
      drop: { address: 'B' },
      route: { distanceInKm: 100, estimatedDuration: 600 },
      tripType: 'outstation-package',
      pickupDateTime: '2026-05-27T10:00:00',
      settings: { pricingSettings: { outstationMinCharge: 0, pricePerKm: 10, surgeMultiplier: 1.2, gstPercent: 5 } }
    });

    expect(res.fareBreakdown.distanceFare).to.equal(Math.round(100 * 10 * 1.2));
  });

  it('night charge is applied on distance fare (percentage)', async () => {
    const res = await calculateFareQuote({
      pickup: { address: 'A' },
      drop: { address: 'B' },
      route: { distanceInKm: 30, estimatedDuration: 60 },
      tripPackage: { packageName: 'local-package', price: 500, includedKm: 20, includedHours: 8 },
      tripType: 'local-package',
      pickupDateTime: '2026-05-27T23:30:00', // night
      settings: { pricingSettings: { localPackagePrice: 500, extraKmRate: 20, nightChargePercent: 10, gstPercent: 5 } }
    });

    // Extra KM = 10 * 20 = 200, night 10% of 200 = 20
    expect(res.fareBreakdown.distanceFare).to.equal(200);
    expect(res.fareBreakdown.nightCharges).to.equal(20);
    expectReconciles(res);
  });

  it('renders an exact visible distance formula and reconciles invoice totals', async () => {
    const res = await calculateFareQuote({
      pickup: { address: 'A' },
      drop: { address: 'B' },
      route: { distanceInKm: 457.4, estimatedDuration: 335 },
      tripType: 'one-way',
      pickupDateTime: '2026-05-27T10:00:00',
      tollCharges: 450,
      extraCharges: 300,
      settings: { pricingSettings: { baseFare: 1000, pricePerKm: 20, driverAllowancePerDay: 499, gstPercent: 5 } }
    });

    const distanceRow = res.lineItems.find((row) => row.description === 'Distance Charge');
    expect(distanceRow.details).to.equal('457.4 KM @ ₹20/KM');
    expect(distanceRow.amount).to.equal(9148);
    expect(res.billingBreakdown.subtotal).to.equal(res.lineItems.reduce((sum, row) => sum + Number(row.amount || 0), 0));
    expectReconciles(res);
  });

  it('airport transfer visible extra-km charge is included in the subtotal and reconciles', async () => {
    const res = await calculateFareQuote({
      pickup: { address: 'Delhi, Delhi' },
      drop: { address: 'Indira Gandhi International Airport, Delhi' },
      route: { distanceInKm: 11.7912, estimatedDuration: 14.8833 },
      tripType: 'airport-transfer',
      pickupDateTime: '2026-05-27T08:00:00',
      settings: { pricingSettings: { airportTransferMinCharge: 2500, airportTransferMaxCharge: 3500, gstPercent: 5 } }
    });

    expect(res.billingBreakdown.tripType).to.equal('airport-transfer');
    expect(res.lineItems.some((row) => row.chargeType === 'extraKmCharge' && Number(row.amount || 0) > 0)).to.equal(true);
    expect(res.billingBreakdown.subtotal).to.equal(res.lineItems.reduce((sum, row) => sum + Number(row.amount || 0), 0));
    expectReconciles(res);
  });

  it('formats invoice duration as hours and minutes', async () => {
    const quote = await calculateFareQuote({
      pickup: { address: 'A' },
      drop: { address: 'B' },
      route: { distanceInKm: 100, estimatedDuration: 335 },
      tripType: 'one-way',
      pickupDateTime: '2026-05-27T10:00:00',
      settings: { pricingSettings: { baseFare: 1000, pricePerKm: 20, gstPercent: 5 } }
    });

    const model = buildInvoiceModel({
      booking: {
        bookingId: 'BK-1',
        customerName: 'Test User',
        email: 'test@example.com',
        phone: '9999999999',
        pickupLocation: 'A',
        dropLocation: 'B',
        pickupDate: new Date('2026-05-27T10:00:00Z'),
        pickupTime: '10:00',
        selectedCar: 'Fortuner Legender',
        selectedPackage: 'One Way',
        tripType: 'one-way',
        estimatedDuration: 335,
        billingBreakdown: quote.billingBreakdown,
        paymentMethod: 'UPI',
        paymentStatus: 'Pending'
      },
      invoice: {
        invoiceId: 'INV-1',
        bookingId: 'BK-1',
        createdAt: new Date('2026-05-27T10:00:00Z')
      },
      driver: null,
      settings: {}
    });

    expect(model.billingSummary.tripDuration).to.equal('5 hr 35 min');
  });

  it('renders driver allowance per day and friendly trip labels in the billing summary', async () => {
    const quote = await calculateFareQuote({
      pickup: { address: 'A' },
      drop: { address: 'B' },
      route: { distanceInKm: 120, estimatedDuration: 240 },
      tripType: 'outstation-package',
      pickupDateTime: '2026-05-27T10:00:00',
      settings: { pricingSettings: { baseFare: 1000, pricePerKm: 20, driverAllowancePerDay: 499, gstPercent: 5 } }
    });

    const model = buildInvoiceModel({
      booking: {
        bookingId: 'BK-2',
        customerName: 'Test User',
        email: 'test@example.com',
        phone: '9999999999',
        pickupLocation: 'A',
        dropLocation: 'B',
        pickupDate: new Date('2026-05-27T10:00:00Z'),
        pickupTime: '10:00',
        selectedCar: 'Fortuner Legender',
        selectedPackage: 'Outstation Package',
        tripType: 'outstation-package',
        estimatedDuration: 240,
        billingBreakdown: {
          ...quote.billingBreakdown,
          driverAllowancePerDay: 0
        },
        paymentMethod: 'UPI',
        paymentStatus: 'Pending'
      },
      invoice: {
        invoiceId: 'INV-2',
        bookingId: 'BK-2',
        createdAt: new Date('2026-05-27T10:00:00Z')
      },
      driver: null,
      settings: {}
    });

    expect(model.billingSummary.driverAllowancePerDay).to.equal(499);
    expect(model.billingSummary.tripType).to.equal('Outstation Package');
    expect(model.billingSummary.tripDistance).to.equal('120 km');
  });

  it('normalizes blank invoice and booking fields to visible fallback text', async () => {
    const quote = await calculateFareQuote({
      pickup: { address: 'A' },
      drop: { address: 'B' },
      route: { distanceInKm: 12.5, estimatedDuration: 25 },
      tripType: 'one-way',
      pickupDateTime: '2026-05-27T10:00:00',
      settings: { pricingSettings: { baseFare: 1000, pricePerKm: 20, gstPercent: 5 } }
    });

    const model = buildInvoiceModel({
      booking: {
        bookingId: 'BK-3',
        customerName: '',
        email: '',
        phone: '',
        pickupLocation: '',
        dropLocation: '',
        billingBreakdown: quote.billingBreakdown,
        paymentMethod: '',
        paymentStatus: 'Pending'
      },
      invoice: {
        invoiceId: 'INV-3',
        bookingId: 'BK-3',
        driverName: '',
        driverPhone: '',
        vehicle: '',
        paymentMethod: '',
        transactionId: ''
      },
      driver: null,
      settings: {}
    });

    expect(model.customer.name).to.equal('N/A');
    expect(model.customer.email).to.equal('N/A');
    expect(model.customer.phone).to.equal('N/A');
    expect(model.customer.pickupLocation).to.equal('N/A');
    expect(model.customer.dropLocation).to.equal('N/A');
    expect(model.ride.driverName).to.equal('Not assigned');
    expect(model.ride.driverPhone).to.equal('Not assigned');
    expect(model.billingSummary.vehicle).to.equal('N/A');
    expect(model.payment.method).to.equal('N/A');
    expect(model.payment.transactionId).to.equal('N/A');
    expect(model.billingSummary.tripDistance).to.equal('12.5 km');
  });

  it('applies discount after subtotal while keeping reconciliation intact', async () => {
    const quote = await calculateFareQuote({
      pickup: { address: 'A' },
      drop: { address: 'B' },
      route: { distanceInKm: 457.4, estimatedDuration: 335 },
      tripType: 'one-way',
      pickupDateTime: '2026-05-27T10:00:00',
      tollCharges: 450,
      extraCharges: 300,
      settings: { pricingSettings: { baseFare: 1000, pricePerKm: 20, driverAllowancePerDay: 499, gstPercent: 5 } }
    });

    const draft = calculateBillingDraft({
      booking: {
        billingBreakdown: quote.billingBreakdown,
        tripType: 'one-way',
        selectedPackage: 'Fortuner Legender',
        distanceInKm: 457.4,
        selectedCar: 'Fortuner Legender'
      },
      invoice: {},
      settings: { paymentSettings: {}, billing: { taxPercent: 5 } },
      draft: { discountAmount: 219 }
    });

    expect(draft.discountAmount).to.equal(219);
    expect(draft.subtotal).to.equal(draft.lineItems.reduce((sum, row) => sum + Number(row.amount || 0), 0));
    expect(draft.gstAmount).to.equal(Math.round(draft.subtotal * 0.05));
    expect(draft.totalFare).to.equal(draft.subtotal + draft.gstAmount - draft.discountAmount);
    expect(draft.billingBreakdown.totalAmount).to.equal(draft.totalFare);
    expectReconciles(draft);
  });

  it('keeps minimum fare adjustment in the billing draft subtotal and reconciliation', async () => {
    const quote = await calculateFareQuote({
      pickup: { address: 'A' },
      drop: { address: 'B' },
      route: { distanceInKm: 5, estimatedDuration: 15 },
      tripType: 'one-way',
      pickupDateTime: '2026-05-27T10:00:00',
      settings: { pricingSettings: { baseFare: 1000, pricePerKm: 20, minimumFare: 5000, gstPercent: 5 } }
    });

    expect(quote.billingBreakdown.minimumFareAdjustment).to.equal(3900);

    const draft = calculateBillingDraft({
      booking: {
        billingBreakdown: quote.billingBreakdown,
        tripType: 'one-way',
        selectedPackage: 'Fortuner Legender',
        distanceInKm: 5,
        selectedCar: 'Fortuner Legender'
      },
      invoice: {},
      settings: { paymentSettings: {}, billing: { taxPercent: 5 } },
      draft: { discountAmount: 0 }
    });

    expect(draft.minimumFareAdjustment).to.equal(3900);
    expect(draft.subtotal).to.equal(draft.lineItems.reduce((sum, row) => sum + Number(row.amount || 0), 0));
    expect(draft.billingBreakdown.totalAmount).to.equal(draft.totalFare);
    expectReconciles(draft);
  });
});
