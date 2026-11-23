
import {planMenuImport} from './restaurant.js';
import {recordAudit} from './financial-audit.js';

// Bundled from the owner's four-page "Garh Jaisal Menu.pdf" and previously
// supplied provisional GST5 CSV. Printed menu shows prices, but not tax rates.
// All 5% tax entries REQUIRE operator/accountant verification before loading.
// No filesystem reads at runtime: installer packaging always includes this catalog.
export const GARH_JAISAL_MENU_SOURCE='Garh Jaisal Kitchen menu (August 2026), provisional 5% GST';
export const GARH_JAISAL_MENU_CSV="name,category,price,tax_rate\nOmelette Plain,Egg,150.0,5\nOmelette Veg.,Egg,200.0,5\nOmelette,Egg,200.0,5\nOmelette Cheese Tomato,Egg,200.0,5\nScrambled Egg Toast,Egg,200.0,5\nScrambled Veg. Cheese,Egg,200.0,5\nBoiled Egg 2 Pcs,Egg,80.0,5\nFried Egg Toast,Egg,180.0,5\nFried Egg,Egg,150.0,5\nToast Butter Jam 4 Pcs,Egg,120.0,5\nMix Fruit Pancake,Pancakes,250.0,5\nNutella Pancake,Pancakes,250.0,5\nBanana Pancake,Pancakes,200.0,5\nHoney Pancake,Pancakes,200.0,5\nPlain Pancake,Pancakes,150.0,5\nLemon Sugar Pancake,Pancakes,200.0,5\nChocolate Pancake,Pancakes,200.0,5\nMix Fruit Porridge,Porridge,220.0,5\nBanana Honey Porridge,Porridge,200.0,5\nPlain Porridge,Porridge,180.0,5\nMuesli Mix Fruit Curd,Porridge,250.0,5\nMuesli Curd,Porridge,200.0,5\nMasala Chai,Hot Drinks,80.0,5\nBlack/Green/Lemon/Milk/Mint Tea,Hot Drinks,80.0,5\nHot Lemon Ginger Honey,Hot Drinks,100.0,5\nBlack / Milk Coffee,Hot Drinks,80.0,5\nCappuccino,Hot Drinks,200.0,5\nCoffee Espresso,Hot Drinks,180.0,5\nOrange Juice,Juice,150.0,5\nApple Juice,Juice,120.0,5\nMango Juice,Juice,120.0,5\nLitchi Juice,Juice,120.0,5\nPineapple Juice,Juice,180.0,5\nParatha Aloo/Gobhi/Cheese/Veg.,Local Breakfast,130.0,5\nPoha,Local Breakfast,180.0,5\nPlain Paratha,Local Breakfast,80.0,5\nDal Pakwan,Local Breakfast,130.0,5\nKachori/Samosa 2 Pcs,Local Breakfast,100.0,5\nCoke/Sprite/Maaza,Cold Drinks,80.0,5\nSoda Water,Cold Drinks,80.0,5\nLemon Soda,Cold Drinks,100.0,5\nWater,Cold Drinks,50.0,5\nDiet Coke,Cold Drinks,120.0,5\nPlain Yogurt,Yogurt,100.0,5\nCurd with Honey,Yogurt,120.0,5\nBanana Honey Yogurt,Yogurt,150.0,5\nMix Fruit Yogurt,Yogurt,150.0,5\nBundi Raita,Yogurt,230.0,5\nVeg. Raita,Yogurt,230.0,5\nCheese Tomato,Sandwich,180.0,5\nVeg. Cheese Sandwich,Sandwich,230.0,5\nEgg Cheese Sandwich,Sandwich,250.0,5\nChicken Cheese Sandwich,Sandwich,300.0,5\nVeg. Fried Rice,Chinese,250.0,5\nChicken Fried Rice,Chinese,300.0,5\nVeg. Chowmein,Chinese,280.0,5\nChicken Chowmein,Chinese,300.0,5\nChilli Chicken,Chinese,380.0,5\nChicken Manchurian,Chinese,380.0,5\nVeg. Manchurian,Chinese,300.0,5\nEgg Fried Rice,Chinese,280.0,5\nMakhaniya Lassi,Lassi & Shake,150.0,5\nMix Fruit Lassi,Lassi & Shake,150.0,5\nMango Lassi,Lassi & Shake,140.0,5\nBanana Lassi,Lassi & Shake,140.0,5\nSweet/Salt Lassi,Lassi & Shake,120.0,5\nBanana Milk Shake,Lassi & Shake,140.0,5\nMix Fruit Shake,Lassi & Shake,150.0,5\nCold Coffee,Lassi & Shake,150.0,5\nTomato Soup,Soup,180.0,5\nVegetable Soup,Soup,200.0,5\nChicken Soup,Soup,250.0,5\nVeg. Hot & Sour Soup,Soup,250.0,5\nChicken Hot & Sour Soup,Soup,280.0,5\nGreen Salad,Salad,150.0,5\nCucumber Salad,Salad,150.0,5\nMix Fruit Salad,Salad,250.0,5\nMix Veg. Salad,Salad,200.0,5\nIsraeli Salad,Salad,200.0,5\nVegetable Pakora,Pakora,260.0,5\nOnion / Potato Pakora,Pakora,220.0,5\nChicken Pakora,Pakora,300.0,5\nFrench Fries,Pakora,280.0,5\nPaneer Pakora,Pakora,280.0,5\nPeanut Masala,Pakora,150.0,5\nPapad Masala,Pakora,130.0,5\nPapad Roasted,Pakora,50.0,5\nCheese Tomato Spaghetti,Spaghetti,300.0,5\nCheese Tomato Onion Spaghetti,Spaghetti,330.0,5\nVeg. Cheese Spaghetti,Spaghetti,300.0,5\nChicken Spaghetti,Spaghetti,380.0,5\nCheese Tomato,Macroni,280.0,5\nCheese Tomato Onion,Macroni,300.0,5\nVeg. Cheese,Macroni,300.0,5\nChicken Cheese Veg.,Macroni,380.0,5\nPaneer Butter Masala,Indian Veg.,350.0,5\nShahi Paneer,Indian Veg.,350.0,5\nPalal Paneer,Indian Veg.,380.0,5\nMatar Paneer,Indian Veg.,350.0,5\nKadai Paneer,Indian Veg.,380.0,5\nMix Veg.,Indian Veg.,300.0,5\nAloo Gobhi,Indian Veg.,280.0,5\nDal Tadka,Indian Veg.,280.0,5\nDal Fry,Indian Veg.,250.0,5\nCurry Pakora,Indian Veg.,350.0,5\nKaju Curry,Indian Veg.,350.0,5\nMalai Kofta,Indian Veg.,380.0,5\nKer Sangri,Indian Veg.,380.0,5\nJeera Aloo,Indian Veg.,250.0,5\nNavratan Korma,Indian Veg.,350.0,5\nGatta Curry,Indian Veg.,350.0,5\nWhite Sauce Pasta,Pasta,350.0,5\nRed Sauce Pasta,Pasta,350.0,5\nPasta Masala Indian Style,Pasta,350.0,5\nChicken Cheese Pasta,Pasta,400.0,5\nPlain Rice,Rice,140.0,5\nJeera Rice,Rice,150.0,5\nVeg. Pulao,Rice,250.0,5\nVeg. Biryani,Rice,280.0,5\nChicken Biryani,Rice,320.0,5\nKashmiri Pulao,Rice,300.0,5\nPlain Naan,Naan,140.0,5\nButter Naan,Naan,150.0,5\nGarlic Cheese Naan,Naan,250.0,5\nCheese Naan,Naan,280.0,5\nChapati,Naan,320.0,5\nButter Chapati,Naan,300.0,5\nRas Malai,Dessert,280.0,5\nGhotua,Dessert,160.0,5\nGulab Jamun,Dessert,160.0,5\nHalwa,Dessert,220.0,5\nBanana Fritters,Dessert,220.0,5\nIce Cream,Dessert,120.0,5\nChicken Curry,Chicken,350.0,5\nChicken Masala,Chicken,380.0,5\nHalf Butter Chicken,Chicken,600.0,5\nChicken Do Pyaza,Chicken,350.0,5\nChicken Tikka Masala,Chicken,600.0,5\nEgg Curry,Chicken,280.0,5\nLal Maas,Mutton,700.0,5\nMutton Curry,Mutton,600.0,5\nMutton Masala,Mutton,650.0,5\n";
export const GARH_JAISAL_MENU_COUNT=142;

