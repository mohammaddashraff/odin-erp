/** Exact presentation only; never use floating point for persisted minor amounts. */
export function minorToDecimal(value:string|number,precision:number){
 if(!Number.isInteger(precision)||precision<0||precision>6)throw new Error('Unsupported currency precision.');
 const raw=String(value);if(!/^\d+$/.test(raw))throw new Error('Existing custom limit; edit its supported policy instead.');
 const digits=BigInt(raw).toString().padStart(precision+1,'0');return precision?`${digits.slice(0,-precision)}.${digits.slice(-precision)}`:digits;
}
export function decimalToMinor(value:string,precision:number){
 if(!Number.isInteger(precision)||precision<0||precision>6)throw new Error('Unsupported currency precision.');
 const match=value.trim().match(/^(\d+)(?:\.(\d+))?$/);
 if(!match||(match[2]||'').length>precision)throw new Error('Enter an exact amount within the displayed currency precision.');
 return (BigInt(match[1])*10n**BigInt(precision)+BigInt((match[2]||'').padEnd(precision,'0')||'0')).toString();
}
