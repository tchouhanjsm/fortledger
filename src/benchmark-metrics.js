/** Pure synthetic benchmark helpers; never reads real guest records. */
export function summarizeSamples(values){
  if(!Array.isArray(values)||values.length===0||
      values.some(value=>typeof value!=='number'||!Number.isFinite(value)||value<0))
    throw new Error('Finite nonnegative benchmark samples required');
  const ascending=[...values].sort((a,b)=>a-b);
  const quantile=p=>ascending[Math.max(0,Math.ceil(p*ascending.length)-1)];
  return {count:values.length,p50_ms:+quantile(0.5).toFixed(2),
    p95_ms:+quantile(0.95).toFixed(2),max_ms:+ascending.at(-1).toFixed(2)};
}
