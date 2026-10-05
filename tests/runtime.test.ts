import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {dataDirectory,openBrowser} from '../packages/cli/src/runtime.ts';
import {startServer} from '../packages/cli/src/server.ts';

test('persistent default directory follows each OS convention',()=>{
  const local=path.resolve('local');assert.equal(dataDirectory('win32','user',{LOCALAPPDATA:local}),path.join(local,'SubValue'));
  assert.equal(dataDirectory('win32','user',{LOCALAPPDATA:'relative'}),path.join('user','AppData','Local','SubValue'));
  assert.equal(dataDirectory('darwin','user',{}),path.join('user','Library','Application Support','SubValue'));
  assert.equal(dataDirectory('linux','user',{}),path.join('user','.local','share','subvalue'));
  assert.equal(dataDirectory('linux','user',{XDG_DATA_HOME:'relative'}),path.join('user','.local','share','subvalue'));
});
test('occupied preferred port falls back to an OS-selected loopback port',async()=>{
  const first=await startServer({port:0,demo:true,publicDirectory:'packages/cli/dist/public'});
  const second=await startServer({port:Number(new URL(first.url).port),demo:true,publicDirectory:'packages/cli/dist/public'});
  try{assert.notEqual(second.url,first.url);assert.equal((second.server.address() as {address:string}).address,'127.0.0.1');assert.equal((await fetch(second.url)).status,200);}finally{await second.close();await first.close();}
});
test('browser launcher reports a failing opener and never executes a shell',async()=>{
  let checked=false;const launch=((_command:string,args:string[],options:{windowsHide:boolean;stdio:string})=>{checked=true;assert.deepEqual(args,['url.dll,FileProtocolHandler','http://127.0.0.1:4731']);assert.equal(options.windowsHide,true);const child=new EventEmitter();setTimeout(()=>child.emit('exit',1),0);return child;}) as unknown as typeof spawn;
  assert.equal(await openBrowser('http://127.0.0.1:4731',launch,'win32'),false);assert.ok(checked);
  assert.equal(await openBrowser('https://remote.invalid',launch),false);
});
test('bundled fonts and dashboard are served without cross-origin permissions',async()=>{const server=await startServer({port:0,demo:true,publicDirectory:'packages/cli/dist/public'});try{const font=await fetch(server.url+'/fonts/inter-latin.woff2');assert.equal(font.status,200);assert.equal(font.headers.get('Access-Control-Allow-Origin'),null);assert.equal(font.headers.get('Content-Type'),'font/woff2');}finally{await server.close();}});
test('macOS and Linux open the loopback URL with their native browser opener',async()=>{
  for(const [platform,expected] of [['darwin','open'],['linux','xdg-open']] as const){
    const launch=((command:string,args:string[],options:Record<string,unknown>)=>{
      assert.equal(command,expected);assert.deepEqual(args,['http://127.0.0.1:4731']);assert.equal(options.shell,undefined);
      const child=new EventEmitter();setTimeout(()=>child.emit('exit',0),0);return child;
    }) as unknown as typeof spawn;
    assert.equal(await openBrowser('http://127.0.0.1:4731',launch,platform),true);
  }
});
test('a reserved port falls back without requesting elevated OS permissions',async()=>{const original=http.Server.prototype.listen;let server:Awaited<ReturnType<typeof startServer>>|undefined;http.Server.prototype.listen=function(this:http.Server,...args:any[]){if(args[0]===4731){process.nextTick(()=>this.emit('error',Object.assign(new Error('Reserved port'),{code:'EACCES'})));return this;}return (original as any).apply(this,args);} as typeof original;try{server=await startServer({port:4731,demo:true,publicDirectory:'packages/cli/dist/public'});assert.notEqual(new URL(server.url).port,'4731');assert.equal((server.server.address() as {address:string}).address,'127.0.0.1');}finally{http.Server.prototype.listen=original;await server?.close();}});
