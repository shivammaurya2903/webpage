const { expect } = require('chai');
const { calculateFareQuote } = require('../services/billingService');

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
  });
});
