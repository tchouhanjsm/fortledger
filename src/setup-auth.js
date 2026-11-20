import { savePasswordRecord,DEFAULT_AUTH_FILE } from './auth.js';

function hiddenPrompt(message){
  return new Promise((resolve,reject)=>{
    if(!process.stdin.isTTY){reject(new Error('Run this setup from an interactive terminal'));return;}
    process.stdout.write(message);
    let value='';
    const stdin=process.stdin;stdin.setRawMode(true);stdin.resume();stdin.setEncoding('utf8');
    const listener=data=>{
      for(const char of data){
        if(char==='\r'||char==='\n'){
          stdin.removeListener('data',listener);stdin.setRawMode(false);stdin.pause();
          process.stdout.write('\n');resolve(value);return;
        }
        if(char==='\u0003'){stdin.removeListener('data',listener);stdin.setRawMode(false);stdin.pause();process.stdout.write('\n');reject(new Error('Cancelled'));return;}
        if(char==='\u007f'||char==='\b'){if(value.length){value=value.slice(0,-1);process.stdout.write('\b \b');}}
        else if(char>=' '&&value.length<256){value+=char;process.stdout.write('*');}
      }
    };
    stdin.on('data',listener);
  });
}
try{
  const first=await hiddenPrompt('Create local admin password (12+ characters): ');
  const second=await hiddenPrompt('Confirm local admin password: ');
  if(first!==second)throw new Error('Passwords do not match');
  savePasswordRecord(DEFAULT_AUTH_FILE,first);
  console.log('Local admin password created. Run npm start and log in.');
}catch(error){console.error(error.message);process.exitCode=1;}
