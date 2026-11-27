'use strict';

const { inflateSync } = require('node:zlib');
const PREFIX = 'data:image/png;base64,';

// OBS's PNG screenshot is sampled in memory only. This is a conservative
// placeholder check, not face detection or confirmation of camera motion.
function cameraSample(image) {
  if (typeof image !== 'string' || !image.startsWith(PREFIX) || image.length > 200_000) return 'unverified';
  try {
    const png = Buffer.from(image.slice(PREFIX.length), 'base64');
    if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || png.toString('ascii', 12, 16) !== 'IHDR') return 'unverified';
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    const channels = ({ 2: 3, 6: 4 })[png[25]];
    if (!channels || png[24] !== 8 || png[28] !== 0 || width < 1 || height < 1 || width > 128 || height > 128) return 'unverified';
    const chunks = [];
    for (let i = 8; i + 12 <= png.length;) {
      const size = png.readUInt32BE(i);
      if (i + 12 + size > png.length) return 'unverified';
      if (png.toString('ascii', i + 4, i + 8) === 'IDAT') chunks.push(png.subarray(i + 8, i + 8 + size));
      i += 12 + size;
    }
    const stride = width * channels;
    const expected = (stride + 1) * height;
    const data = inflateSync(Buffer.concat(chunks), { maxOutputLength: expected });
    if (data.length !== expected) return 'unverified';
    let prev = Buffer.alloc(stride), darkest = 0, green = 0, count = 0;
    for (let y = 0; y < height; y++) {
      const offset = y * (stride + 1);
      const filter = data[offset];
      if (filter > 4) return 'unverified';
      const row = data.subarray(offset + 1, offset + 1 + stride);
      for (let x = 0; x < stride; x++) {
        const left = row[x - channels] || 0, above = prev[x], diagonal = prev[x - channels] || 0;
        const estimate = left + above - diagonal;
        const a = Math.abs(estimate - left), b = Math.abs(estimate - above), c = Math.abs(estimate - diagonal);
        row[x] += [0, left, above, (left + above) >> 1, a <= b && a <= c ? left : b <= c ? above : diagonal][filter];
      }
      for (let x = Math.floor(width / 5); x < Math.ceil(width * 4 / 5); x++) {
        if (y < height / 6 || y > height * 5 / 6) continue;
        const i = x * channels;
        const r = row[i], g = row[i + 1], b = row[i + 2];
        if ((channels === 4 && row[i + 3] < 16) || Math.max(r, g, b) < 15) darkest++;
        if (g > 90 && g - r > 80 && g - b > 55) green++;
        count++;
      }
      prev = row;
    }
    if (!count) return 'unverified';
    return darkest / count > 0.99 ? 'black/empty frame' : green / count > 0.99 ? 'solid green frame' : 'picture present';
  } catch { return 'unverified'; }
}

module.exports = { cameraSample };