/** Preview ALL rows against the live menu; only missing rows can be inserted. */
export function planBundledMenuSync(db,{signingKey}={}){
  const plan=planMenuImport(db,GARH_JAISAL_MENU_CSV,{signingKey});
  const missing=plan.preview.filter(x=>x.existing_id===null).length;
  return {
    source:GARH_JAISAL_MENU_SOURCE,
    count:GARH_JAISAL_MENU_COUNT,
    missing,
    preserved:plan.count-missing,
    tax_rates:plan.tax_rates,
    category_counts:plan.category_counts,
    // Never imply existing menu rows need to be updated/reactivated.
    preview:plan.preview.map(x=>({
      name:x.name,category:x.category,price_paise:x.price_paise,tax_rate:x.tax_rate,
      change:x.existing_id===null?'missing':'preserved',
      existing_price_paise:x.old_price_paise,existing_tax_rate:x.old_tax_rate,
      existing_active:x.existing_id===null?null:!x.reactivates,
    })),
    preview_token:plan.preview_token
  };
}

/** Append-only menu sync: preserve existing prices, GST, visibility, and IDs.
 * A stale signed preview rejects the entire transaction, no partial writes.
 */
export function applyBundledMenuSync(db,input={},actor,{signingKey}={}){
  if(!actor||!['owner','manager'].includes(actor.role))
    throw new Error('Only owner or manager can sync the built-in menu');
  if(input.confirm_sync!==true||input.confirm_provisional_gst!==true)
    throw new Error('Confirm the missing-item preview and acknowledge provisional GST rates');
  if(typeof input.preview_token!=='string'||!input.preview_token||!signingKey)
    throw new Error('Review the current built-in menu before syncing');
  return db.transaction(()=>{
    const plan=planBundledMenuSync(db,{signingKey});
    if(plan.preview_token!==input.preview_token)
      throw new Error('Menu changed after the built-in preview; review current prices and try again');
    const insert=db.prepare(
      'INSERT INTO menu_items(name,category,price_paise,tax_rate,active) VALUES(?,?,?,?,1)');
    let added=0;
    for(const item of plan.preview){
      if(item.change!=='missing')continue;
      const result=insert.run(item.name,item.category,item.price_paise,item.tax_rate);
      added++;
      recordAudit(db,actor,'menu_item.bundled_added','menu_item',Number(result.lastInsertRowid),{
        source:'garh-jaisal-2026-menu',price_paise:item.price_paise,tax_rate:item.tax_rate
      });
    }
    return {added,preserved:plan.preserved,total:plan.count,
      notice:'Existing menu prices, GST, visibility, and historical bills were not changed'};
  })();
}
