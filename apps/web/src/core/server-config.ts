import {isIP} from 'node:net';
type Environment = Record<string, string | undefined>;
export const av8WebProduction = {
  projectId: 'prj_uhdt4Zm1BiauDHJeHoMa1ccO2GvG',
  apiProjectId: 'prj_iHlpBv6jtRpJLOOHwNOyitAeovck',
  apiOrigin: 'https://av8-erp-api.vercel.app',
  webOrigin: 'https://av8-erp.vercel.app',
} as const;

function stagingOrigin(value: string | undefined): string {
  if (!value) throw new Error('Configure an explicit HTTPS staging origin');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Configure a valid HTTPS staging origin'); }
  const host=url.hostname.toLowerCase();
  if(url.protocol!=='https:' || url.origin!==value || url.username || url.password || url.port || ['localhost','127.0.0.1','[::1]'].includes(host) || host.endsWith('.localhost') || host.includes('odin') || [av8WebProduction.apiOrigin,av8WebProduction.webOrigin].some(origin=>origin===url.origin))
    throw new Error('Staging requires a distinct HTTPS origin without credentials, path or live-target fallback');
  return url.origin;
}

/** Called by the build configuration and every server-side API proxy request. */
export function av8WebConfiguration(env: Environment) {
  const mode=env.AV8_ENV;
  if(env.AV8_OUTBOUND!=='disabled' || !['dev','test','production','staging'].includes(mode||''))throw new Error('Start AV8 with its verified isolated configuration');
  const hosted=mode==='production'||mode==='staging';
  if(env.ODIN_UI_BUILD_DIR!==(hosted?'.next':'.next-av8'))throw new Error('Unexpected AV8 frontend build directory');
  if(hosted&&env.AV8_HOSTING==='hetzner'){
    const deploymentId=env.AV8_HETZNER_DEPLOYMENT_ID||'';
    if(env.NODE_ENV!=='production'||!/^[a-z0-9][a-z0-9_-]{7,99}$/.test(deploymentId)||env.AV8_HETZNER_RESOURCE!==`av8-erp-${mode}:${deploymentId}`)throw new Error('Hetzner requires its explicit isolated deployment identity');
    if(env.NEXT_PUBLIC_ODIN_DEMO_MODE!=='false'||env.ODIN_ALLOW_SHARED_DEMO_LOGINS!=='false'||env.ODIN_REQUIRE_PRIVILEGED_MFA!=='true'||env.AV8_SIMPLE_LOGIN==='true'||env.ODIN_DEPLOYMENT_MODE==='demo')throw new Error('Hosted AV8 requires privileged MFA with demo and shared login disabled');
    const publicOrigin=env.ODIN_PUBLIC_ORIGIN||'';let origin:URL;
    try{origin=new URL(publicOrigin);}catch{throw new Error('Configure an explicit public origin');}
    if(origin.origin!==publicOrigin||origin.username||origin.password||env.ODIN_WEB_ORIGIN!==publicOrigin)throw new Error('Public and web origins must match exactly');
    if(mode==='production'&&publicOrigin!=='https://av8.odin-ltd.com')throw new Error('Unexpected production public origin');
    if(mode==='staging'){
      const loopback=origin.protocol==='http:'&&origin.hostname==='127.0.0.1'&&Number(origin.port)>=1024&&Number(origin.port)<=65535;
      if(env.AV8_STAGING_PUBLIC_ORIGIN!==publicOrigin||publicOrigin==='https://av8.odin-ltd.com'||[av8WebProduction.apiOrigin,av8WebProduction.webOrigin].some(value=>value===publicOrigin)||(!loopback&&origin.protocol!=='https:'))throw new Error('Staging requires its explicit separate HTTPS or SSH loopback origin');
    }
    if(env.API_ORIGIN!=='http://api:8181')throw new Error('Hetzner requires the dedicated private API service');
    return {hosted,apiOrigin:env.API_ORIGIN,buildDir:'.next',requiresWorkloadIdentity:false};
  }
  if(env.AV8_HOSTING&&env.AV8_HOSTING!=='vercel')throw new Error('Unknown AV8 hosting profile');
  if(mode==='staging'){
    const project=env.AV8_STAGING_PROJECT_ID||'';
    if(env.NODE_ENV!=='production' || !/^prj_[a-zA-Z0-9]+$/.test(project) || env.VERCEL_PROJECT_ID!==project || [av8WebProduction.projectId,av8WebProduction.apiProjectId].some(id=>id===project))throw new Error('Staging requires its explicit separate frontend project and production runtime settings');
    if(env.NEXT_PUBLIC_ODIN_DEMO_MODE!=='false' || env.ODIN_ALLOW_SHARED_DEMO_LOGINS!=='false' || env.ODIN_REQUIRE_PRIVILEGED_MFA!=='true' || env.AV8_SIMPLE_LOGIN==='true' || env.ODIN_DEPLOYMENT_MODE==='demo')throw new Error('Staging requires privileged MFA with demo and shared login disabled');
    const apiOrigin=stagingOrigin(env.AV8_STAGING_API_ORIGIN),webOrigin=stagingOrigin(env.ODIN_WEB_ORIGIN);
    if(env.API_ORIGIN!==apiOrigin || apiOrigin===webOrigin)throw new Error('Staging API and web origins must be explicit and distinct');
    return {hosted,apiOrigin,buildDir:'.next',requiresWorkloadIdentity:true};
  }
  const apiOrigin=hosted?av8WebProduction.apiOrigin:'http://127.0.0.1:8181';
  if(env.API_ORIGIN!==apiOrigin)throw new Error('Unexpected AV8 API origin');
  if(hosted&&env.VERCEL==='1'&&env.VERCEL_PROJECT_ID!==av8WebProduction.projectId)throw new Error('Unexpected AV8 frontend project');
  return {hosted,apiOrigin,buildDir:hosted?'.next':'.next-av8',requiresWorkloadIdentity:hosted};
}

