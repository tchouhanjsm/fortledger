import path from 'node:path';

export function dataDirectory(env=process.env){
  return path.resolve(env.FORTLEDGER_DATA_DIR || 'data');
}
export function databasePath(env=process.env){
  return path.resolve(env.FORTLEDGER_DB || path.join(dataDirectory(env),'fortledger.sqlite'));
}
export function authPath(env=process.env){
  return path.resolve(env.FORTLEDGER_AUTH_FILE || path.join(dataDirectory(env),'admin-auth.json'));
}
