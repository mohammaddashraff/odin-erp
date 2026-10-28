import {getVercelOidcToken} from '@vercel/oidc';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

/** Fixed-origin proxy: platform identity stays server-side; ERP auth is preserved. */
async function proxy(request:Request) {
  const hosted=process.env.AV8_ENV==='production';
  const origin=hosted?'https://av8-erp-api.vercel.app':'http://127.0.0.1:8181';
  const incoming=new URL(request.url);
  if(!incoming.pathname.startsWith('/api/'))return new Response(null,{status:404});
  const headers=new Headers();
  for(const name of ['authorization','content-type','accept','accept-language','cookie','origin','idempotency-key','x-odin-language','x-odin-step-up','user-agent']){
    const value=request.headers.get(name);if(value)headers.set(name,value);
  }
  // Preserve the real client address for the existing authentication throttle.
  const ip=request.headers.get('x-vercel-forwarded-for');if(ip)headers.set('x-forwarded-for',ip);
  try {
    if(hosted){
      const identity=await getVercelOidcToken();
      if(!identity)return Response.json({message:'API identity unavailable'},{status:503});
      headers.set('x-vercel-trusted-oidc-idp-token',identity);
    }
    const result=await fetch(origin+incoming.pathname+incoming.search,{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:await request.arrayBuffer(),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(55000)});
    const outgoing=new Headers({'Cache-Control':'no-store'});
    for(const name of ['content-type','content-disposition','x-request-id','x-av8-scan']){const value=result.headers.get(name);if(value)outgoing.set(name,value);}
    for(const cookie of result.headers.getSetCookie())outgoing.append('set-cookie',cookie);
    return new Response(result.body,{status:result.status,headers:outgoing});
  }catch{return Response.json({message:'AV8 API is temporarily unavailable'},{status:502});}
}
export {proxy as GET,proxy as POST,proxy as PUT,proxy as PATCH,proxy as DELETE,proxy as OPTIONS,proxy as HEAD};
