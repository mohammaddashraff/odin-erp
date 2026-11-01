/** Search/review keys only. Keep original contact spelling and never auto-merge people. */
export function contactDigits(value:string):string {
  return value.normalize('NFKC').replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776));
}
export function normalizedPhone(value:string):string {return contactDigits(value).replace(/[^0-9]/g,'').replace(/^00/,'');}
export function normalizedName(value:string):string {return value.normalize('NFKC').toLowerCase().replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/[ـ\u064b-\u065f\u0670]/g,'').replace(/\s+/g,' ').trim();}
export function contactKeys(value:{name:string;phone:string;email?:string}) {return {normalizedName:normalizedName(value.name),normalizedPhone:normalizedPhone(value.phone),normalizedEmail:(value.email||'').trim().toLowerCase()};}
export function contactMatches(value:{name:string;phone:string;email?:string}) {const keys=contactKeys(value);return [{normalizedName:keys.normalizedName},{normalizedPhone:keys.normalizedPhone},...(keys.normalizedEmail?[{normalizedEmail:keys.normalizedEmail}]:[])];}
