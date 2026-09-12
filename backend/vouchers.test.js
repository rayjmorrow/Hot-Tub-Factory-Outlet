import test from 'node:test';
import assert from 'node:assert/strict';
import { voucherDetails, renderVoucher } from './vouchers.js';
import sharp from 'sharp';

test('nine calendar days, including month/year/leap boundaries', () => {
  for (const [issued, expires] of [['2026-09-12','September 21, 2026'],['2026-12-28','January 6, 2027'],['2028-02-25','March 5, 2028']]) {
    assert.equal(voucherDetails({ name:'Ray Morrow', issued }).expires, expires);
  }
});
test('requires a real fixed date and resolved customer name', () => {
  for (const query of [{name:'Ray',issued:'2026-02-30'},{name:'{{contact.name}}',issued:'2026-09-12'},{name:'Ray'}]) assert.throws(() => voucherDetails(query));
});
test('selects the swim spa design from the lead source', () => {
  assert.equal(voucherDetails({name:'Ray',issued:'2026-09-12',source:'HTFO Swim Spa Lead'}).type,'swim-spa');
  assert.equal(voucherDetails({name:'Ray',issued:'2026-09-12',source:'HTFO Duck Bucks Spa Quiz'}).type,'hot-tub');
});
test('both artworks render with XML-sensitive customer names', async () => {
  for (const type of ['hot-tub','swim-spa']) {
    const png = await renderVoucher(voucherDetails({name:"Alex & Jamie O'Brien",issued:'2026-09-12',type}));
    const metadata = await sharp(png).metadata();
    assert.equal(metadata.format,'png');
    assert.ok(metadata.width >= 1600);
  }
});
