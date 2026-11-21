/**
 * Explicit, fail-closed network policy. Local HTTP remains the default.
 * Staff LAN mode requires a private IPv4 interface and direct TLS (no proxy).
 */
import {isIP} from 'node:net';
import {readFileSync} from 'node:fs';
import {X509Certificate,createPrivateKey,createPublicKey} from 'node:crypto';
import {createSecureContext} from 'node:tls';

const VALID_LOCAL_HOST=/^(?:localhost|127\.0\.0\.1)(?::[0-9]{1,5})?$/i;

export function isAllowedLocalHost(value){
  if(typeof value!=='string'||!VALID_LOCAL_HOST.test(value))return false;
  const port=value.slice(value.lastIndexOf(':')+1);
  if(value.includes(':')&&(!Number.isInteger(Number(port))||Number(port)<1||Number(port)>65535))
    return false;
  return true;
}

export function isPrivateLanIp(value){
  if(isIP(value)!==4)return false;
  const octets=value.split('.').map(Number);
  return octets[0]===10||
    (octets[0]===172&&octets[1]>=16&&octets[1]<=31)||
    (octets[0]===192&&octets[1]===168);
}

export function requireLoopbackHost(req,res,next){
  if(!isAllowedLocalHost(req.headers.host)){
    res.setHeader('Cache-Control','no-store');
    return res.status(421).json({error:'FortLedger is available on localhost only. Use http://127.0.0.1:3000 on this computer.'});
  }
  next();
}

export function requireConfiguredHost(settings){
  if(settings?.mode!=='lan')return requireLoopbackHost;
  const expected=settings.host+':'+settings.port;
  return (req,res,next)=>{
    // Do not trust forwarded headers or proxy-provided transport identity.
    if(req.headers.host!==expected||!req.socket.encrypted){
      res.setHeader('Cache-Control','no-store');
      return res.status(421).json({error:'Secure staff-LAN HTTPS host required'});
    }
    next();
  };
}

export function localListenerSettings(env=process.env){
  const configured=String(env.FORTLEDGER_HOST||'127.0.0.1').trim();
  const raw=String(env.PORT??'3000');
  if(!/^[0-9]{1,5}$/.test(raw)||Number(raw)<1||Number(raw)>65535)
    throw new Error('PORT must be a valid TCP port (1–65535)');
  const port=Number(raw);
  const enabled=env.FORTLEDGER_LAN_ENABLED;
  if(enabled!==undefined&&enabled!=='0'&&enabled!=='1')
    throw new Error('FORTLEDGER_LAN_ENABLED must be 0 or 1');
  if(enabled==='1'){
    if(!isPrivateLanIp(configured))
      throw new Error('Unsafe FORTLEDGER_HOST: LAN mode requires a specific RFC1918 private IPv4 interface');
    if(!env.FORTLEDGER_TLS_CERT||!env.FORTLEDGER_TLS_KEY)
      throw new Error('LAN HTTPS requires FORTLEDGER_TLS_CERT and FORTLEDGER_TLS_KEY');
    return {mode:'lan',host:configured,port,
      certPath:String(env.FORTLEDGER_TLS_CERT),keyPath:String(env.FORTLEDGER_TLS_KEY)};
  }
  if(configured!=='127.0.0.1'&&configured!=='localhost')
    throw new Error('Unsafe FORTLEDGER_HOST: remote/LAN binding is not supported until explicitly enabled with HTTPS');
  if(env.FORTLEDGER_TLS_CERT||env.FORTLEDGER_TLS_KEY)
    throw new Error('TLS credentials require explicitly enabled LAN mode');
  return {host:configured,port};
}

export function readLanTlsCredentials(settings){
  if(settings?.mode!=='lan')throw new Error('LAN settings required');
  const cert=readFileSync(settings.certPath);
  const key=readFileSync(settings.keyPath);
  const x509=new X509Certificate(cert);
  const now=Date.now();
  if(!x509.checkIP(settings.host)||now<Date.parse(x509.validFrom)||now>Date.parse(x509.validTo))
    throw new Error('LAN TLS certificate must be valid now and include the bound private IP in its SAN');
  const certKey=x509.publicKey.export({type:'spki',format:'der'});
  const privatePublic=createPublicKey(createPrivateKey(key)).export({type:'spki',format:'der'});
  if(!certKey.equals(privatePublic))throw new Error('LAN TLS certificate and key do not match');
  createSecureContext({cert,key,minVersion:'TLSv1.2'});
  return {cert,key};
}
