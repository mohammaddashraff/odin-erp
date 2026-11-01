import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
const git=(args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:64*1024*1024});
if(existsSync('.git/shallow'))throw new Error('Full Git history is required for the history secret scan. Fetch history before release.');
const patterns=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,/\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b/,/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,/\bAIza[0-9A-Za-z_-]{35}\b/,/\b(?:sk|rk)_live_[0-9A-Za-z]{16,}\b/,/\bnpm_[A-Za-z0-9]{30,}\b/];
const entries=git(['rev-list','--objects','--all']).trim().split('\n'),findings=[];let scanned=0;
for(const line of entries){const [oid,...parts]=line.split(' '),file=parts.join(' ');if(!file||!/(?:\.(?:[cm]?js|ts|tsx|json|md|txt|sql|yml|yaml|env|example|prisma)|(?:^|\/)\.env.*)$/.test(file))continue;const content=git(['show',oid]);scanned++;if(patterns.some(pattern=>pattern.test(content)))findings.push({object:oid,file});}
console.log(JSON.stringify({status:findings.length?'FAIL':'PASS',commits:Number(git(['rev-list','--all','--count']).trim()),textObjects:scanned,findings,scope:'High-confidence secret formats across full reachable Git history; no credential values printed'},null,2));if(findings.length)process.exitCode=1;
