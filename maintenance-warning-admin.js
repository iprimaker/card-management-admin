(() => {
  'use strict';
  const base=new URL('.',document.currentScript.src);
  const style=document.createElement('link');style.rel='stylesheet';style.href=new URL('maintenance-warning-admin.css?v=20261121-v97',base).href;document.head.append(style);
  const format=value=>value?new Date(Date.parse(value)+9*3600000).toISOString().slice(0,16):'';
  let host, panel, loaded=false, wasAuthorized=false, busy=false;
  function mount() {
    const anchor=document.getElementById('maintenance-controls');
    if(!anchor)return false;
    panel=document.createElement('section');panel.className='maintenance-warning-admin';
    panel.innerHTML='<h3>メンテナンスの事前通知</h3><p>開始20分前から一般サイト全体に警告を表示します。日時は日本時間です。</p><form><label>開始予定日時<input name="start" type="datetime-local" required></label><label>終了予定日時（未定の場合は空欄）<input name="end" type="datetime-local"></label><label>詳細に表示する追加案内（任意）<textarea name="message" rows="3" maxlength="2000"></textarea></label><div class="maintenance-warning-admin-actions"><button class="primary" type="submit">通知予定を保存</button><button type="button" data-cancel>通知予定を解除</button></div></form><p role="status" data-status aria-live="polite"></p><p class="maintenance-warning-admin-note">この設定は予告通知用です。実際のメンテナンス開始・解除は、上のメンテナンスモードで操作してください。</p>';
    anchor.after(panel);
    panel.querySelector('form').onsubmit=event=>{event.preventDefault();save(true);};
    panel.querySelector('[data-cancel]').onclick=()=>save(false);
    return true;
  }
  const status=text=>{panel.querySelector('[data-status]').textContent=text;};
  const setBusy=value=>{busy=value;panel.querySelectorAll('input,textarea,button').forEach(el=>el.disabled=value);};
  function fill(data) {
    const form=panel.querySelector('form');form.elements.start.value=format(data.starts_at);form.elements.end.value=format(data.ends_at);form.elements.message.value=data.message||'';
    status(data.enabled?'通知予定を登録しています。開始20分前から表示します。':'通知予定は登録されていません。');
  }
  async function load() {
    setBusy(true);
    try {const {data,error}=await host.client().rpc('card_album_maintenance_warning_schedule');if(error)throw error;if(!host.authorized())return;fill(data);loaded=true;}
    catch {status('通知予定を読み込めませんでした。初回SQLの実行と接続状況を確認し、画面を開き直してください。');}
    finally {setBusy(!host.authorized());}
  }
  async function save(enabled) {
    if(busy||!host.authorized())return;
    const form=panel.querySelector('form'), start=form.elements.start.value,end=form.elements.end.value;
    const starts=start?new Date(start+'+09:00'):null,ends=end?new Date(end+'+09:00'):null;
    if(enabled&&(!starts||!Number.isFinite(starts.getTime())||starts.getTime()<=Date.now())){status('未来の開始予定日時を設定してください。');return;}
    if(enabled&&ends&&(!Number.isFinite(ends.getTime())||ends<=starts)){status('終了予定は開始予定より後に設定してください。');return;}
    setBusy(true);status('保存しています…');
    try {
      const {data,error}=await host.client().rpc('card_admin_maintenance_warning_save',{p_enabled:enabled,p_starts_at:enabled?starts.toISOString():null,p_ends_at:enabled&&ends?ends.toISOString():null,p_message:form.elements.message.value});
      if(error)throw error;
      if(!host.authorized())return;fill(data);loaded=true;status(enabled?'通知予定を保存しました。':'通知予定を解除しました。');
    }catch{status('保存できませんでした。管理者権限・初回SQLの実行・接続状況を確認してください。');}
    finally{setBusy(!host.authorized());}
  }
  const timer=setInterval(()=>{
    host=window.CARD_VISIBILITY_ADMIN_HOST;
    if(!host?.client||!host?.authorized)return;
    if(!panel&&!mount())return;
    const authorized=host.authorized();
    if(!authorized){if(wasAuthorized){loaded=false;panel.querySelector('form').reset();status('管理者としてログインしてください。');}setBusy(true);}
    else if(!wasAuthorized){loaded=false;load();}
    wasAuthorized=authorized;
  },1000);

})();
