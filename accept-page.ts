/** Self-contained accept page. The token is read from the URL, then removed from the address bar. */
export function acceptPage(nonce: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Accept invitation</title><meta name="referrer" content="no-referrer">
<style nonce="${nonce}">
:root{--bg:#E9EEE9;--card:#fff;--ink:#15262A;--muted:#566762;--line:#CFD8D1;--brand:#0D5747;--bad:#A3302F;--badbg:#F5DCD8}
@media (prefers-color-scheme:dark){:root{--bg:#0E1517;--card:#152023;--ink:#E2EBE7;--muted:#93A59F;--line:#2A3B3E;--brand:#46B893;--bad:#F08A82;--badbg:#3D1E1C}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 "Segoe UI",system-ui,-apple-system,sans-serif;display:grid;place-items:center;min-height:100vh;padding:24px}
main{width:100%;max-width:440px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px;position:relative;overflow:hidden}
main::before{content:"";position:absolute;inset:0 0 auto;height:6px;background:var(--brand)}
h1{font-size:1.5rem;margin:6px 0 8px}.co{font-weight:800}.muted{color:var(--muted)}label{display:flex;flex-direction:column;gap:4px;font-size:.85rem;color:var(--muted);margin-top:14px}
input{font:inherit;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 12px}
button{margin-top:20px;width:100%;font:inherit;font-weight:700;border:0;border-radius:8px;padding:12px;background:var(--brand);color:#fff;cursor:pointer}button:disabled{opacity:.5}
.err{margin-top:14px;padding:10px 12px;border-radius:8px;background:var(--badbg);color:var(--bad)}[hidden]{display:none!important}
</style></head><body><main>
<div id="loading" class="muted">Checking your invitation…</div>
<div id="bad" hidden><h1>Invitation not valid</h1><p class="muted" id="badmsg"></p></div>
<form id="form" hidden novalidate>
  <div class="co" id="co"></div><h1 id="title"></h1><p class="muted" id="sub"></p>
  <label id="namewrap">Your full name<input id="name" autocomplete="name" maxlength="80" required></label>
  <label>Email<input id="email" disabled></label>
  <label id="pwlabel"><span id="pwtext">Choose a password (at least 10 characters)</span><input id="pw" type="password" autocomplete="new-password" required></label>
  <label id="pw2wrap">Confirm password<input id="pw2" type="password" autocomplete="new-password"></label>
  <div class="err" id="err" hidden role="alert"></div>
  <button id="go">Continue</button>
</form>
<div id="done" hidden><h1>You're in</h1><p class="muted" id="donemsg"></p></div>
</main>
<script nonce="${nonce}">
(function(){
  var $=function(id){return document.getElementById(id)};
  var token=new URLSearchParams(location.search).get('token')||'';
  if(history.replaceState) history.replaceState(null,'',location.pathname);
  var ROLE={employee:'team member',supervisor:'supervisor',project_manager:'project manager',production_manager:'production manager',logistics:'logistics',finance:'finance',admin:'administrator'};
  var kind='INVITE';
  function post(path,body){return fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(body)}).then(function(r){return r.json().then(function(j){if(!r.ok)throw j;return j})})}
  function bad(m){$('loading').hidden=true;$('form').hidden=true;$('bad').hidden=false;$('badmsg').textContent=m}
  if(!token){bad('This link is missing its invitation code. Open the link from your email again.');return}
  post('/api/v1/invitations/preview',{token:token}).then(function(r){
    var i=r.invitation;kind=i.kind;
    $('co').textContent=i.company;
    $('title').textContent=kind==='RESET'?'Choose a new password':'Join as '+(ROLE[i.role]||'member')+(i.project?' on '+i.project:'');
    $('sub').textContent=kind==='RESET'?'Hi '+i.full_name+'. Choose a new password for your account.':(i.invited_by?i.invited_by+' invited you. ':'')+'Choose a password to finish joining.';
    $('name').value=i.full_name;$('email').value=i.email;$('namewrap').hidden=true;
    $('loading').hidden=true;$('form').hidden=false;$('pw').focus();
  }).catch(function(e){bad((e&&e.message)||'This invitation could not be loaded.')});
  $('form').addEventListener('submit',function(ev){
    ev.preventDefault();$('err').hidden=true;
    if($('pw').value!==$('pw2').value){$('err').textContent='The two passwords do not match.';$('err').hidden=false;return}
    $('go').disabled=true;$('go').textContent='Saving…';
    post('/api/v1/invitations/accept',{token:token,password:$('pw').value}).then(function(r){
      $('form').hidden=true;$('done').hidden=false;$('donemsg').textContent=kind==='RESET'?'Password saved. Taking you to the app…':'Welcome, '+$('name').value+'. Taking you to the app…';
      setTimeout(function(){location.href=r.redirect_to},1800);
    }).catch(function(e){
      if(e&&e.code==='INVITATION_INVALID'){bad(e.message);return}
      $('err').textContent=(e&&e.message)||'Something went wrong. Try again.';$('err').hidden=false;$('go').disabled=false;$('go').textContent='Continue';
    });
  });
})();
</script></body></html>`;
}
