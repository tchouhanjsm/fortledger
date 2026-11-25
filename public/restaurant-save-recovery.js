// A failed response is not proof the cashier's financial write failed.
// Only a definitive rejection plus an authoritative "not recorded" lookup
// may release the original request ID. Unknown outcomes remain retryable.
export async function reconcileRestaurantSaveFailure(error,lookup){
 const definitive=[400,403,409,422].includes(error?.httpStatus);
 try{
   const receipt=await lookup();
   if(receipt?.recorded===true&&Number.isSafeInteger(receipt.id)&&receipt.id>0)
     return definitive?{state:'uncertain',detail:'The request is recorded but its rejection conflicts with that receipt. Review saved bills before retrying.'}:
       {state:'recorded',id:receipt.id};
   if(receipt?.recorded===false&&definitive)return {state:'rejected'};
   return {state:'uncertain',detail:'Bill outcome not confirmed. Check saved bills and retry only the original request.'};
 }catch{
   return {state:'uncertain',detail:'Could not verify the original request. Check saved bills and retry only the original request after reconnecting.'};
 }
}
