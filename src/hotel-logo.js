import {createHash} from 'node:crypto';
import PDFDocument from 'pdfkit';

const MAX_BYTES=800*1024;
export function ensureLogoSchema(db){
  db.exec(`
    CREATE TABLE IF NOT EXISTS hotel_brand_assets(
      id INTEGER PRIMARY KEY,
      mime TEXT NOT NULL CHECK(mime IN ('image/png','image/jpeg')),
      sha256 TEXT NOT NULL UNIQUE,
      data BLOB NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS active_hotel_logo(
      id INTEGER PRIMARY KEY CHECK(id=1),
      asset_id INTEGER REFERENCES hotel_brand_assets(id)
    );
    INSERT OR IGNORE INTO active_hotel_logo(id,asset_id) VALUES(1,NULL);
  `);
}
function validLogo(data,mime){
  if(!Buffer.isBuffer(data)||!data.length||data.length>MAX_BYTES)
    throw new Error('Logo must be between 1 byte and 800 KB');
  if(mime==='image/png'){
    if(data.length<24||data.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||
      data.subarray(12,16).toString('ascii')!=='IHDR')throw new Error('Invalid PNG logo');
    const width=data.readUInt32BE(16),height=data.readUInt32BE(20);
    if(!width||!height||width>4096||height>4096||width*height>10000000)
      throw new Error('Logo dimensions exceed allowed limits');
  }else if(mime==='image/jpeg'){
    if(data.length<8||data[0]!==0xff||data[1]!==0xd8||data[2]!==0xff||
       data[data.length-2]!==0xff||data[data.length-1]!==0xd9)
      throw new Error('Invalid JPEG logo');
  }else throw new Error('Only PNG or JPEG logos are supported');
  // Decode the image with the same library the invoice PDF uses before persisting it.
  try{
    const doc=new PDFDocument({autoFirstPage:false});
    doc.openImage(data);
  }catch{throw new Error('Logo image could not be decoded');}
}
export function setHotelLogo(db,{mime,base64}={}){
  if(typeof base64!=='string'||!base64||base64.length>MAX_BYTES*2||
     !/^[A-Za-z0-9+/]+={0,2}$/.test(base64))
    throw new Error('Invalid base64 logo upload');
  const data=Buffer.from(base64,'base64');
  validLogo(data,mime);
  const sha256=createHash('sha256').update(data).digest('hex');
  return db.transaction(()=>{
    db.prepare('INSERT OR IGNORE INTO hotel_brand_assets(mime,sha256,data) VALUES(?,?,?)')
      .run(mime,sha256,data);
    const asset=db.prepare('SELECT id,mime,sha256 FROM hotel_brand_assets WHERE sha256=?').get(sha256);
    db.prepare('UPDATE active_hotel_logo SET asset_id=? WHERE id=1').run(asset.id);
    return asset;
  })();
}
export function getActiveLogoId(db){
  return db.prepare('SELECT asset_id FROM active_hotel_logo WHERE id=1').get()?.asset_id??null;
}
export function getLogoAsset(db,id){
  if(!Number.isSafeInteger(id)||id<1)return null;
  return db.prepare('SELECT id,mime,sha256,data FROM hotel_brand_assets WHERE id=?').get(id)||null;
}
export function getCurrentLogo(db){
  const id=getActiveLogoId(db);
  if(!id)return null;
  const asset=getLogoAsset(db,id);
  return asset?{id:asset.id,mime:asset.mime,sha256:asset.sha256}:null;
}
