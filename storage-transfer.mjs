import crypto from 'node:crypto';
// Short-lived, read-only capability for an administrator's one-off migration.
// It authorizes only GET export, never sessions or other application routes.
export function transferAuthorized(req,{token='',until='',now=Date.now()}={}) {
 const deadline=Date.parse(until),supplied=String(req.headers.authorization||'').match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1]||'';
 if(req.method!=='GET'||token.length<32||!Number.isFinite(deadline)||deadline<=now||deadline>now+60*60*1000||supplied.length!==token.length)return false;
 return crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(token));
}
