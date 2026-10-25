(() => {
 'use strict';
 const nav=document.getElementById('admin-nav'),app=document.getElementById('admin-app'),header=document.querySelector('body > header');
 if(!nav||!app||!header)return;
 document.body.classList.add('admin-ui');
 const definitions={cards:['カード情報','登録情報の編集と、保留カードの確認・正式登録を行います。'],verse:['コーデ情報','バースのコーデ・パーツ情報を確認、編集します。'],users:['登録者','アカウントの状態と登録内容を確認します。'],contacts:['お問い合わせ','内容の確認、対応状況の更新、本人への返信を行います。'],announcements:['お知らせ・更新情報','一般サイトに掲載する情報を管理します。'],imports:['追加履歴','追加されたカード・コーデの記録を確認します。'],logs:['修正履歴','カード情報に加えた変更を確認します。'],usage:['使用状況','利用状況とデータベースの状態を確認します。'],operations:['運営管理','メンテナンスや登録受付など、サイト全体の設定を管理します。']};
 const groupSpecs=[['カード・コーデ',['cards','verse']],['対応・お知らせ',['contacts','announcements','users']],['運営・履歴',['operations','usage','imports','logs']]];
 const groups=groupSpecs.map(([label])=>{const group=document.createElement('div');group.className='admin-nav-group';const title=document.createElement('p');title.className='admin-nav-group-title';title.textContent=label;group.append(title);nav.append(group);return group});
 const footer=document.createElement('div');footer.className='admin-nav-footer';nav.append(footer);
 function organize(){
  for(const b of [...nav.children].filter(n=>n.tagName==='BUTTON')){
   const page=b.dataset.page;
   if(b.id==='admin-logout'){footer.append(b);continue;}
   let index=groupSpecs.findIndex(([,pages])=>pages.includes(page));
   if(index<0){index=0;b.dataset.adminTool='visibility';b.classList.add('admin-visibility-link');}
   groups[index].append(b);
  }
 }
 organize();new MutationObserver(organize).observe(nav,{childList:true});
 nav.setAttribute('role','navigation');nav.setAttribute('aria-label','管理メニュー');
 const toggle=document.createElement('button');toggle.id='admin-ui-toggle';toggle.type='button';toggle.textContent='メニュー';toggle.setAttribute('aria-controls','admin-nav');toggle.setAttribute('aria-expanded','false');header.append(toggle);
 function closeMenu(focus=false){document.body.classList.remove('admin-nav-open');toggle.setAttribute('aria-expanded','false');if(focus)toggle.focus()}
 toggle.onclick=()=>{const open=document.body.classList.toggle('admin-nav-open');toggle.setAttribute('aria-expanded',String(open))};
 nav.addEventListener('click',e=>{if(e.target.closest('button'))closeMenu()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('admin-nav-open'))closeMenu(true)});
 document.addEventListener('click',e=>{if(!header.contains(e.target))closeMenu()});
 const intro=document.createElement('section');intro.className='admin-workspace-heading';intro.innerHTML='<div><p class="admin-breadcrumb">カードアルバム / 管理</p><h1 id="admin-workspace-title"></h1><p id="admin-workspace-help"></p></div><div class="admin-quick-actions" aria-label="よく使う操作"></div>';
 app.prepend(intro);
 for(const [label,page] of [['カード管理','cards'],['お問い合わせ','contacts'],['公開設定','visibility']]){
  const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>{const target=page==='visibility'?nav.querySelector('[data-admin-tool="visibility"]'):nav.querySelector('[data-page="'+page+'"]');target?.click()};intro.querySelector('.admin-quick-actions').append(b);
 }
 function sync(){
  const active=nav.querySelector('[data-page].active');const info=definitions[active?.dataset.page]||['管理ページ','左のメニューから作業を選んでください。'];
  intro.querySelector('h1').textContent=info[0];intro.querySelector('#admin-workspace-help').textContent=info[1];
  for(const b of nav.querySelectorAll('[data-page]')){if(b===active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')}
  const visible=!app.hidden;toggle.hidden=!visible;if(!visible)closeMenu();
  const visibility=nav.querySelector('[data-admin-tool="visibility"]');intro.querySelector('.admin-quick-actions button:last-child').hidden=!visibility;
 }
 new MutationObserver(sync).observe(nav,{subtree:true,attributes:true,attributeFilter:['class'],childList:true});
 new MutationObserver(sync).observe(app,{attributes:true,attributeFilter:['hidden']});sync();
})();
