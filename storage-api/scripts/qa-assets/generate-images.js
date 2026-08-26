/* eslint-disable */
// Sinh 5 ảnh test cho QA test suite bằng cách render SVG viết tay qua sharp
// (đã có sẵn trong deps, dùng cho ThumbnailService) — không cần trình duyệt,
// không dùng ảnh phim/ảnh thật có bản quyền.
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const outDir = __dirname;

async function render(name, svg) {
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  fs.writeFileSync(path.join(outDir, name), buf);
  console.log('wrote', name, buf.length, 'bytes');
}

async function main() {
  // 1) meme_banana.png — minh hoạ gốc (không phải ảnh phim), người đàn ông
  //    hét lớn, chĩa quả chuối vàng vào thái dương như súng.
  await render(
    'meme_banana.png',
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#2b3a4a"/>
          <stop offset="1" stop-color="#0e1620"/>
        </linearGradient>
      </defs>
      <rect width="800" height="600" fill="url(#bg)"/>
      <text x="230" y="80" font-size="30" font-weight="bold" fill="#fff" font-family="sans-serif">AAAAAHHH!!</text>
      <polygon points="300,600 320,320 480,320 500,600" fill="#111318"/>
      <polygon points="370,340 400,300 430,340 400,380" fill="#eee"/>
      <ellipse cx="400" cy="250" rx="55" ry="65" fill="#d9a876"/>
      <ellipse cx="400" cy="292" rx="22" ry="28" fill="#3a1010"/>
      <line x1="365" y1="225" x2="385" y2="235" stroke="#000" stroke-width="4"/>
      <line x1="435" y1="225" x2="415" y2="235" stroke="#000" stroke-width="4"/>
      <line x1="460" y1="420" x2="430" y2="260" stroke="#d9a876" stroke-width="26" stroke-linecap="round"/>
      <g transform="translate(455,240) rotate(-35)">
        <path d="M -70,18 C -50,-22 40,-30 78,-6 C 45,4 -20,10 -70,18 Z" fill="#f4d21a" stroke="#8a6b00" stroke-width="3"/>
        <path d="M -68,15 C -30,4 30,0 74,-3" fill="none" stroke="#c8ab00" stroke-width="2"/>
        <ellipse cx="76" cy="-6" rx="8" ry="6" fill="#5a3d00"/>
        <ellipse cx="-70" cy="16" rx="7" ry="6" fill="#5a3d00"/>
      </g>
      <text x="120" y="560" font-size="20" fill="#9fb3c8" font-family="sans-serif">minh hoa QA test - khong phai anh phim that</text>
    </svg>`,
  );

  // 2) screenshot_code.png — editor giả lập với code React/Next.js thật.
  const codeLines = [
    "import { useEffect, useState } from 'react';",
    '',
    'export function useDebouncedValue(value, delayMs) {',
    '  const [debounced, setDebounced] = useState(value);',
    '',
    '  useEffect(() => {',
    '    const timer = setTimeout(() => setDebounced(value), delayMs);',
    '    return () => clearTimeout(timer);',
    '  }, [value, delayMs]);',
    '',
    '  return debounced;',
    '}',
    '',
    'export default function SearchBox() {',
    "  const [query, setQuery] = useState('');",
    '  const debouncedQuery = useDebouncedValue(query, 300);',
    '  return <input value={query} onChange={(e) => setQuery(e.target.value)} />;',
    '}',
  ];
  const codeSvgLines = codeLines
    .map((l, i) => {
      const escaped = l
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `<text x="30" y="${60 + i * 26}" font-size="16" font-family="monospace" fill="#d4d4d4">${escaped}</text>`;
    })
    .join('\n');
  await render(
    'screenshot_code.png',
    `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="560">
      <rect width="900" height="560" fill="#1e1e1e"/>
      <rect width="900" height="34" fill="#323233"/>
      <circle cx="20" cy="17" r="6" fill="#ff5f56"/>
      <circle cx="42" cy="17" r="6" fill="#ffbd2e"/>
      <circle cx="64" cy="17" r="6" fill="#27c93f"/>
      <text x="400" y="22" font-size="13" fill="#ccc" font-family="sans-serif">useDebouncedValue.tsx</text>
      ${codeSvgLines}
    </svg>`,
  );

  // 3) receipt_invoice.png — hoá đơn tiền điện giả lập.
  await render(
    'receipt_invoice.png',
    `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="900">
      <rect width="700" height="900" fill="#ffffff"/>
      <text x="40" y="60" font-size="26" font-weight="bold" fill="#111" font-family="sans-serif">HÓA ĐƠN TIỀN ĐIỆN</text>
      <text x="40" y="95" font-size="14" fill="#444" font-family="sans-serif">Công ty Điện lực Thành phố</text>
      <line x1="40" y1="115" x2="660" y2="115" stroke="#ccc"/>
      <text x="40" y="150" font-size="14" fill="#111" font-family="sans-serif">Mã hoá đơn: HD-2025-0847213</text>
      <text x="40" y="175" font-size="14" fill="#111" font-family="sans-serif">Kỳ thanh toán: Tháng 09/2025</text>
      <text x="40" y="200" font-size="14" fill="#111" font-family="sans-serif">Mã khách hàng: PD09-1188-2201</text>
      <line x1="40" y1="220" x2="660" y2="220" stroke="#ccc"/>
      <text x="40" y="250" font-size="14" font-weight="bold" fill="#111" font-family="sans-serif">Chi tiết sử dụng</text>
      <text x="40" y="280" font-size="13" fill="#333" font-family="sans-serif">Chỉ số đầu: 18420 kWh</text>
      <text x="40" y="305" font-size="13" fill="#333" font-family="sans-serif">Chỉ số cuối: 18705 kWh</text>
      <text x="40" y="330" font-size="13" fill="#333" font-family="sans-serif">Sản lượng tiêu thụ: 285 kWh</text>
      <text x="40" y="355" font-size="13" fill="#333" font-family="sans-serif">Đơn giá bình quân: 2.204 đ/kWh</text>
      <text x="40" y="380" font-size="13" fill="#333" font-family="sans-serif">Tiền điện: 628.140 đ</text>
      <text x="40" y="405" font-size="13" fill="#333" font-family="sans-serif">Thuế GTGT (8%): 50.251 đ</text>
      <line x1="40" y1="430" x2="660" y2="430" stroke="#ccc"/>
      <text x="40" y="470" font-size="20" font-weight="bold" fill="#111" font-family="sans-serif">TỔNG TIỀN THANH TOÁN: 678.391 đ</text>
      <text x="40" y="500" font-size="13" fill="#666" font-family="sans-serif">Hạn thanh toán: 25/10/2025</text>
    </svg>`,
  );

  // 4) red_car_banner.png — minh hoạ vector xe hơi đỏ ban đêm.
  await render(
    'red_car_banner.png',
    `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="500">
      <defs>
        <linearGradient id="night" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#0b1026"/>
          <stop offset="1" stop-color="#1a2340"/>
        </linearGradient>
      </defs>
      <rect width="900" height="500" fill="url(#night)"/>
      <rect y="420" width="900" height="80" fill="#222"/>
      <line x1="0" y1="460" x2="900" y2="460" stroke="#ffcc00" stroke-width="4" stroke-dasharray="30,20"/>
      <rect x="120" y="60" width="10" height="180" fill="#333"/>
      <circle cx="125" cy="55" r="18" fill="#fff6c9" opacity="0.9"/>
      <rect x="720" y="60" width="10" height="180" fill="#333"/>
      <circle cx="725" cy="55" r="18" fill="#fff6c9" opacity="0.9"/>
      <g transform="translate(230,300)">
        <rect x="0" y="40" width="420" height="70" rx="18" fill="#c81d25"/>
        <path d="M40,40 Q100,-30 260,-20 Q340,-15 380,40 Z" fill="#e02330"/>
        <rect x="120" y="-5" width="150" height="45" rx="8" fill="#111a2e" opacity="0.85"/>
        <circle cx="90" cy="112" r="32" fill="#111"/>
        <circle cx="90" cy="112" r="14" fill="#888"/>
        <circle cx="340" cy="112" r="32" fill="#111"/>
        <circle cx="340" cy="112" r="14" fill="#888"/>
        <rect x="400" y="55" width="14" height="16" fill="#ffdf6b"/>
        <rect x="-14" y="55" width="14" height="16" fill="#ff5555"/>
      </g>
    </svg>`,
  );

  // 5) infographic_ai.png — biểu đồ cột + chú thích về xu hướng ứng dụng AI.
  const bars = [
    { label: 'Chatbot', value: 82 },
    { label: 'Tìm kiếm', value: 68 },
    { label: 'Phân tích DL', value: 74 },
    { label: 'Tự động hoá', value: 59 },
  ];
  const barWidth = 110;
  const gap = 50;
  const baseX = 80;
  const baseY = 480;
  const maxH = 350;
  const barsSvg = bars
    .map((b, i) => {
      const h = (b.value / 100) * maxH;
      const x = baseX + i * (barWidth + gap);
      const y = baseY - h;
      return `
      <rect x="${x}" y="${y}" width="${barWidth}" height="${h}" fill="#4f7cff" rx="6"/>
      <text x="${x + barWidth / 2}" y="${y - 12}" font-size="18" font-weight="bold" fill="#111" text-anchor="middle" font-family="sans-serif">${b.value}%</text>
      <text x="${x + barWidth / 2}" y="${baseY + 28}" font-size="15" fill="#333" text-anchor="middle" font-family="sans-serif">${b.label}</text>`;
    })
    .join('\n');
  await render(
    'infographic_ai.png',
    `<svg xmlns="http://www.w3.org/2000/svg" width="820" height="600">
      <rect width="820" height="600" fill="#f7f8fb"/>
      <text x="40" y="50" font-size="26" font-weight="bold" fill="#111" font-family="sans-serif">Xu huong ung dung AI trong doanh nghiep 2025</text>
      <text x="40" y="80" font-size="14" fill="#555" font-family="sans-serif">Ty le doanh nghiep dang trien khai theo tung linh vuc (khao sat noi bo)</text>
      <line x1="60" y1="480" x2="760" y2="480" stroke="#333" stroke-width="2"/>
      ${barsSvg}
    </svg>`,
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
