/**
 * FortLedger V2 Phase 0: fail-closed single-machine HTTP boundary.
 *
 * A remote Host header directed at a loopback-bound server can be a DNS
 * rebinding attempt. Do not accept it even when the TCP connection is local.
 * Future private-LAN support must replace this policy only alongside reviewed
 * TLS, origin/cookie and device-access rules.
 */
const VALID_LOCAL_HOST=/^(?:localhost|127\.0\.0\.1)(?::[0-9]{1,5})?$/i;

export function isAllowedLocalHost(value){
  if(typeof value!=='string'||!VALID_LOCAL_HOST.test(value))return false;
  const port=value.slice(value.lastIndexOf(':')+1);
  if(value.includes(':')&&(!Number.isInteger(Number(port))||Number(port)<1||Number(port)>65535))
    return false;
  return true;
}

export function requireLoopbackHost(req,res,next){
  if(!isAllowedLocalHost(req.headers.host)){
    res.setHeader('Cache-Control','no-store');
    return res.status(421).json({error:'FortLedger is available on localhost only. Use http://127.0.0.1:3000 on this computer.'});
  }
  next();
}

export function localListenerSettings(env=process.env){
  const configured=String(env.FORTLEDGER_HOST||'127.0.0.1').trim();
  if(configured!=='127.0.0.1'&&configured!=='localhost')
    throw new Error('Unsafe FORTLEDGER_HOST: remote/LAN binding is not supported until the V2 HTTPS and network-security gates are complete');
  const raw=String(env.PORT??'3000');
  if(!/^[0-9]{1,5}$/.test(raw)||Number(raw)<1||Number(raw)>65535)
    throw new Error('PORT must be a valid TCP port (1–65535)');
  return {host:configured,port:Number(raw)};
}
