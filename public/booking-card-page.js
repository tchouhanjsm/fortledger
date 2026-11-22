/** Only limit DOM cards, never booking availability, search, payments or history. */
export const BOOKING_CARD_BATCH=40;

export function bookingCardPage(matches,visibleCount=BOOKING_CARD_BATCH){
  if(!Array.isArray(matches)||!Number.isSafeInteger(visibleCount)||visibleCount<1)
    throw new Error('Valid booking matches and visible count required');
  const items=matches.slice(0,visibleCount);
  return {items,total:matches.length,shown:items.length,
    remaining:matches.length-items.length,hasMore:matches.length>items.length};
}
