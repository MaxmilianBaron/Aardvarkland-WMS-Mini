import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const port=Number(process.env.UI_PORT||4175);
const python=process.env.PYTHON || (process.platform==='win32' ? 'python' : 'python3');
const server=spawn(python,['-m','http.server',String(port),'--bind','127.0.0.1','--directory','dist'],{stdio:['ignore','ignore','ignore']});
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
try {
  let ready=false;
  for(let i=0;i<60;i++){try{if((await fetch(`http://127.0.0.1:${port}/`)).ok){ready=true;break;}}catch{}await sleep(250);}
  if(!ready)throw new Error('Preview HTTP server did not start');
  const child=spawn(process.execPath,['node_modules/@playwright/test/cli.js','test','--workers=1','--reporter=line'],{cwd:'e2e',stdio:'inherit',env:{...process.env,PREVIEW_URL:`http://127.0.0.1:${port}/`,MINI_PRODUCT_URL:`http://127.0.0.1:${port}/app/`}});
  process.exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
} finally {server.kill('SIGTERM');}
