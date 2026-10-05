#!/usr/bin/env node
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {dataDirectory,openBrowser} from './runtime.ts';
import {detectedProviders,sourceRoots} from '../../core/src/security.ts';
import type {Store} from '../../core/src/storage.ts';
import {scan} from '../../core/src/scanner.ts';
import {startServer} from './server.ts';
const argv=process.argv.slice(2);const allowed=new Set(['--dry-run','--demo','--no-open','--scan-only','--help','--port','--data-dir','--verbose']);
function value(flag:string):string|undefined{const i=argv.indexOf(flag);return i<0?undefined:argv[i+1];}
async function main(){
  for(let i=0;i<argv.length;i++){if(!allowed.has(argv[i]))throw new Error('Unknown option. Use --help.');if(['--port','--data-dir'].includes(argv[i])){if(!argv[i+1]||argv[i+1].startsWith('--'))throw new Error('Option requires a value');i++;}}
  if(argv.includes('--help')){console.log('SubValue\n\nsubvalue [--dry-run] [--no-open] [--scan-only] [--verbose] [--port 4731] [--data-dir DIRECTORY]\nsubvalue --demo\n\nRequires Node.js 24.13+. No account or API keys.');return;}
  if(argv.includes('--dry-run')){const d=detectedProviders();console.log(`Codex       ${d.codex?'Detected':'Not detected'}\nClaude Code ${d.claude?'Detected':'Not detected'}\n\nSources:`);for(const r of sourceRoots())console.log(r.safeLabel);return;}
  const demo=argv.includes('--demo');const port=Number(value('--port')??4731);if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Invalid port');
  let store:Store|undefined;
  console.log('SubValue\n');
  if(!demo){const {Store}=await import('../../core/src/storage.ts');store=new Store(value('--data-dir')??dataDirectory());let last=0;const verbose=argv.includes('--verbose');const started=Date.now();console.log('Scanning local usage…');const result=await scan(store,{onProgress:p=>{if(Date.now()-last>1000||p.phase==='complete'){last=Date.now();const text=`${p.provider}: ${p.files}/${p.total} files · ${Math.round(p.bytes/1e6)} MB`;if(verbose)console.log(text);else if(process.stdout.isTTY)process.stdout.write(`\r${text.padEnd(65)}`);}}});if(!verbose&&process.stdout.isTTY)process.stdout.write('\r'+' '.repeat(65)+'\r');for(const s of result)console.log(`${s.provider==='codex'?'Codex      ':'Claude Code'} ${s.diagnostics.records?'✓':s.detected?'No usage found':'Not detected'}`);if(verbose)console.log(`${((Date.now()-started)/1000).toFixed(1)}s · ${result.reduce((n,s)=>n+s.cached,0)} files cached`);if(argv.includes('--scan-only')){store.close();return;}}
  const running=await startServer({store,port,publicDirectory:path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../public'),demo}).catch(e=>{store?.close();throw e;});
  let closing=false;const close=async()=>{if(closing)return;closing=true;await running.close();store?.close();process.exit(0);};process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());
  if(demo)console.log('DEMO — fixture data');
  if(!argv.includes('--no-open')){console.log('Opening dashboard…');console.log(running.url);if(!await openBrowser(running.url))console.log(`Open in your browser: ${running.url}`);}else console.log(running.url);
}
main().catch(()=>{console.error('SubValue could not start. Check the port, data-directory permissions, and Node version. No source files were modified.');process.exitCode=1;});
