(() => {
 'use strict';
 const nav=document.getElementById('admin-nav'),app=document.getElementById('admin-app'),header=document.querySelector('body>header');if(!nav||!app||!header)return;
 document.body.classList.add('admin-workspace');nav.setAttribute('role','navigation');nav.setAttribute('aria-label','管理メニュー');
 const iconPaths={home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',visibility:'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 12l2 2 4-4"/>'};
 for(const [page,path]of Object.entries(iconPaths)){const b=nav.querySelector('[data-page="'+page+'"]');if(b&&!b.querySelector('svg'))b.insertAdjacentHTML('afterbegin','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+path+'</svg>');}
 const specs=[['作業',['home','visibility','contacts']],['データ',['cards','verse','users']],['運営',['announcements','operations','usage','imports','logs']]];
 for(const [title,pages] of specs){const g=document.createElement('div');g.className='nav-section';const label=document.createElement('p');label.textContent=title;g.append(label);for(const page of pages){const b=nav.querySelector('button[data-page="'+page+'"]');if(b)g.append(b)}nav.append(g)}
 const logout=document.getElementById('admin-logout');if(logout){const f=document.createElement('div');f.className='nav-footer';f.append(logout);nav.append(f)}
 const toggle=document.createElement('button');toggle.type='button';toggle.className='nav-toggle';toggle.textContent='メニュー';toggle.setAttribute('aria-controls','admin-nav');toggle.setAttribute('aria-expanded','false');header.append(toggle);
 for(const b of app.querySelectorAll('.home-actions button')){const icon=nav.querySelector('[data-page="'+b.dataset.page+'"] svg');if(icon)b.querySelector('.home-symbol').replaceChildren(icon.cloneNode(true));}
 const close=()=>{document.body.classList.remove('nav-open');toggle.setAttribute('aria-expanded','false')};toggle.onclick=()=>{const open=document.body.classList.toggle('nav-open');toggle.setAttribute('aria-expanded',String(open))};nav.addEventListener('click',e=>{if(e.target.closest('button'))close()});document.addEventListener('keydown',e=>{if(e.key==='Escape'){close();if(!toggle.hidden)toggle.focus()}});
 const bar=document.createElement('div');bar.className='workspace-bar';const title=document.createElement('span');title.textContent='管理ワークスペース';const account=document.getElementById('admin-account');bar.append(title);if(account)bar.append(account);app.prepend(bar);
 function sync(){toggle.hidden=app.hidden;if(app.hidden)close();for(const b of nav.querySelectorAll('[data-page]')){if(b.classList.contains('active'))b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')}}
 new MutationObserver(sync).observe(nav,{attributes:true,subtree:true,attributeFilter:['class']});new MutationObserver(sync).observe(app,{attributes:true,attributeFilter:['hidden']});sync();
 window.addEventListener('hashchange',()=>{const page=location.hash.slice(1);if(specs.some(([,pages])=>pages.includes(page))&&window.CARD_VISIBILITY_ADMIN_HOST?.authorized())window.CARD_VISIBILITY_ADMIN_HOST.showPage(page)});
})();
