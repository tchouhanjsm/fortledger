import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {localLanIpCandidates} from '../src/phone-lan-address.js';

test('only RFC1918 non-loopback local IPv4 candidates shown; never infer Wi-Fi split',()=>{
 const interfaces={
  Ethernet:[{address:'192.168.1.15',family:'IPv4',internal:false},
    {address:'192.168.1.15',family:'IPv4',internal:false},
    {address:'169.254.0.2',family:'IPv4',internal:false}],
  WiFi:[{address:'10.0.0.14',family:4,internal:false},
    {address:'127.0.0.1',family:'IPv4',internal:true}],
  External:[{address:'8.8.8.8',family:'IPv4',internal:false},
    {address:'172.20.2.5',family:'IPv4',internal:false}],
  IPv6:[{address:'fd00::1',family:'IPv6',internal:false}]};
 assert.deepEqual(localLanIpCandidates(interfaces),
   ['10.0.0.14','172.20.2.5','192.168.1.15']);
 assert.deepEqual(localLanIpCandidates({}),[]);
 assert.deepEqual(localLanIpCandidates(null),[]);
});
test('phone address hints remain owner-only and never open a listener or weaken HTTPS',()=>{
 const server=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(server,/req.actor\?\.role!=='owner'/);
 assert.match(server,/lan_ip_candidates:lan\?\[\]:localLanIpCandidates\(\)/);
 assert.match(app,/identification hints, not live phone URLs/);
 assert.match(app,/no second Wi-Fi network is needed/);
 assert.doesNotMatch(app,/http:\/\/\$\{.*lan_ip_candidates/);
});
