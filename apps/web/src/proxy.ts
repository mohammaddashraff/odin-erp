import {NextRequest,NextResponse} from 'next/server';

/** One unpredictable script nonce per rendered document; never cache personalized HTML. */
export function proxy(request:NextRequest){
  const nonce=Buffer.from(crypto.randomUUID()).toString('base64');
  const development=process.env.NODE_ENV==='development';
  const policy=`default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self' data:; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob:; object-src 'none'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development?" 'unsafe-eval'":''}; style-src 'self' 'unsafe-inline'`;
  const headers=new Headers(request.headers);headers.set('x-nonce',nonce);headers.set('Content-Security-Policy',policy);
  const response=NextResponse.next({request:{headers}});response.headers.set('Content-Security-Policy',policy);response.headers.set('Cache-Control','private, no-store');return response;
}
export const config={matcher:[{source:'/((?!api|_next/static|_next/image|favicon.ico|brand/|fonts/).*)',missing:[{type:'header',key:'next-router-prefetch'},{type:'header',key:'purpose',value:'prefetch'}]}]};