type ProxyDependencies = {
  environment: () => Environment;
  identity: () => Promise<string>;
  transport?: typeof fetch;
};

/** Workload identity is added on the server; browser-supplied identity is ignored. */
export function createAv8ApiProxy({environment,identity,transport=fetch}:ProxyDependencies){
  return async(request:Request)=>{
    let deployment:ReturnType<typeof av8WebConfiguration>;
    const env=environment();
    try{deployment=av8WebConfiguration(env);}catch{return Response.json({message:'AV8 API configuration is unavailable'},{status:503});}
    const incoming=new URL(request.url);
    if(!incoming.pathname.startsWith('/api/'))return new Response(null,{status:404});
    const headers=new Headers();
    for(const name of ['authorization','content-type','accept','accept-language','cookie','origin','idempotency-key','x-odin-language','x-odin-step-up','user-agent']){const value=request.headers.get(name);if(value)headers.set(name,value);}
    const platformIp=deployment.requiresWorkloadIdentity?request.headers.get('x-vercel-forwarded-for'):null;
    if(platformIp)headers.set('x-forwarded-for',platformIp);
    // Production web is loopback-bound; its dedicated nginx vhost overwrites X-Real-IP.
    // SSH staging deliberately does not trust client-provided forwarding headers.
    if(env.AV8_HOSTING==='hetzner'&&env.AV8_ENV==='production'){const clientIp=request.headers.get('x-real-ip');if(clientIp&&isIP(clientIp))headers.set('x-forwarded-for',clientIp);}
    if(deployment.requiresWorkloadIdentity){
      try{const token=await identity();if(!token)throw new Error('Missing workload identity');headers.set('x-vercel-trusted-oidc-idp-token',token);}catch{return Response.json({message:'API identity unavailable'},{status:503});}
    }
    try{
      const result=await transport(deployment.apiOrigin+incoming.pathname+incoming.search,{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:await request.arrayBuffer(),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(55000)});
      const outgoing=new Headers({'Cache-Control':'no-store'});
      for(const name of ['content-type','content-disposition','x-request-id','x-av8-scan']){const value=result.headers.get(name);if(value)outgoing.set(name,value);}
      for(const cookie of result.headers.getSetCookie())outgoing.append('set-cookie',cookie);
      return new Response(result.body,{status:result.status,headers:outgoing});
    }catch{return Response.json({message:'AV8 API is temporarily unavailable'},{status:502});}
  };
}
