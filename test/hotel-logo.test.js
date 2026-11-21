import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {setHotelLogo,getCurrentLogo,getLogoAsset,getActiveLogoId} from '../src/hotel-logo.js';
import {createProforma,getInvoice} from '../src/invoices.js';
import {prepareTaxDraft} from '../src/tax-draft.js';

const PNG='iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAIAAABvFaqvAAAAIklEQVR4nGM0SvFmoAZgooopowaNGjRq0KhBowaNGkQRAACtbwERSVj5XwAAAABJRU5ErkJggg==';
test('hotel logo assets are local and preserve historic invoice branding',async()=>{
  const db=openDatabase(':memory:');
  const server=createApp(db).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  try{
    const logo=setHotelLogo(db,{mime:'image/png',base64:PNG});
    assert.equal(getCurrentLogo(db).id,logo.id);
    assert.deepEqual(getLogoAsset(db,logo.id).data,Buffer.from(PNG,'base64'));
    const id=Number(db.prepare(`INSERT INTO bookings(guest_name,checkin,checkout,rooms_count,category,nightly_rate_paise)
      VALUES('Synthetic','2026-12-01','2026-12-02',1,'Unassigned',450000)`).run().lastInsertRowid);
    const issued=createProforma(db,id);
    assert.equal(issued.snapshot.logo_asset_id,logo.id);
    const draft=prepareTaxDraft(db,issued.id,{sac_codes:['996311']});
    assert.equal(draft.snapshot.logo_asset_id,logo.id);
    const image=await fetch(base+'/api/settings/logo/image');
    assert.equal(image.status,200);
    assert.equal(image.headers.get('content-type'),'image/png');
    const body=Buffer.from(await image.arrayBuffer());
    assert.deepEqual(body,Buffer.from(PNG,'base64'));
    const pdf=await fetch(base+'/api/invoices/'+issued.id+'/pdf');
    assert.equal(pdf.status,200);
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
    const tax=await fetch(base+'/api/tax-drafts/'+draft.id+'/pdf');
    assert.equal(tax.status,200);
    assert.equal(Buffer.from(await tax.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
    const different=Buffer.from(PNG,'base64');
    // Valid PNG data with a different hash; no need to render the modified asset in this test.
    different[different.length-5]^=1;
    const newer=setHotelLogo(db,{mime:'image/png',base64:different.toString('base64')});
    assert.notEqual(newer.id,logo.id);
    assert.equal(getInvoice(db,issued.id).snapshot.logo_asset_id,logo.id);
    assert.equal(getActiveLogoId(db),newer.id);
  }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});
test('unsafe and oversized logo uploads are rejected',()=>{
  const db=openDatabase(':memory:');
  try{
    assert.throws(()=>setHotelLogo(db,{mime:'image/svg+xml',base64:PNG}),/PNG or JPEG/);
    assert.throws(()=>setHotelLogo(db,{mime:'image/png',base64:Buffer.from('invalid').toString('base64')}),/Invalid PNG/);
    assert.throws(()=>setHotelLogo(db,{mime:'image/png',base64:Buffer.alloc(900000).toString('base64')}),/800 KB|base64/);
  }finally{db.close();}
});
