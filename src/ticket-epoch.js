'use strict';
// Standalone experiment. Original secret remains with caller; not wired into the application.
function createPolicy(raw) {
  if (raw === '') return Object.freeze({acceptJwt:()=>true,macInput:message=>message,issueClaims:claims=>({...claims})});
  if (typeof raw !== 'string' || !/^[1-9][0-9]{0,11}$/.test(raw)) throw Error('INVALID_TICKET_EPOCH');
  const epoch=Number(raw);
  if (!Number.isSafeInteger(epoch)) throw Error('INVALID_TICKET_EPOCH');
  return Object.freeze({
    acceptJwt:payload=>!!payload && payload.session_epoch===raw,
    issueClaims:claims=>{
      if (!claims || typeof claims!=='object' || Array.isArray(claims) || Object.hasOwn(claims,'session_epoch')) throw Error('INVALID_TICKET_CLAIMS');
      return {...claims,session_epoch:raw};
    },
    macInput:message=>{
      if(typeof message!=='string') throw Error('INVALID_TICKET_MESSAGE');
      return 'restored-ticket-epoch|'+raw+'|'+message;
    },
  });
}
module.exports={...createPolicy(process.env.TICKET_EPOCH || ''),createPolicy};
