import os from 'node:os';
import {isPrivateLanIp} from './network-policy.js';

/** Owner-only read-only address hints, never server-binding instructions.
 * LAN interface enumeration may include VPNs or virtual adapters; do not
 * claim that any candidate is reachable from a particular staff phone. */
export function localLanIpCandidates(interfaces=os.networkInterfaces()){
  if(!interfaces||typeof interfaces!=='object')return [];
  const addresses=new Set();
  for(const list of Object.values(interfaces)){
    if(!Array.isArray(list))continue;
    for(const item of list){
      if(!item||item.internal===true||
         !['IPv4',4].includes(item.family)||!isPrivateLanIp(item.address))continue;
      addresses.add(item.address);
    }
  }
  return [...addresses].sort().slice(0,8);
}
