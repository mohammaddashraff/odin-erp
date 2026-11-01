import {getVercelOidcToken} from '@vercel/oidc';
import {createAv8ApiProxy} from '../../../core/server-config';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

const proxy=createAv8ApiProxy({environment:()=>process.env,identity:getVercelOidcToken});
export {proxy as GET,proxy as POST,proxy as PUT,proxy as PATCH,proxy as DELETE,proxy as OPTIONS,proxy as HEAD};
