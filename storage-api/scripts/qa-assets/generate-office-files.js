/* eslint-disable */
// Sinh file .docx (có ẢNH NHÚNG thật) và .xlsx để test 2 gap vừa vá:
//  - Excel hoàn toàn chưa được index trước đây.
//  - Ảnh nhúng trong DOCX bị mammoth.extractRawText() bỏ qua hoàn toàn.
// DOCX dựng thủ công bằng archiver (đã có sẵn trong deps) vì không có thư
// viện docx-authoring/pandoc/LibreOffice trên máy này — docx chỉ là 1 file
// ZIP chứa XML + media, tự dựng cấu trúc tối thiểu vẫn mở được bằng
// Word/mammoth thật.
const fs = require('fs');
const path = require('path');
const { ZipArchive } = require('archiver');
const XLSX = require('xlsx');

const OUT = __dirname;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`;

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p><w:r><w:t>Bao cao du an quy 3: chi tiet trien khai ha tang luu tru va bieu do minh hoa duoc dinh kem ben duoi.</w:t></w:r></w:p>
    <w:p>
      <w:r>
        <w:drawing>
          <wp:inline distT="0" distB="0" distL="0" distR="0">
            <wp:extent cx="4000000" cy="3000000"/>
            <wp:docPr id="1" name="Picture 1"/>
            <a:graphic>
              <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                <pic:pic>
                  <pic:nvPicPr>
                    <pic:cNvPr id="0" name="image1.png"/>
                    <pic:cNvPicPr/>
                  </pic:nvPicPr>
                  <pic:blipFill>
                    <a:blip r:embed="rId1"/>
                    <a:stretch><a:fillRect/></a:stretch>
                  </pic:blipFill>
                  <pic:spPr>
                    <a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="3000000"/></a:xfrm>
                    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                  </pic:spPr>
                </pic:pic>
              </a:graphicData>
            </a:graphic>
          </wp:inline>
        </w:drawing>
      </w:r>
    </w:p>
    <w:p><w:r><w:t>Ket thuc bao cao. Khong co so lieu dang text nao khac ngoai anh o tren.</w:t></w:r></w:p>
  </w:body>
</w:document>`;

async function buildDocx() {
  const imagePath = path.join(OUT, 'infographic_ai.png'); // tái dùng ảnh đã sinh cho QA suite trước
  const imageBuf = fs.readFileSync(imagePath);
  const outPath = path.join(OUT, 'report_with_embedded_image.docx');
  const output = fs.createWriteStream(outPath);
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const done = new Promise((resolve, reject) => {
    output.on('close', resolve);
    archive.on('error', reject);
  });
  archive.pipe(output);
  archive.append(CONTENT_TYPES, { name: '[Content_Types].xml' });
  archive.append(ROOT_RELS, { name: '_rels/.rels' });
  archive.append(DOC_RELS, { name: 'word/_rels/document.xml.rels' });
  archive.append(DOCUMENT_XML, { name: 'word/document.xml' });
  archive.append(imageBuf, { name: 'word/media/image1.png' });
  await archive.finalize();
  await done;
  console.log('wrote', outPath, fs.statSync(outPath).size, 'bytes');
}

function buildXlsx() {
  const wb = XLSX.utils.book_new();
  const data = [
    ['MSSV', 'HoTen', 'MonHoc', 'DiemGiuaKy', 'DiemCuoiKy'],
    ['22111061', 'Nguyen Hoang Lam Phuc', 'Tri tue nhan tao', 8.5, 9.0],
    ['22110023', 'Tran Thi Bich Ngoc', 'Tri tue nhan tao', 9.2, 8.8],
    ['22110987', 'Le Van Minh Quan', 'Tri tue nhan tao', 7.4, 7.9],
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, 'BangDiemAI');
  const outPath = path.join(OUT, 'bangdiem_tri_tue_nhan_tao.xlsx');
  XLSX.writeFile(wb, outPath);
  console.log('wrote', outPath, fs.statSync(outPath).size, 'bytes');
}

buildDocx()
  .then(buildXlsx)
  .catch((e) => { console.error(e); process.exit(1); });
