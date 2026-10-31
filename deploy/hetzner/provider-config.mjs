import fs from 'node:fs';

const allowed=new Set(['AV8_ACADEMIC_EMAIL_API_KEY','AV8_ACADEMIC_EMAIL_FROM','AV8_ACADEMIC_EMAIL_REPLY_TO']);
export function providerReplyTo(value){
  if(value===undefined||value===null||value==='')return undefined;
  if(typeof value!=='string'||/[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(value))throw new Error('Reply-To must be one valid email address');
  const address=value.trim().toLowerCase();if(!address)return undefined;const [local,domain]=address.split('@');
  if(address.length>254||!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(address)||local.length>64||local.startsWith('.')||local.endsWith('.')||local.includes('..')||domain.split('.').some(label=>label.length>63))throw new Error('Reply-To must be one valid email address');
  return address;
}
export function providerSender(value){
  if(typeof value!=='string'||value.length>400||/[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(value))throw new Error('Configure one verified sender mailbox');
  const sender=value.trim(),match=/^([^<>]+?)\s*<([^<>]+)>$/.exec(sender);
  if(match){const name=match[1].trim(),address=providerReplyTo(match[2]);if(!name||name.length>120||/[<>,;:"\\@]/.test(name)||!address)throw new Error('Configure one verified sender mailbox');return `${name} <${address}>`;}
  const address=providerReplyTo(sender);if(!address)throw new Error('Configure one verified sender mailbox');return address;
}
export function parseProviderConfiguration(source){
  if(typeof source!=='string'||Buffer.byteLength(source)>16384)throw new Error('Provider configuration must be a small private environment file');
  const seen=new Set(),values={};
  for(const original of source.split(/\r?\n/)){
    const line=original.trim();if(!line||line.startsWith('#'))continue;
    const match=/^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if(!match||!allowed.has(match[1]))throw new Error('Provider configuration contains an unsupported field or format');
    const key=match[1];if(seen.has(key))throw new Error('Provider configuration contains a duplicate field');seen.add(key);
    let value=match[2];
    if(value.startsWith('"')||value.startsWith("'")){
      const quote=value[0],end=value.indexOf(quote,1);if(end<0||!/^\s*(?:#.*)?$/.test(value.slice(end+1)))throw new Error('Provider configuration contains an invalid quoted value');value=value.slice(1,end);
    }else value=value.replace(/\s+#.*$/,'').trim();
    if(/[\r\n\0]/.test(value)||value.includes('${'))throw new Error('Provider configuration must contain literal single-line values');
    if(value)values[key]=key==='AV8_ACADEMIC_EMAIL_REPLY_TO'?providerReplyTo(value):key==='AV8_ACADEMIC_EMAIL_FROM'?providerSender(value):value;
  }
  return values;
}
export function loadProviderConfiguration(file,environment=process.env){
  let source;try{if(fs.statSync(file).size>16384)throw new Error('Provider configuration exceeds its size limit');source=fs.readFileSync(file,'utf8');}catch(error){if(error.code==='ENOENT')return environment;throw error;}
  Object.assign(environment,parseProviderConfiguration(source));return environment;
}
