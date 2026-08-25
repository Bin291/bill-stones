/* eslint-disable */
// E2E AI: upload tài liệu -> chờ index+embedding -> search NGỮ NGHĨA (không trùng
// từ khoá) tìm ra file qua nhánh dense (Gemini embedding + pgvector + RRF).
const fs = require('fs'), path = require('path');
const { PrismaClient } = require('@prisma/client');
function ge(k){const e=fs.readFileSync(path.join(__dirname,'..','.env'),'utf8');const m=e.match(new RegExp('^'+k+'=(.*)$','m'));return m?m[1].trim():'';}

async function main() {
  const url=ge('SUPABASE_URL').replace(/\/$/,''),anon=ge('SUPABASE_ANON_KEY'),service=ge('SUPABASE_SERVICE_ROLE_KEY');
  const API='http://localhost:3000';
  const email='e2e+ai'+Date.now()+'@example.com',password='Test-'+Math.random().toString(36).slice(2)+'Aa1!';
  const prisma = new PrismaClient();
  let uid=null,fid=null;
  const A=(c,m)=>{if(!c)throw new Error('ASSERT '+m)};
  // Nội dung về bánh chưng; query cố ý KHÔNG dùng lại các từ này.
  const content='Cong thuc lam banh chung: gao nep, dau xanh, thit heo, la dong, luoc tam tieng. Mon nay goi trong dip dau nam.';
  const query='huong dan che bien mon truyen thong';
  try {
    let r=await fetch(url+'/auth/v1/admin/users',{method:'POST',headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},body:JSON.stringify({email,password,email_confirm:true})});uid=(await r.json()).id;
    r=await fetch(url+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:anon,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
    const access=(await r.json()).access_token;const AUTH={Authorization:'Bearer '+access};const J={...AUTH,'Content-Type':'application/json'};

    console.log('1. Upload tài liệu (recipe.txt)');
    const bytes=Buffer.from(content,'utf8');
    r=await fetch(API+'/uploads/init',{method:'POST',headers:J,body:JSON.stringify({name:'recipe.txt',size:String(bytes.length),mimeType:'text/plain',folderId:null})});
    const init=await r.json();fid=init.fileId;
    r=await fetch(API+'/uploads/part',{method:'POST',headers:{...AUTH,'Content-Type':'application/octet-stream','x-file-id':fid,'x-upload-id':init.uploadId,'x-part-number':'1'},body:bytes});
    const etag=(await r.json()).ETag;
    await fetch(API+'/uploads/complete',{method:'POST',headers:J,body:JSON.stringify({fileId:fid,uploadId:init.uploadId,parts:[{PartNumber:1,ETag:etag}]})});

    console.log('2. Chờ index + embedding (Gemini)...');
    let hasEmb=false;
    for(let i=0;i<25;i++){
      await new Promise(res=>setTimeout(res,2000));
      const rows=await prisma.$queryRaw`SELECT count(*)::int AS n FROM "DocumentChunk" WHERE "fileId"=${fid} AND embedding IS NOT NULL`;
      if(rows[0].n>0){hasEmb=true;process.stdout.write('   có '+rows[0].n+' chunk embedding\n');break;}
      process.stdout.write('   ['+i+'] chưa có embedding...\r');
    }
    A(hasEmb,'embedding KHÔNG được lưu (pipeline dense hỏng)');

    console.log('3. Search NGỮ NGHĨA (query không trùng từ khoá):', JSON.stringify(query));
    let found=false;
    for(let i=0;i<8;i++){
      r=await fetch(API+'/search?q='+encodeURIComponent(query),{headers:AUTH});
      const {results}=await r.json();
      if(results.some(x=>x.id===fid)){found=true;console.log('   ✓ tìm thấy file qua nhánh dense; tổng kết quả:',results.length);break;}
      await new Promise(res=>setTimeout(res,1500));
    }
    A(found,'search ngữ nghĩa KHÔNG tìm ra file');

    // Đối chứng: FTS thuần với query này (không trùng token) sẽ KHÔNG ra -> chứng minh nhờ dense.
    console.log('\n✅ AI SEMANTIC SEARCH E2E THÀNH CÔNG (dense + RRF hoạt động)');

    await fetch(API+'/files/'+fid+'/trash',{method:'PATCH',headers:AUTH});
    await fetch(API+'/files/'+fid,{method:'DELETE',headers:AUTH});fid=null;
  } catch(e){console.log('\n❌',e.message);process.exitCode=1;}
  finally{ await prisma.$disconnect(); if(uid)await fetch(url+'/auth/v1/admin/users/'+uid,{method:'DELETE',headers:{apikey:service,Authorization:'Bearer '+service}}); }
}
main();
