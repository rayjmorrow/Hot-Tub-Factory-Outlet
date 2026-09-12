import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const xml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));

export function voucherDetails(query) {
  const name = String(query.name || '').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 160 || /[{}\x00-\x1f]/.test(name)) throw new Error('A customer name is required');
  const issued = String(query.issued || '');
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(issued);
  if (!match) throw new Error('An issue date is required (YYYY-MM-DD)');
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (year < 2026 || year > 2100 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new Error('Invalid issue date');
  date.setUTCDate(date.getUTCDate() + 9);
  const expires = date.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });
  const source = String(query.source || '').slice(0, 300);
  const type = query.type === 'swim-spa' || /swim[\s_-]*spa/i.test(source) ? 'swim-spa' : 'hot-tub';
  return { name, issued, expires, type };
}

export async function renderVoucher(details) {
  const base = fileURLToPath(new URL(`./voucher-assets/${details.type}.png`, import.meta.url));
  const { width, height } = await sharp(base).metadata();
  // Coordinates use the supplied artwork's 1672 x 941 design space.
  const swim = details.type === 'swim-spa';
  const baseline = swim ? 796 : 758;
  const size = Math.min(28, Math.floor(490 / Math.max(details.name.length * 0.57, 1)));
  const overlay = `<svg width="${width}" height="${height}" viewBox="0 0 1672 941" xmlns="http://www.w3.org/2000/svg"><g fill="#061b36" font-family="DejaVu Sans,Arial,sans-serif" font-weight="bold"><text x="515" y="${baseline}" font-size="${size}">${xml(details.name)}</text><text x="1315" y="${baseline}" text-anchor="end" font-size="20">Expires ${xml(details.expires)}</text></g></svg>`;
  return sharp(base).composite([{ input: Buffer.from(overlay) }]).png().toBuffer();
}

export function installVoucherRoutes(app) {
  app.get('/vouchers/duck-bucks.png', async (req, res) => {
    try {
      const details = voucherDetails(req.query);
      const png = await renderVoucher(details);
      res.set({ 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `inline; filename="duck-bucks-${details.type}.png"` });
      res.type('png').send(png);
    } catch (error) {
      res.status(400).type('text').send('Voucher unavailable: a valid customer name and fixed issue date are required.');
    }
  });
}
