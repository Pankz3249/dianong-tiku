// 电工技能大赛理论题库练习软件 - 前端逻辑（含错题本 / 多端同步 / PWA）
(function(){
  const $ = (s)=>document.querySelector(s);
  const main = ()=>$('#mainCard');
  const nav  = ()=>$('#navCard');
  const statsEl = ()=>$('#stats');

  // ---------- 持久化 ----------
  const STORE_KEY = 'dianong_tiku_v1';
  function loadStore(){
    try{ return JSON.parse(localStorage.getItem(STORE_KEY)||'{}'); }catch(e){ return {}; }
  }
  // perQ: Map<type, {ok:Set<origIndex>, err:Set<origIndex>}>  逐题对错记录（用于题号面板着色 + 头部标记）
  // lastIdx: Map<type, number>  上次做到的位置（用于续做）
  // favorites: Map<type, Set<origIdx>>  收藏的题目
  const perQ = new Map();
  const lastIdx = new Map();
  const favorites = new Map();
  // userAns: Map<type, Map<origIdx, userAnswer>>  记录每道题你当时选了什么（回看时还原错选）
  const userAns = new Map();
  function saveStore(){
    const data = {
      wrongBook: Array.from(wrongBook.values()).map(v=>({k:v.k,t:v.t,stem:v.stem,answer:v.answer,explain:v.explain||'',ts:v.ts||Date.now(),ua:v.ua||null,formula:v.formula||null})),
      progress: Array.from(progress.entries()).map(([k,v])=>({k,t:v.t,answered:v.answered,correct:v.correct,wrong:v.wrong})),
      perQ: Array.from(perQ.entries()).map(([type,v])=>({type, ok:Array.from(v.ok), err:Array.from(v.err)})),
      lastIdx: Array.from(lastIdx.entries()),
      favorites: Array.from(favorites.entries()).map(([type,v])=>({type, items:Array.from(v)})),
      userAns: Array.from(userAns.entries()).map(([type,m])=>({type, items:Array.from(m.entries())})),
    };
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  }
  // wrongBook: Map<key, {k,t,stem,answer,explain,ts,ua}>  key="type:origIndex"
  const wrongBook = new Map();
  // progress: Map<key, {t,answered,correct,wrong}> 按题型累计
  const progress = new Map();
  (function restore(){
    const s = loadStore();
    (s.wrongBook||[]).forEach(x=>{ wrongBook.set(x.k, x); });
    (s.progress||[]).forEach(x=>{ progress.set(x.k, {t:x.t,answered:x.answered,correct:x.correct,wrong:x.wrong}); });
    (s.perQ||[]).forEach(x=>{ perQ.set(x.type, {ok:new Set(x.ok||[]), err:new Set(x.err||[])}); });
    (s.lastIdx||[]).forEach(([type,idx])=>{ lastIdx.set(type, idx); });
    (s.favorites||[]).forEach(x=>{ favorites.set(x.type, new Set(x.items||[])); });
    (s.userAns||[]).forEach(x=>{ userAns.set(x.type, new Map(x.items||[])); });
  })();
  // 取某题型的逐题对错记录（不存在则初始化）
  function pq(type){ if(!perQ.has(type)) perQ.set(type,{ok:new Set(),err:new Set()}); return perQ.get(type); }
  // ---- 收藏操作 ----
  function favSet(type){ if(!favorites.has(type)) favorites.set(type,new Set()); return favorites.get(type); }
  function isFav(type, origIdx){ return favSet(type).has(origIdx); }
  function favTotal(){ let n=0; favorites.forEach(s=>n+=s.size); return n; }
  function toggleFav(type, origIdx){
    const s=favSet(type);
    if(s.has(origIdx)) s.delete(origIdx); else s.add(origIdx);
    saveStore();
  }
  // 记录某题对错（答错优先：同一题若既对又错，按错处理，符合"错题要显眼"）
  function markPerQ(type, origIdx, isCorrect){
    const p=pq(type);
    if(isCorrect){ p.ok.add(origIdx); p.err.delete(origIdx); }  // 答对了 -> 从错题标记移除（学会了）
    else { p.err.add(origIdx); p.ok.delete(origIdx); }
    saveStore();
  }
  // 某原始编号的当前状态：'ok' / 'err' / 'none'
  function statusOf(type, origIdx){
    const p=pq(type);
    if(p.err.has(origIdx)) return 'err';
    if(p.ok.has(origIdx)) return 'ok';
    return 'none';
  }

  const state = {
    type:'choice',      // choice / blank / judge / practice / wrongbook / favbook / drill
    mode:'seq',         // seq(按顺序) / rand(随机)
    list:[],            // 当前题型题目数组
    idx:0,
    answered:new Set(),
    correct:new Set(),
    wrong:new Set(),
    autoNext:false,
    showAns:false,
    recite:false,       // 🎓 背题模式：不作答，可随时查看答案+解析；不判分、不计错题、不影响进度
    // 组卷训练：active=true 时，list 里混合了多种题型，每题用 q._src 标识其原始题型
    drill:{ active:false, name:'', source:'wrong', types:['choice','blank','judge'], count:0, rand:false },
  };
  // 非答题类页面（实操/错题本/收藏本）：无题号卡片、无答题进度
  const isPageType = (t)=> t==='practice'||t==='wrongbook'||t==='favbook';
  // 当前题目的"真实题型"：组卷训练时题目来自不同题型，取 q._src；否则用 state.type
  function curType(q){ return (q && q._src) || state.type; }
  // 组卷模式下，为了不污染各题型的正常进度，题号卡片用卷内序号
  const isDrill = ()=> !!state.drill.active;
  const TYPE_NAME = {choice:'选择题', blank:'填空题', judge:'判断题'};

  // ---------- 工具 ----------
  const shuffle = (arr)=>{ const a=arr.slice(); for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };
  const esc = (s)=>{ const d=document.createElement('div'); d.textContent= String(s??''); return d.innerHTML; };
  const qKey = (type, origIdx)=> type+':'+origIdx;
  // 版本号：改功能时递增，用于在页面上确认浏览器加载的是最新文件
  const APP_VERSION = '20260924b';

  // ---------- 版本检测 / 强制刷新（解决"更新了却看不到新功能"） ----------
  // 原因：Service Worker 或浏览器缓存会返回旧文件，导致新功能不生效。
  // 这里在启动时比对本地记录的版本号，发现变化就自动清缓存刷新一次
  // （用 sessionStorage 标记，避免反复刷新）。
  function forceReload(){
    try{
      if('caches' in window){ caches.keys().then(ks=>ks.forEach(k=>caches.delete(k))).catch(()=>{}); }
    }catch(e){}
    try{
      if('serviceWorker' in navigator){
        navigator.serviceWorker.getRegistrations().then(rs=>rs.forEach(r=>r.unregister())).catch(()=>{});
      }
    }catch(e){}
    setTimeout(()=>{ try{ location.reload(true); }catch(e){ location.reload(); } }, 300);
  }
  (function checkVersion(){
    try{
      const seen = localStorage.getItem('appVersionSeen');
      if(seen !== APP_VERSION){
        localStorage.setItem('appVersionSeen', APP_VERSION);
        // 只在本次会话第一次发现版本变化时自动刷新；已在刷过则不再重复
        if(!sessionStorage.getItem('versionReloaded')){
          sessionStorage.setItem('versionReloaded','1');
          console.log('[版本更新] 检测到新版本 '+APP_VERSION+'，正在清缓存刷新…');
          forceReload();
        }
      }
    }catch(e){}
  })();
  // 各题型题量（经逐题核对《附件3》确认）：
  //   choice 199（原文档缺 146）、blank 96、judge 260
  // 填空题：原文档共 102 段，其中开头"附录 1-5"（巡视四方法/四把关/四对照/五清/技术措施）
  //   与正文末尾重复，去重后得 96 道；软件内编号 1-96 连续，无跳号、无重复。
  const MISSING_NO = { choice:[146], blank:[], judge:[] };
  const MISSING_NOTE = {
    blank:'原文档填空题共 102 段，附录 5 题与正文重复，去重后为 96 道；软件编号 1-96 连续'
  };

  function setStats(){
    const total = state.list.length;
    const a = state.answered.size, c=state.correct.size, w=state.wrong.size;
    let html = '';
    if(state.type==='practice'){ html=`<span class="pill">实操 · 任务书 / 模拟接线</span>`; }
    else if(state.type==='wrongbook'){ html=`<span class="pill">错题本</span> 共 <b>${wrongBook.size}</b> 道错题`; }
    else if(state.type==='favbook'){ html=`<span class="pill" style="background:#fff8e1;color:#d18b00;">⭐ 收藏本</span> 共 <b>${favTotal()}</b> 道收藏题`; }
    else if(isDrill()){
      // 组卷训练：显示试卷概况与本次得分
      const a=state.answered.size, c=state.correct.size, w=state.wrong.size;
      const rate = a? Math.round(c/a*100) : 0;
      html = `<span class="pill" style="background:#eef4ff;color:#2e75b6;">📝 ${esc(state.drill.name)}</span> `
           + `共 <b>${state.list.length}</b> 题　本次已答 <b>${a}</b>　正确 <b style="color:var(--ok)">${c}</b>　错误 <b style="color:var(--err)">${w}</b>`
           + (a? `　正确率 <b style="color:${rate>=60?'var(--ok)':'var(--err)'}">${rate}%</b>` : '');
    }
    else {
      // 题量：标注原文档跳号情况，避免误以为漏题
      const miss = MISSING_NO[state.type]||[];
      const note = MISSING_NOTE[state.type]||'';
      let missHtml = miss.length
        ? `　<span class="meta" style="color:var(--muted);" title="原文档本身跳号，非解析遗漏">（原文档缺第 ${miss.join('、')} 题）</span>` : '';
      if(note){ missHtml += `　<span class="meta" style="color:var(--muted);" title="原文档排版情况">（${esc(note)}）</span>`; }
      // 去重统计：基于 perQ（按题号去重）——同一题反复做只算一次
      const pq_ = perQ.get(state.type)||{ok:new Set(),err:new Set()};
      const doneN = pq_.ok.size + pq_.err.size;
      const okN = pq_.ok.size, errN = pq_.err.size;
      const undoN = Math.max(0, total - doneN);
      html = `本题型共 <b>${total}</b> 题${missHtml}　本次已答 <b>${a}</b>　正确 <b style="color:var(--ok)">${c}</b>　错误 <b style="color:var(--err)">${w}</b>`;
      if(doneN>0){
        html += `　<span class="meta">｜已练 <b>${doneN}</b> 题（掌握 <b style="color:var(--ok)">${okN}</b> · 待复习 <b style="color:var(--err)">${errN}</b>）· 未做 <b>${undoN}</b> 题</span>`;
      }
      // 续做提示：上次做到第几题
      const lastOrig = lastIdx.get(state.type);
      if(typeof lastOrig==='number'){ html += `　<span class="meta" style="color:var(--accent);">📍 上次做到第 ${lastOrig} 题</span>`; }
    }
    statsEl().innerHTML = html;
    // 错题本 tab 角标
    const wt=$('#wrongTab'); if(wt){ wt.dataset.count=wrongBook.size>0?String(wrongBook.size):'0'; wt.classList.toggle('has', wrongBook.size>0); }
    // 收藏本 tab 角标
    const ft=$('#favTab'); if(ft){ const n=favTotal(); ft.dataset.count=String(n); ft.classList.toggle('has', n>0); ft.classList.add('badge'); }
  }

  // 删除记录：仅重置当前题型的答题进度/统计，保留错题本
  function resetProgress(){
    if(isPageType(state.type)){
      flash('当前页无可删除的答题记录（请先进入选择题/填空题/判断题）','err',false); return;
    }
    if(isDrill()){
      flash('组卷训练是临时试卷，无独立进度可删。要重置请点「重新组卷」；若要清空错题/收藏，请到对应页面操作。','err',false); return;
    }
    const pq_ = perQ.get(state.type)||{ok:new Set(),err:new Set()};
    const done = pq_.ok.size + pq_.err.size;
    if(done===0 && state.answered.size===0){
      flash('当前题型暂无答题记录，无需删除。','err',false); return;
    }
    const ok = confirm('确定删除「'+(state.type==='choice'?'选择题':state.type==='blank'?'填空题':'判断题')+'」的答题记录吗？\n\n将清除：本题型已练 '+done+' 题的进度（题号卡片的绿/红标记、上次做到第几题）与本次答题统计。\n不会删除错题本与收藏本（需到对应页面手动移除）。');
    if(!ok) return;
    progress.delete('prog:'+state.type);
    perQ.set(state.type,{ok:new Set(),err:new Set()});   // 清空逐题对错（题号卡片的绿/红标记归零）
    userAns.delete(state.type);                          // 清空历史作答（回看错选一并清除）
    lastIdx.delete(state.type);   // 重头开始做（下次从第1题起）
    state.answered=new Set(); state.correct=new Set(); state.wrong=new Set(); state.idx=0;
    saveStore(); renderQuestion(); setStats();
    flash('已删除答题记录，进度已重置（错题本与收藏本均保留）。','ok',false);
  }

  // ---------- 题型切换 ----------
  function switchType(type){
    // 离开组卷页时，若正在做卷子则保留；点回「组卷」标签会重新显示配置页
    state.type = type;
    document.querySelectorAll('#typeTabs .tab').forEach(t=>t.classList.toggle('active', t.dataset.type===type));
    if(type==='practice'){ state.drill.active=false; renderPractice(); return; }
    if(type==='wrongbook'){ state.drill.active=false; renderWrongBook(); return; }
    if(type==='favbook'){ state.drill.active=false; renderFavBook(); return; }
    if(type==='drill'){
      // 已在做卷子 -> 回到卷子（不重开配置页）；否则显示配置页
      if(state.drill.active && state.list.length){ nav().style.display=''; renderQuestion(); setStats(); renderQGrid(); }
      else renderDrillSetup();
      return;
    }
    // 切到普通题型：退出组卷状态，避免混合题型影响正常刷题
    state.drill.active=false;
    // _orig 采用文档原始题号（DATA 中的 no 字段），与题号卡片/续做记录一致
    const raw = (DATA[type]||[]).map((q,i)=>({...q, _orig: (q.no!=null? q.no : i+1)}));
    state.list = (state.mode==='rand')? shuffle(raw) : raw;
    state.idx = 0; state.answered=new Set(); state.correct=new Set(); state.wrong=new Set();
    // 续做：恢复到上次做到的位置（lastIdx 存的是原始题号 _orig，需映射到当前列表索引）
    const lastOrig = lastIdx.get(type);
    if(typeof lastOrig==='number'){
      const li = state.list.findIndex(q=>q._orig===lastOrig);
      if(li>=0) state.idx=li;
    }
    nav().style.display='';
    renderQuestion();
    setStats();
    renderQGrid();  // 切换题型时刷新题号面板着色
  }

  // ---------- 模式切换 ----------
  function switchMode(mode){
    state.mode = mode;
    document.querySelectorAll('#modeGroup button').forEach(b=>b.classList.toggle('on', b.dataset.mode===mode));
    if(state.type==='practice') return;
    // 组卷训练有自己的"顺序/随机"设置，不受顶部按钮影响
    if(isDrill()){ flash('组卷训练的顺序在配置页里设置，点「🔄 重新组卷」可修改','err',false); return; }
    // 重新构建列表（保持当前题型进度友好：切到随机时打乱，切到顺序时还原原始顺序）
    const raw = (DATA[state.type]||[]).map((q,i)=>({...q, _orig: (q.no!=null? q.no : i+1)}));
    // 先把"本次会话"的索引记录转成题号集合（旧列表 -> 题号）
    const oldList = state.list;
    const byNo = {answered:new Set(), correct:new Set(), wrong:new Set()};
    oldList.forEach((q,ni)=>{
      if(state.answered.has(ni)) byNo.answered.add(q._orig);
      if(state.correct.has(ni)) byNo.correct.add(q._orig);
      if(state.wrong.has(ni)) byNo.wrong.add(q._orig);
    });
    state.list = (mode==='rand')? shuffle(raw) : raw;
    // 再按题号映射回新列表的索引（题号 -> 新索引）
    state.answered=new Set(); state.correct=new Set(); state.wrong=new Set();
    state.list.forEach((q,ni)=>{
      if(byNo.answered.has(q._orig)) state.answered.add(ni);
      if(byNo.correct.has(q._orig)) state.correct.add(ni);
      if(byNo.wrong.has(q._orig)) state.wrong.add(ni);
    });
    state.idx = Math.min(state.idx, state.list.length-1);
    renderQuestion(); setStats();
  }

  // ---------- 公式渲染 ----------
  // 原文档中部分公式是「公式编辑器」对象，无法作为文本读出，
  // 已渲染成图片内嵌在 data.js 的 formula 字段里；题干中相应位置用
  // {F} / {F1} / {F2} 占位，这里替换成 <img>。
  function withFormula(escapedText, formula){
    if(!formula) return escapedText;
    return escapedText.replace(/\{(F\d*)\}/g, (m, key)=>{
      const src = formula[key];
      if(!src) return m;
      return `<img class="q-formula" src="${src}" alt="公式">`;
    });
  }

  // ---------- 渲染：选择题 ----------
  // 注意：题干由 renderQuestion 统一输出（含题号与历史对错标记），
  // 这三个函数只返回"题干以下"的作答区，避免题干被渲染两遍。
  function renderChoice(q){
    const letters = ['A','B','C','D','E'];
    let html = `<div>`;
    q.options.forEach((opt,oi)=>{
      html += `<label class="opt" data-oi="${oi}"><input type="radio" name="opt" value="${oi}"> <span><b>${letters[oi]}.</b> ${withFormula(esc(opt), q.formula)}</span></label>`;
    });
    html += `</div>`;
    return html;
  }
  function renderBlank(q){
    return `<textarea id="ansInput" rows="2" placeholder="有多个空时，请用「;」或「,」分隔多个答案"></textarea>`;
  }
  function renderJudge(q){
    return `<div class="row">
        <label class="opt"><input type="radio" name="jr" value="true"> <span><b>对（√）</b></span></label>
        <label class="opt"><input type="radio" name="jr" value="false"> <span><b>错（×）</b></span></label>
      </div>`;
  }

  function renderQuestion(){
    const q = state.list[state.idx]; if(!q){ main().innerHTML='<div class="empty">本题型暂无题目</div>'; return; }
    // 组卷训练时题目混合多题型，用每题自己的题型；否则用当前标签的题型
    const T = curType(q);
    // 记录"上次做到这里"并立即持久化，保证下次打开能续做
    // （组卷是临时试卷，不写各题型的续做位置，避免污染正常刷题进度）
    if(!isDrill()){ lastIdx.set(state.type, q._orig); saveStore(); }
    let body='';
    if(T==='choice') body=renderChoice(q);
    else if(T==='blank') body=renderBlank(q);
    else body=renderJudge(q);
    // 题目头部：历史对错状态标记（绿=曾答对 红=曾答错 灰=未做）
    // 组卷训练时不显示历史标记 —— 组卷是重新考，留着标记会干扰作答
    const st = statusOf(T, q._orig);
    const stHtml = isDrill() ? '' :
      `<span class="q-status ${st==='ok'?'qs-ok':st==='err'?'qs-err':'qs-none'}">${st==='ok'?'✅ 曾答对':st==='err'?'❌ 曾答错':'— 未做过'}</span>`;
    // 填空题：题干中的 ____ 显示为填空下划线
    let stemHtml = esc(q.stem);
    if(T==='blank'){
      stemHtml = stemHtml.replace(/____/g,'<u class="blank-u" aria-label="填空处"></u>');
    }
    // 公式编辑器对象 → 内嵌图片（题干中的 {F} 占位符）
    stemHtml = withFormula(stemHtml, q.formula);
    // 原文档未标注答案的题：额外提示
    const hasNoAns = (T!=='blank' && typeof q.answer==='number' && q.answer<0);
    const noAnsHtml = hasNoAns ? `<span class="q-status qs-noans" title="原文档此处未给出答案">⚠️ 原文档未标答案</span>` : '';
    // 组卷训练：显示题目来自哪个题型
    const srcHtml = isDrill() ? `<span class="q-status" style="background:#eef4ff;color:#2e75b6;border-color:#bcd7ee;">【${TYPE_NAME[T]||T}】</span>` : '';
    // 收藏按钮
    const fav = isFav(T, q._orig);
    const favHtml = `<button class="fav-btn ${fav?'on':''}" id="favBtn" title="${fav?'取消收藏':'收藏本题'}">${fav?'★ 已收藏':'☆ 收藏'}</button>`;
    // 「💡 解析」按钮：做题前也能查看解析，方便边学边练
    const expBtnHtml = q.explain
      ? `<button class="fav-btn" id="expBtn" title="查看本题解析" style="color:#2e75b6;border-color:#bcd7ee;">💡 解析</button>` : '';
    main().innerHTML = `<div class="q-title">${state.idx+1}. ${stemHtml}${srcHtml}${stHtml}${noAnsHtml}${favHtml}${expBtnHtml}</div>` + body + `<div class="feedback" id="fb"></div><div class="explain" id="ex"></div>`;
    $('#progText').textContent = `${state.idx+1} / ${state.list.length}${isDrill()?'（组卷）':(state.mode==='seq'?'（顺序）':'（随机）')}`;
    // 组卷模式下把「删除记录」换成「重新组卷」（临时试卷没有独立进度可删）
    (function(){
      const rd=$('#reDrillBtn'), rp=$('#resetProg');
      if(rd) rd.style.display = isDrill()? '' : 'none';
      if(rp) rp.style.display = isDrill()? 'none' : '';
    })();
    // 🎓 背题模式：主按钮改为「👁 查看答案」，并提示本模式不判分
    (function(){
      const sb=$('#submitBtn');
      if(sb){
        if(state.recite){
          sb.textContent='👁 查看答案';
          sb.title='背题模式：直接看答案与解析，不判分、不计错题、不影响进度';
        } else {
          sb.textContent='提交答案';
          sb.title='';
        }
      }
      const note=$('#reciteNote');
      if(note) note.style.display = state.recite? '' : 'none';
    })();
    // 本次答过 或 历史上答过（perQ 有记录）-> 还原答题状态，包括你当时错选的选项
    // ⚠️ 组卷训练例外：组卷是"重新考一次"，若还原历史答案就等于直接发答案，
    //    且选项会被 showResult 禁用导致无法作答。故组卷只还原本次作答。
    // 🎓 背题模式：不还原历史作答（否则选项被预先选中/禁用，且会带出历史对错标记）
    const hist = !isDrill() && !state.recite && statusOf(T, q._orig)!=='none';
    if(state.answered.has(state.idx) || hist) showResult(true);
    bindOptions();
    const fb=$('#favBtn');
    if(fb) fb.addEventListener('click',()=>{ toggleFav(T, q._orig); renderQuestion(); setStats(); });
    // 💡 解析：点击展开/收起本题解析（做题前也能看）
    const eb=$('#expBtn');
    if(eb) eb.addEventListener('click',()=>{
      const ex=$('#ex'); if(!ex) return;
      if(ex.classList.contains('show') && ex.dataset.manual==='1'){
        ex.classList.remove('show'); ex.innerHTML=''; ex.dataset.manual='0'; eb.textContent='💡 解析';
      } else {
        ex.className='explain show'; ex.dataset.manual='1';
        ex.innerHTML='<b>解析：</b>'+esc(q.explain||'');
        eb.textContent='▣ 收起解析';
      }
    });
    renderQGrid();  // 更新题号网格当前题高亮
  }

  function bindOptions(){
    if(curType(state.list[state.idx])!=='choice') return;
    document.querySelectorAll('.opt').forEach(el=>{
      el.addEventListener('click',()=>{ if(!state.answered.has(state.idx)) el.querySelector('input').checked=true; });
    });
  }

  // ---------- 提交 / 判分 ----------
  function getUserAnswer(){
    const q=state.list[state.idx];
    const T=curType(q);
    if(T==='choice'){ const v=document.querySelector('input[name=opt]:checked'); return v? Number(v.value):null; }
    if(T==='blank'){ const v=document.getElementById('ansInput'); return v? v.value.trim():null; }
    if(T==='judge'){ const v=document.querySelector('input[name=jr]:checked'); return v? v.value==='true':null; }
    return null;
  }
  function normalize(s){ return String(s??'').trim().replace(/\s+/g,'').toLowerCase(); }

  // ---------- 🎓 背题模式：直接看答案（不判分、不计错题、不影响进度） ----------
  function showReciteAnswer(){
    const q=state.list[state.idx]; if(!q) return;
    const T=curType(q);
    let ansText='', extraHtml='';
    if(T==='choice'){
      const letters=['A','B','C','D','E'];
      const ai = typeof q.answer==='number' ? q.answer : -1;
      ansText = (ai>=0 && q.options[ai]) ? `${letters[ai]}. ${q.options[ai]}` : '（本题原文档未标答案）';
      // 高亮正确选项
      document.querySelectorAll('.opt[data-oi]').forEach(el=>{
        if(Number(el.dataset.oi)===ai) el.classList.add('correct');
      });
    } else if(T==='blank'){
      const ans = Array.isArray(q.answer)? q.answer:[q.answer];
      ansText = ans.join(' ； ');
      // 把答案填进输入框，方便对照
      const inp=document.getElementById('ansInput');
      if(inp){ inp.value = ans.join(';'); inp.readOnly = true; }
    } else if(T==='judge'){
      if(typeof q.answer==='number' && q.answer<0) ansText='（本题原文档未标答案）';
      else ansText = q.answer ? '对（√）' : '错（×）';
      // 高亮正确项
      document.querySelectorAll('input[name=jr]').forEach(r=>{
        const isT = r.value==='true';
        if(isT === !!q.answer) r.closest('.opt')?.classList.add('correct');
      });
    }
    const fb=$('#fb'), ex=$('#ex');
    if(fb){
      fb.className='feedback show ok';
      fb.innerHTML = `<b>🎓 背题模式 · 正确答案：</b>${esc(ansText)}`;
    }
    if(ex){
      ex.className='explain show'; ex.dataset.manual='1';
      ex.innerHTML='<b>解析：</b>'+esc(q.explain||'（本题暂无解析）');
    }
    // 提示背题模式不计入统计
    const note=$('#reciteNote');
    if(note) note.style.display='';
  }

  function checkAnswer(){
    // 🎓 背题模式：不判分，直接显示本题答案+解析
    if(state.recite){ showReciteAnswer(); return; }
    const q=state.list[state.idx]; const ua=getUserAnswer();
    const T=curType(q);
    if(ua===null||ua===''){ flash('请先选择一个答案（填空请先输入）','err',false); return; }
    // 原文档未标注答案的题（answer<0）：只记录作答，不判对错、不进错题本
    if(T!=='blank' && typeof q.answer==='number' && q.answer<0){
      state.answered.add(state.idx);
      (function(){ if(!userAns.has(T)) userAns.set(T,new Map());
        userAns.get(T).set(q._orig, {ua: ua, ts:Date.now()}); })();
      saveStore(); setStats();
      flash('⚠️ 本题原文档未标注答案，无法判分（已记录你的作答，不计入已练/错题）','err',false);
      return;
    }
    let isCorrect=false;
    if(T==='choice') isCorrect = (ua===q.answer);
    else if(T==='judge') isCorrect = (ua===q.answer);
    else if(T==='blank'){
      const ans = Array.isArray(q.answer)? q.answer:[q.answer];
      // 多空题：用户输入用 ;；,，/ 分隔，与答案逐一比对（忽略顺序，要求数量一致且全对）
      const inputs = String(ua).split(/[;；,，、\/]/).map(s=>normalize(s)).filter(s=>s!=='');
      const want = ans.map(a=>normalize(a)).filter(s=>s!=='');
      if(want.length<=1){
        isCorrect = inputs.length>0 && want.includes(inputs[0]);
      } else {
        isCorrect = inputs.length===want.length && want.every(w=>inputs.includes(w));
      }
    }
    state.answered.add(state.idx);
    isCorrect? state.correct.add(state.idx) : state.wrong.add(state.idx);
    // 记录逐题对错（用于题号面板着色 + 头部标记）—— 按题目真实题型归档
    markPerQ(T, q._orig, isCorrect);
    // 记录你当时选了什么（回看时还原错选，方便记住错在哪）
    (function(){ if(!userAns.has(T)) userAns.set(T,new Map());
      userAns.get(T).set(q._orig, {ua: (T==='blank'? String(ua) : ua), ts:Date.now()}); })();
    if(isCorrect){ const k=qKey(T,q._orig); if(wrongBook.has(k)) wrongBook.delete(k); }
    else {
      // 答错 -> 加入错题本（以原始编号为键，避免重复）
      const k=qKey(T, q._orig); const cur=wrongBook.get(k)||{};
      wrongBook.set(k,{k,t:T,stem:q.stem,answer:q.answer,explain:q.explain||cur.explain||'',ts:Date.now(),ua:getUserAnswerForStore(q,ua),formula:q.formula||null});
    }
    saveStore(); setStats();
    // 提交后立刻刷新题目头部的历史对错标记（绿/红），无需等下一次渲染
    (function refreshStatus(){
      const stEl=document.querySelector('.q-status'); if(!stEl) return;
      const st=statusOf(T, q._orig);
      stEl.className='q-status '+(st==='ok'?'qs-ok':st==='err'?'qs-err':'qs-none');
      stEl.textContent= st==='ok'?'✅ 曾答对':st==='err'?'❌ 曾答错':'— 未做过';
    })();
    // 同步刷新题号卡片的着色（绿=对 红=错），否则卡片颜色会滞后
    renderQGrid();
    showResult(false, isCorrect);
  }
  function getUserAnswerForStore(q,ua){
    const T=curType(q);
    if(T==='choice') return ['A','B','C','D','E'][ua];
    if(T==='judge') return ua?'对':'错';
    if(T==='blank') return String(ua);
    return null;
  }
  // 读取"你当时选的答案"。内部统一格式：choice=数字索引 / judge=布尔 / blank=字符串
  // 优先取 userAns（新版记录）；若为空则回退到错题本 wrongBook.ua（旧版数据也存了答案），
  // 保证早期答过的题回看时同样能还原错选。
  function getMyAnswer(type, orig){
    const rec = (userAns.get(type)||new Map()).get(orig);
    if(rec && rec.ua!==null && rec.ua!==undefined) return rec.ua;
    // 回退：错题本里 ua 存的是显示文本（'A'/'对'/填空原文）
    const wb = wrongBook.get(qKey(type, orig));
    if(!wb || wb.ua===null || wb.ua===undefined || wb.ua==='') return null;
    const raw = String(wb.ua);
    if(type==='choice'){
      const i = ['A','B','C','D','E'].indexOf(raw.trim().charAt(0).toUpperCase());
      return i>=0 ? i : null;
    }
    if(type==='judge') return raw.indexOf('对')>=0;
    return raw;
  }
  function flash(msg, kind, withIcon=true){
    const fb=$('#fb'); if(!fb) return;
    fb.className='feedback show '+(kind==='ok'?'ok':'err');
    fb.innerHTML = (withIcon?(kind==='ok'?'✅ ':'❌ '):'') + esc(msg);
  }
  function showResult(fromRestore, isCorrect){
    const q=state.list[state.idx];
    const T=curType(q);
    const fb=$('#fb'); const ex=$('#ex');
    // 取出你当时（或历史上）选的答案，用于回看时还原错选
    const myUa = getMyAnswer(T, q._orig);
    if(T==='choice'){
      document.querySelectorAll('.opt').forEach(el=>{
        const oi=Number(el.dataset.oi);
        if(oi===q.answer) el.classList.add('correct');
        const inp=el.querySelector('input');
        // 回看时：把你当时选的选项重新勾上；若选的不是正确答案 -> 标红
        if(myUa!==null&&myUa!==undefined&&Number(myUa)===oi){ if(inp) inp.checked=true; }
        if(inp&&inp.checked&&oi!==q.answer) el.classList.add('wrong');
        inp&&inp.setAttribute('disabled','disabled');
      });
    }
    if(T==='judge'){
      document.querySelectorAll('input[name=jr]').forEach(i=>{
        if(myUa!==null&&myUa!==undefined) i.checked = (i.value==='true')===!!myUa;
        i.setAttribute('disabled','disabled');
        // 回看时把你选错的那个标红
        const wrap=i.closest('.opt');
        if(wrap){ if((i.value==='true')!==!!q.answer && i.checked) wrap.classList.add('wrong');
                  if((i.value==='true')===!!q.answer) wrap.classList.add('correct'); }
      });
    }
    if(T==='blank'){
      const ta=document.getElementById('ansInput');
      if(ta&&myUa!==null&&myUa!==undefined) ta.value=String(myUa);
      ta&&ta.setAttribute('disabled','disabled');
    }
    let ansText='';
    if(T==='choice') ansText = ['A','B','C','D','E'][q.answer];
    else if(T==='judge') ansText = q.answer?'对（√）':'错（×）';
    else ansText = Array.isArray(q.answer)? q.answer.join(' / '):q.answer;
    // 你当时选的答案文本
    let myText='';
    if(myUa!==null&&myUa!==undefined){
      if(T==='choice') myText=['A','B','C','D','E'][Number(myUa)]||'';
      else if(T==='judge') myText = myUa?'对（√）':'错（×）';
      else myText = String(myUa);
    }
    if(typeof isCorrect==='boolean'){
      if(isCorrect){ flash('回答正确！正确答案：'+esc(ansText),'ok'); }
      else { flash('回答错误。你选了：'+esc(myText)+'　｜　正确答案：'+esc(ansText),'err'); }
    }
    else {
      // 回看历史作答：明确显示"你当时选的"与"正确答案"
      const okNow = (function(){
        if(T==='blank'){ const a=Array.isArray(q.answer)?q.answer:[q.answer];
          const ins=String(myUa||'').split(/[;；,，、\/]/).map(s=>normalize(s)).filter(s=>s);
          const want=a.map(x=>normalize(x));
          return want.length<=1 ? (ins.length>0&&want.includes(ins[0])) : (ins.length===want.length&&want.every(w=>ins.includes(w)));
        }
        if(T==='choice') return Number(myUa)===q.answer;
        if(T==='judge') return !!myUa===!!q.answer;
        return false;
      })();
      fb.className='feedback show '+(okNow?'ok':'err');
      fb.innerHTML = (okNow?'✅ 你上次答对了':'❌ 你上次答错了')
        + '　｜　<b>你选的：'+esc(myText||'（未记录）')+'</b>　·　正确答案：'+esc(ansText);
    }
    if(q.explain){
      ex.className='explain show'; ex.innerHTML='<b>解析：</b>'+esc(q.explain);
      const eb=$('#expBtn'); if(eb) eb.textContent='▣ 收起解析';
    }
    if(state.autoNext && isCorrect){ setTimeout(()=>nextQ(), T==='blank'?900:700); }
  }

  // ================= 快速选题：题号面板（绿=对 红=错 灰=未做，★=收藏，点击跳转） =================
  let qgOnlyWrong=false;  // 是否只看错题
  let qgOnlyFav=false;    // 是否只看收藏
  function renderQGrid(){
    const panel=$('#qgridPanel'); if(!panel) return;
    if(panel.style.display==='none') return;  // 面板收起时不重复渲染（展开时才画）
    if(isPageType(state.type)){ panel.style.display='none'; return; }
    panel.style.display='';
    const total=state.list.length;
    let ok=0,err=0,none=0,favN=0;
    const html=[];
    // 用原始题号 _orig 遍历，保证顺序模式下题号=实际编号；着色基于 perQ
    for(let i=0;i<total;i++){
      const q=state.list[i];
      const T=curType(q);
      const orig=q._orig;
      const st=statusOf(T, orig);
      if(st==='ok') ok++; else if(st==='err') err++; else none++;
      const fav=isFav(T, orig);
      if(fav) favN++;
      // 筛选：只看错题 / 只看收藏
      if((qgOnlyWrong&&st!=='err')||(qgOnlyFav&&!fav)){ continue; }
      const noAns = (T!=='blank' && typeof q.answer==='number' && q.answer<0);
      const cls='qg-btn '+ (st==='ok'?'ok':st==='err'?'err':'none') + (i===state.idx?' cur':'') + (fav?' fav':'') + (noAns?' noans':'');
      // 组卷模式：题型混合，原始题号会跨题型重复 -> 显示卷内序号，标题里注明原始题号与题型
      const label = isDrill() ? (i+1) : orig;
      const title = isDrill()
        ? `卷内第 ${i+1} 题（${TYPE_NAME[T]||T} 原始第 ${orig} 题）${fav?' · 已收藏':''}${noAns?' · 原文档未标答案':''}`
        : `第 ${orig} 题${fav?'（已收藏）':''}${noAns?'（原文档未标答案）':''}`;
      html.push(`<button class="${cls}" data-i="${i}" title="${title}">${label}${fav?'★':''}</button>`);
    }
    $('#qgrid').innerHTML=html.join('');
    $('#qgCountOk').textContent=ok; $('#qgCountErr').textContent=err; $('#qgCountNone').textContent=none;
    const favEl=$('#qgCountFav'); if(favEl) favEl.textContent=favN;
    // 点击题号 -> 跳转（顺序/随机都支持）
    document.querySelectorAll('.qg-btn').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const i=Number(btn.dataset.i);
        if(!isNaN(i)&&i>=0&&i<state.list.length){ state.idx=i; renderQuestion(); setStats(); }
      });
    });
  }
  function refreshQGridIfOpen(){ const panel=$('#qgridPanel'); if(panel&&panel.style.display!=='none') renderQGrid(); }

  // ================= 📝 组卷训练 =================
  // 用「错题本 / 收藏本」拼一份临时试卷来练，支持按题型筛、按题量裁、顺序或随机。
  // 组卷不影响各题型的正常刷题进度（不写 lastIdx），但答题对错仍会正常记录到
  // perQ / 错题本（答对会自动移出错题本），所以练完错题会自然减少。
  const DRILL_SOURCE = {
    wrong:    {name:'错题本',   desc:'只练答错过的题'},
    fav:      {name:'收藏本',   desc:'只练收藏的题'},
    both:     {name:'错题+收藏', desc:'错题与收藏合并去重'},
    all:      {name:'全部题目', desc:'从整套题库中抽题'},
  };
  // 按配置筛出候选题（保留原始题型 _src 与原编号 _orig）
  function drillCandidates(source, types){
    const out=[]; const seen=new Set();
    const push=(T,orig)=>{
      const key=T+':'+orig; if(seen.has(key)) return; seen.add(key);
      const q=(DATA[T]||[]).find(x=>x._orig===orig || (x.no!=null && x.no===orig));
      if(q) out.push({...q, _src:T, _orig:(q.no!=null? q.no : orig)});
    };
    if(source==='wrong' || source==='both'){
      wrongBook.forEach(v=>{ if(types.includes(v.t)) push(v.t, Number(String(v.k).split(':')[1])); });
    }
    if(source==='fav' || source==='both'){
      favorites.forEach((set,T)=>{ if(types.includes(T)) set.forEach(orig=>push(T,orig)); });
    }
    if(source==='all'){
      types.forEach(T=>{ (DATA[T]||[]).forEach(q=>push(T, q.no!=null? q.no : 0)); });
    }
    return out;
  }
  function renderDrillSetup(){
    nav().style.display='none';
    const d=state.drill;
    const cands=drillCandidates(d.source, d.types);
    // 实际会出的题数（应用题量裁剪后），避免按钮显示与真实题量不一致
    const actual = (d.count>0 && cands.length>d.count)? d.count : cands.length;
    const counts={
      wrong: drillCandidates('wrong',['choice','blank','judge']).length,
      fav:   drillCandidates('fav',  ['choice','blank','judge']).length,
      both:  drillCandidates('both', ['choice','blank','judge']).length,
      all:   (DATA.choice||[]).length+(DATA.blank||[]).length+(DATA.judge||[]).length,
    };
    const srcBtns=Object.entries(DRILL_SOURCE).map(([k,v])=>
      `<button class="btn ${d.source===k?'':'ghost'}" data-src="${k}" style="${d.source===k?'border-color:var(--accent);':''}">${v.name}<span class="meta" style="margin-left:6px;">${counts[k]}</span></button>`
    ).join('');
    const typeBtns=['choice','blank','judge'].map(T=>
      `<button class="btn ${d.types.includes(T)?'':'ghost'}" data-type-btn="${T}" style="${d.types.includes(T)?'border-color:var(--accent);':''}">${TYPE_NAME[T]}</button>`
    ).join('');
    const cntBtns=[0,20,50,100].map(n=>
      `<button class="btn ${d.count===n?'':'ghost'}" data-count="${n}" style="${d.count===n?'border-color:var(--accent);':''}">${n===0?'全部':n+'题'}</button>`
    ).join('');
    main().innerHTML=`
      <div class="q-title" style="font-size:17px;">📝 组卷训练</div>
      <div class="meta" style="margin:6px 0 14px;line-height:1.8;">
        用「错题本 / 收藏本」拼一份试卷集中训练。答题对错会正常记录：
        <b>答对的错题会自动移出错题本</b>，练一卷就少一批。
      </div>

      <div style="margin-bottom:14px;">
        <div style="font-weight:600;margin-bottom:6px;">① 题源</div>
        <div class="row" id="drillSrc">${srcBtns}</div>
        <div class="meta">${DRILL_SOURCE[d.source].desc}</div>
      </div>

      <div style="margin-bottom:14px;">
        <div style="font-weight:600;margin-bottom:6px;">② 题型</div>
        <div class="row" id="drillTypes">${typeBtns}</div>
      </div>

      <div style="margin-bottom:14px;">
        <div style="font-weight:600;margin-bottom:6px;">③ 题量</div>
        <div class="row" id="drillCount">${cntBtns}</div>
      </div>

      <div style="margin-bottom:18px;">
        <div style="font-weight:600;margin-bottom:6px;">④ 顺序</div>
        <div class="row" id="drillOrder">
          <button class="btn ${!d.rand?'':'ghost'}" data-rand="0" style="${!d.rand?'border-color:var(--accent);':''}">按顺序</button>
          <button class="btn ${d.rand?'':'ghost'}" data-rand="1" style="${d.rand?'border-color:var(--accent);':''}">随机打乱</button>
        </div>
      </div>

      <div class="row" style="align-items:center;">
        <button class="btn" id="drillStart" style="font-size:16px;padding:11px 22px;">▶️ 开始训练（${actual} 题）</button>
        <span class="meta">当前配置可组 <b>${cands.length}</b> 题${d.count>0&&cands.length>d.count?`，取前 ${d.count} 题`:''}</span>
      </div>
      ${cands.length===0?'<div class="empty" style="margin-top:14px;">😕 当前配置没有可用题目，请换个题源或题型。</div>':''}
    `;
    setStats();
    // 交互
    main().querySelectorAll('#drillSrc [data-src]').forEach(b=>b.addEventListener('click',()=>{ d.source=b.dataset.src; renderDrillSetup(); }));
    main().querySelectorAll('#drillTypes [data-type-btn]').forEach(b=>b.addEventListener('click',()=>{
      const T=b.dataset.typeBtn;
      const i=d.types.indexOf(T);
      if(i>=0){ if(d.types.length>1) d.types.splice(i,1); }  // 至少保留一个题型
      else d.types.push(T);
      renderDrillSetup();
    }));
    main().querySelectorAll('#drillCount [data-count]').forEach(b=>b.addEventListener('click',()=>{ d.count=Number(b.dataset.count); renderDrillSetup(); }));
    main().querySelectorAll('#drillOrder [data-rand]').forEach(b=>b.addEventListener('click',()=>{ d.rand=b.dataset.rand==='1'; renderDrillSetup(); }));
    const st=main().querySelector('#drillStart');
    if(st) st.addEventListener('click',()=>{ startDrill(); });
  }
  function startDrill(){
    const d=state.drill;
    let list=drillCandidates(d.source, d.types);
    if(!list.length){ flash('当前配置没有可用题目','err',false); return; }
    if(d.count>0 && list.length>d.count) list=list.slice(0,d.count);
    if(d.rand) list=shuffle(list);
    d.active=true;
    d.name = DRILL_SOURCE[d.source].name + '训练' + (d.types.length<3? '（'+d.types.map(T=>TYPE_NAME[T]).join('+')+'）':'');
    state.list=list; state.idx=0;
    state.answered=new Set(); state.correct=new Set(); state.wrong=new Set();
    nav().style.display='';
    renderQuestion(); setStats(); renderQGrid();
    // 注意：这里不用 flash()，否则"已生成试卷"会留在答题反馈区，
    // 看起来像上一题的答案提示。试卷信息已在顶部统计栏显示。
  }

  // ================= 错题本 =================
  function renderWrongBook(){
    nav().style.display='none';
    if(wrongBook.size===0){
      main().innerHTML = `<div class="empty">🎉 暂无错题！答错的题目会自动收录到这里，方便赛前集中复盘。</div>`;
      setStats(); return;
    }
    const items=Array.from(wrongBook.values()).sort((a,b)=>(b.ts||0)-(a.ts||0));
    let html=`<div class="q-title" style="font-size:17px;">📒 错题本（共 ${items.length} 道）</div>
      <div class="row" style="margin-bottom:10px;">
        <button class="btn ghost" id="wbClear">🗑️ 清空错题本</button>
        <span class="meta">提示：点"重练"将跳转到对应题型并定位到该题；"移除"仅删此题错题；"清空错题本"会删除全部错题（与上方"删除记录"互不影响）。</span>
      </div>
      <div class="wrong-list">`;
    const typeName={choice:'选择题',blank:'填空题',judge:'判断题'};
    items.forEach((it,idx)=>{
      const ansText = Array.isArray(it.answer)? it.answer.join(' / '):it.answer;
      const myAns = it.ua? '你的答案：'+esc(it.ua):'';
      const exp = it.explain? '<div class="wi-ex"><b>解析：</b>'+esc(it.explain)+'</div>':'';
      html+=`<div class="wrong-item" data-k="${esc(it.k)}">
        <div class="wi-stem">${idx+1}. 【${typeName[it.t]||it.t}】${withFormula(esc(it.stem), it.formula)}</div>
        <div class="wi-ans">✅ 正确答案：${esc(ansText)}${myAns? '　·　'+esc(myAns):''}</div>
        ${exp}
        <div class="wi-actions">
          <button class="btn" data-act="replay" data-type="${it.t}" data-k="${esc(it.k)}">🔁 重练</button>
          <button class="btn ghost" data-act="remove" data-k="${esc(it.k)}">移除</button>
        </div>
      </div>`;
    });
    html+=`</div>`;
    main().innerHTML=html; setStats();
    $('#wbClear').addEventListener('click',()=>{
      if(!confirm('确定清空全部错题本吗？此操作不可恢复。')) return;
      wrongBook.clear(); saveStore(); renderWrongBook(); setStats();
    });
    document.querySelectorAll('.wrong-item').forEach(box=>{
      box.querySelector('[data-act="remove"]').addEventListener('click',()=>{
        wrongBook.delete(box.dataset.k); saveStore(); renderWrongBook(); setStats();
      });
      const replay=box.querySelector('[data-act="replay"]'); if(replay) replay.addEventListener('click',()=>{
        const type=replay.dataset.type; switchType(type);
        // 定位到该题（按 _orig 匹配）
        const [t,oi]=replay.dataset.k.split(':'); const orig=Number(oi);
        const li=state.list.findIndex(q=>q._orig===orig);
        if(li>=0){ state.idx=li; renderQuestion(); }
      });
    });
  }

  // ================= 收藏本 =================
  function renderFavBook(){
    nav().style.display='none';
    const typeName={choice:'选择题',blank:'填空题',judge:'判断题'};
    // 汇总全部收藏：{type, orig, q}
    const items=[];
    ['choice','blank','judge'].forEach(t=>{
      const list=(DATA[t]||[]);
      favSet(t).forEach(orig=>{
        const q=list.find(x=>(x.no!=null?x.no:0)===orig) || list[orig-1];
        if(q) items.push({type:t, orig, q});
      });
    });
    if(items.length===0){
      main().innerHTML=`<div class="empty">⭐ 还没有收藏的题目。<br><br>在任意题目页点题干右侧的「☆ 收藏」按钮即可收藏，<br>收藏的题会集中显示在这里，方便考前重点复习。</div>`;
      setStats(); return;
    }
    const order={choice:0,blank:1,judge:2};
    items.sort((a,b)=> (order[a.type]-order[b.type]) || (a.orig-b.orig));
    let html=`<div class="q-title" style="font-size:17px;">⭐ 收藏本（共 ${items.length} 道）</div>
      <div class="row" style="margin-bottom:10px;">
        <button class="btn ghost" id="fbClear">🗑️ 清空收藏本</button>
        <span class="meta">提示："前往练习"跳转到该题；"取消收藏"仅从收藏本移除（不影响答题记录与错题本）。</span>
      </div>
      <div class="wrong-list">`;
    items.forEach((it,idx)=>{
      const q=it.q;
      const ansText = Array.isArray(q.answer)
        ? (it.type==='choice' ? ['A','B','C','D','E'][q.answer] : q.answer.join(' / '))
        : (it.type==='judge' ? (q.answer?'对（√）':'错（×）') : q.answer);
      const st = statusOf(it.type, it.orig);
      const stTag = st==='ok' ? '<span class="badge-corr">✅ 曾答对</span>'
                  : st==='err' ? '<span class="badge-wrong">❌ 曾答错</span>'
                  : '<span class="q-status qs-none">— 未做过</span>';
      // 选择题展示选项
      let optHtml='';
      if(it.type==='choice'){
        const letters=['A','B','C','D','E'];
        optHtml='<div class="wi-ex" style="margin-top:3px;">'+
          q.options.map((o,i)=>`${letters[i]}. ${withFormula(esc(o), q.formula)}${i===q.answer?' <b style="color:var(--ok);">✔</b>':''}`).join('　')+'</div>';
      }
      // 解析
      const expHtml = q.explain ? '<div class="wi-ex" style="margin-top:5px;color:#456;"><b>解析：</b>'+esc(q.explain)+'</div>' : '';
      html+=`<div class="wrong-item" style="border-left:4px solid #f0a500;" data-type="${it.type}" data-orig="${it.orig}">
        <div class="wi-stem">${idx+1}. 【${typeName[it.type]}】第${it.orig}题 　${withFormula(esc(q.stem), q.formula)}　${stTag}</div>
        <div class="wi-ans" style="color:var(--ok);">✅ 正确答案：${esc(ansText)}</div>
        ${optHtml}
        ${expHtml}
        <div class="wi-actions">
          <button class="btn" data-act="go">前往练习</button>
          <button class="btn ghost" data-act="unfav">取消收藏</button>
        </div>
      </div>`;
    });
    html+=`</div>`;
    main().innerHTML=html; setStats();
    const clr=$('#fbClear');
    if(clr) clr.addEventListener('click',()=>{
      if(!confirm('确定清空全部收藏本吗？此操作不可恢复。')) return;
      favorites.clear(); saveStore(); renderFavBook(); setStats();
    });
    document.querySelectorAll('.wrong-item[data-type]').forEach(box=>{
      const type=box.dataset.type, orig=Number(box.dataset.orig);
      const go=box.querySelector('[data-act="go"]');
      if(go) go.addEventListener('click',()=>{
        switchType(type);
        const li=state.list.findIndex(q=>q._orig===orig);
        if(li>=0){ state.idx=li; renderQuestion(); setStats(); }
      });
      const un=box.querySelector('[data-act="unfav"]');
      if(un) un.addEventListener('click',()=>{
        favSet(type).delete(orig); saveStore(); renderFavBook(); setStats();
      });
    });
  }

  // ================= 实操任务书（含模拟接线） =================
  function renderPractice(){
    nav().style.display='none';
    const html = `
      <div class="q-title" style="font-size:18px;">附件4 · 实操任务书（小车自动往返运动控制）</div>
      <div class="subtabs">
        <button class="subtab active" data-sub="doc">任务书 / 评分标准</button>
        <button class="subtab" data-sub="photo">📷 实物参考图</button>
        <button class="subtab" data-sub="wire">模拟接线练习</button>
      </div>
      <div id="subDoc">${practiceDocHTML()}</div>
      <div id="subPhoto" style="display:none;">${practicePhotoHTML()}</div>
      <div id="subWire" style="display:none;">${practiceWireHTML()}</div>`;
    main().innerHTML = html;
    setStats();
    document.querySelectorAll('.subtab').forEach(t=>t.addEventListener('click',()=>{
      document.querySelectorAll('.subtab').forEach(s=>s.classList.toggle('active', s===t));
      const sub=t.dataset.sub;
      $('#subDoc').style.display = (sub==='doc')?'':'none';
      $('#subPhoto').style.display = (sub==='photo')?'':'none';
      $('#subWire').style.display = (sub==='wire')?'':'none';
      // 切到实物图时才绑定"点击放大"（图片数据也是此时才首次读取）
      if(sub==='photo') bindFigZoom();
      if(sub==='wire') initWiringGame();
    }));
  }

  // 点击实物图 → 全屏放大查看（data URI 图片无法用 window.open，改用遮罩层）
  function bindFigZoom(){
    main().querySelectorAll('img.ref-fig').forEach(img=>{
      if(img.dataset.zoomBound) return;
      img.dataset.zoomBound = '1';
      img.addEventListener('click',()=>{
        const src = img.getAttribute('src');
        if(!src) return;
        let box = document.getElementById('figLightbox');
        if(!box){
          box = document.createElement('div');
          box.id = 'figLightbox';
          box.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:9999;'
            + 'display:flex;align-items:center;justify-content:center;padding:12px;cursor:zoom-out;';
          box.innerHTML = '<img id="figLightboxImg" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:6px;">'
            + '<div style="position:absolute;top:14px;right:16px;color:#fff;font-size:26px;line-height:1;">✕</div>';
          box.addEventListener('click',()=>{ box.style.display='none'; });
          document.body.appendChild(box);
        }
        const bi = box.querySelector('#figLightboxImg');
        if(bi){ bi.src = src; bi.alt = img.alt || ''; }
        box.style.display = 'flex';
      });
    });
  }

  function practiceDocHTML(){
    return `
      <div style="line-height:1.75;font-size:14px;">
        <h3 style="color:var(--primary);margin:8px 0 4px;">一、实操科目</h3>
        <p>小车自动往返运动控制。当接触器 KM1 吸合，电动机正转运行，小车向右移动；运行到限位开关时电机反转，小车向左移动，不断重复，直至按下停止开关，小车停止。</p>
        <h3 style="color:var(--primary);margin:8px 0 4px;">二、所需材料</h3>
        <p>3P 空开 1 个、2P 空开 1 个、熔断器 3 个、220V 交流接触器 2 个、按钮开关 3 个（2 个常开、1 个常闭）、行程开关 2 个（前进限位 1、后退限位 1）、三相异步电机 1 个、小车 1 个、轨道 1 个、端子排 1 个。</p>
        <h3 style="color:var(--primary);margin:8px 0 4px;">三、实操考试评分标准（100 分 · 按附件4原文）</h3>
        <table style="width:100%;border-collapse:collapse;font-size:12.5px;">
          <tr style="background:#eef3f8;">
            <th style="border:1px solid var(--line);padding:6px;width:90px;">项目内容</th>
            <th style="border:1px solid var(--line);padding:6px;width:52px;">分值</th>
            <th style="border:1px solid var(--line);padding:6px;">评分标准（扣分细则）</th></tr>
          <tr>
            <td style="border:1px solid var(--line);padding:6px;"><b>安装元件</b></td>
            <td style="border:1px solid var(--line);padding:6px;text-align:center;"><b>25 分</b></td>
            <td style="border:1px solid var(--line);padding:6px;line-height:1.9;">
              1、元器件选型不正确　<b style="color:var(--err);">每处扣 3 分</b><br>
              2、安装时造成元件损坏　<b style="color:var(--err);">扣 10 分</b></td></tr>
          <tr>
            <td style="border:1px solid var(--line);padding:6px;"><b>布线</b></td>
            <td style="border:1px solid var(--line);padding:6px;text-align:center;"><b>20 分</b></td>
            <td style="border:1px solid var(--line);padding:6px;line-height:1.9;">
              1、不按电路图接线　<b style="color:var(--err);">扣 10 分</b><br>
              2、布线不合理不整齐　<b style="color:var(--err);">每处扣 2 分</b><br>
              3、接点松动、裸铜过长、压绝缘层　<b style="color:var(--err);">每处扣 2 分</b><br>
              4、损伤导线绝缘或线芯　<b style="color:var(--err);">每处扣 2 分</b></td></tr>
          <tr>
            <td style="border:1px solid var(--line);padding:6px;"><b>通电操作</b></td>
            <td style="border:1px solid var(--line);padding:6px;text-align:center;"><b>30 分</b></td>
            <td style="border:1px solid var(--line);padding:6px;line-height:1.9;">
              1、第一次不成功　<b style="color:var(--err);">扣 10 分</b><br>
              2、第二次不成功　<b style="color:var(--err);">扣 20 分</b></td></tr>
          <tr>
            <td style="border:1px solid var(--line);padding:6px;"><b>安全文明生产</b></td>
            <td style="border:1px solid var(--line);padding:6px;text-align:center;"><b>15 分</b></td>
            <td style="border:1px solid var(--line);padding:6px;line-height:1.9;">
              1、违反电力安全工作规程　<b style="color:var(--err);">扣 10 分</b><br>
              2、安装完毕后，未清理操作台　<b style="color:var(--err);">扣 5 分</b></td></tr>
          <tr>
            <td style="border:1px solid var(--line);padding:6px;"><b>定额时间</b></td>
            <td style="border:1px solid var(--line);padding:6px;text-align:center;"><b>10 分</b></td>
            <td style="border:1px solid var(--line);padding:6px;line-height:1.9;">
              比赛 60 分钟，每超过 1 分钟扣 1 分，最多延长 10 分钟</td></tr>
          <tr style="background:#f7f9fb;">
            <td style="border:1px solid var(--line);padding:6px;"><b>成绩</b></td>
            <td style="border:1px solid var(--line);padding:6px;text-align:center;"><b>100 分</b></td>
            <td style="border:1px solid var(--line);padding:6px;"></td></tr>
        </table>

        <h3 style="color:var(--primary);margin:16px 0 4px;">四、10kV 倒闸操作考试评分标准（100 分 · 按附件4原文）</h3>
        <table style="width:100%;border-collapse:collapse;font-size:12.5px;">
          <tr style="background:#eef3f8;">
            <th style="border:1px solid var(--line);padding:6px;width:110px;">项目内容</th>
            <th style="border:1px solid var(--line);padding:6px;width:52px;">分值</th>
            <th style="border:1px solid var(--line);padding:6px;">评分标准（扣分细则）</th></tr>
          <tr>
            <td style="border:1px solid var(--line);padding:6px;"><b>填写倒闸操作票</b></td>
            <td style="border:1px solid var(--line);padding:6px;text-align:center;"><b>50</b></td>
            <td style="border:1px solid var(--line);padding:6px;line-height:1.9;">
              1、操作票填写漏项　<b style="color:var(--err);">每项扣 5 分</b><br>
              2、操作步骤逻辑顺序错误　<b style="color:var(--err);">每项扣 5 分</b><br>
              3、操作任务及步骤描述不准确　<b style="color:var(--err);">每项扣 5 分</b><br>
              4、操作票涂改　<b style="color:var(--err);">每项扣 3 分</b><br>
              5、填写操作票时间为 10 分钟，每超时 1 分钟　<b style="color:var(--err);">扣 1 分</b></td></tr>
          <tr>
            <td style="border:1px solid var(--line);padding:6px;"><b>模拟倒闸操作</b></td>
            <td style="border:1px solid var(--line);padding:6px;text-align:center;"><b>50</b></td>
            <td style="border:1px solid var(--line);padding:6px;line-height:1.9;">
              1、操作项目错误　<b style="color:var(--err);">扣 5 分</b><br>
              2、缺少唱票程序　<b style="color:var(--err);">扣 5 分</b><br>
              3、缺少复诵程序　<b style="color:var(--err);">扣 5 分</b><br>
              4、不按规范佩戴安全用具　<b style="color:var(--err);">扣 5 分</b><br>
              5、操作时间为 5 分钟，每超时 1 分钟　<b style="color:var(--err);">扣 1 分</b></td></tr>
          <tr style="background:#f7f9fb;">
            <td style="border:1px solid var(--line);padding:6px;"><b>成绩</b></td>
            <td style="border:1px solid var(--line);padding:6px;text-align:center;"><b>100 分</b></td>
            <td style="border:1px solid var(--line);padding:6px;"></td></tr>
        </table>

        <h3 style="color:var(--primary);margin:16px 0 4px;">五、变电站（发电厂）倒闸操作票（空白票样 · 按附件4原文）</h3>
        <div style="border:2px solid var(--primary);border-radius:6px;padding:10px 12px;background:#fff;">
          <div style="text-align:center;font-weight:700;font-size:14px;margin-bottom:8px;letter-spacing:1px;">变电站（发电厂）倒闸操作票</div>
          <div style="display:flex;gap:16px;font-size:12px;margin-bottom:6px;flex-wrap:wrap;">
            <span>单位：____________</span><span>编号：____________</span>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <tr>
              <td style="border:1px solid var(--line);padding:5px;width:34%;">发令时间：　年　月　日　时　分</td>
              <td style="border:1px solid var(--line);padding:5px;width:22%;">发令人：</td>
              <td style="border:1px solid var(--line);padding:5px;">受令人：</td></tr>
            <tr>
              <td style="border:1px solid var(--line);padding:5px;">操作开始时间：　年　月　日　时　分</td>
              <td colspan="2" style="border:1px solid var(--line);padding:5px;">操作结束时间：　年　月　日　时　分</td></tr>
            <tr>
              <td colspan="3" style="border:1px solid var(--line);padding:8px 5px;">
                <b>操作任务：</b><br><br></td></tr>
          </table>
          <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:-1px;">
            <tr style="background:#eef3f8;">
              <th style="border:1px solid var(--line);padding:5px;width:46px;">顺序</th>
              <th style="border:1px solid var(--line);padding:5px;text-align:center;letter-spacing:4px;">操　作　项　目</th>
              <th style="border:1px solid var(--line);padding:5px;width:34px;">√</th></tr>
            ${Array.from({length:16},(_,i)=>`<tr>
              <td style="border:1px solid var(--line);padding:5px;height:22px;text-align:center;">${i+1}</td>
              <td style="border:1px solid var(--line);padding:5px;"></td>
              <td style="border:1px solid var(--line);padding:5px;"></td></tr>`).join('')}
          </table>
          <div style="border:1px solid var(--line);border-top:none;padding:6px 5px;font-size:12px;">备注：</div>
          <div style="display:flex;gap:20px;font-size:12px;margin-top:8px;flex-wrap:wrap;">
            <span>操作人：________</span><span>监护人：________</span><span>值班负责人：________</span>
          </div>
        </div>
        <p style="color:var(--muted);margin-top:10px;font-size:12.5px;">
          💡 <b>填票要点：</b>操作票不得涂改（涂改每项扣 3 分）；步骤顺序必须正确——<b>停电时先拉断路器、再拉负荷侧隔离开关、最后拉电源侧隔离开关</b>；
          送电顺序相反。操作时要唱票、复诵，并规范佩戴绝缘手套等安全用具。
        </p>
        <p style="color:var(--muted);margin-top:8px;">提示：切换到"<b>📷 实物参考图</b>"可看接线实物与元器件图解；切到"<b>模拟接线练习</b>"可在交互画布上练习连线。</p>
      </div>`;
  }

  // ---------- 图片延迟加载（安卓离线版启动提速关键） ----------
  // 实物图占整包 77% 体积。安卓单文件版把图片 base64 放在 HTML 末尾的
  // <script type="text/plain" id="lazyImgData"> 里，这里按需读取并缓存。
  // 这样首屏启动只需解析代码，不必解析几百 KB 的图片数据。
  // 电脑版（多文件、无 lazyImgData）会直接回退为原文件名，行为不变。
  let _lazyImgs = null;
  function imgSrc(name){
    if(_lazyImgs === null){
      _lazyImgs = {};
      try{
        var el = document.getElementById('lazyImgData');
        if(el && el.textContent && el.textContent.trim()){
          _lazyImgs = JSON.parse(el.textContent) || {};
        }
      }catch(e){ _lazyImgs = {}; }
    }
    return _lazyImgs[name] || name;   // 取不到就用原文件名（电脑版走这条路）
  }

  // ---------- 实物参考图（对照学习用） ----------
  function practicePhotoHTML(){
    const fig = (src, cap, note) => `
      <figure style="margin:0 0 18px;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#fff;">
        <img src="${imgSrc(src)}" alt="${esc(cap)}" class="ref-fig" loading="lazy"
             style="width:100%;height:auto;display:block;cursor:zoom-in;background:#fafbfc;">
        <figcaption style="padding:9px 12px;font-size:12px;line-height:1.7;border-top:1px solid var(--line);background:#f7f9fb;">
          <b style="color:var(--primary);">${esc(cap)}</b>
          ${note? '<div style="color:var(--muted);margin-top:3px;">'+esc(note)+'</div>':''}
        </figcaption>
      </figure>`;
    return `
      <div style="line-height:1.7;font-size:13px;">
        <div style="background:#fff8e1;border:1px solid #f0d36b;border-radius:8px;padding:10px 13px;margin-bottom:14px;font-size:12.5px;">
          <b>📷 看图学接线：</b>下面整理了几张与"小车自动往返控制"高度接近的实物接线图与元器件图解。
          建议先看<b>整体布局</b>（元件怎么摆、线怎么走），再看<b>元器件端子</b>（主触点/辅助触点/线圈分别在哪），
          最后到"模拟接线练习"里动手练。点击图片可在新窗口放大查看。
        </div>

        <h3 style="color:var(--primary);margin:6px 0 10px;font-size:15px;">一、整体接线实物 / 接线图</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;">
          ${fig('ref_photo1.jpg','自动往返控制 · 原理图与接线图对照',
                '左为电气原理图，右为实际接线走向。重点看：主回路三相如何穿过接触器主触点接到电机，控制回路如何从电源经停止按钮分到正/反转支路。')}
          ${fig('ref_photo2.jpg','自动往返控制 · 实物接线图',
                '按此图核对你的元件布局：空开→熔断器→接触器→电机依次排列，控制回路走线走在一侧，避免与主回路交叉。')}
          ${fig('ref_photo3.jpg','自动往返电路控制 · 实物图',
                '注意两个接触器的主触点接线：KM2（反转）需将其中两相调换，这是实现电机正反转的关键，接错会造成相间短路。')}
        </div>

        <h3 style="color:var(--primary);margin:16px 0 10px;font-size:15px;">二、核心元器件实物与端子识别</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;">
          ${fig('ref_comp1.jpg','交流接触器 · 实物与部件标注',
                '识别要点：上端为<b>主触点</b>（接三相主回路，螺丝较大）；侧面/顶部为<b>辅助触点</b>（常开NO / 常闭NC，用于自锁与互锁）；<b>线圈</b>端子标 A1 / A2，接控制回路 220V。')}
          ${fig('ref_comp2.jpg','交流接触器 · 接线端子与符号图解',
                '对着图找 A1/A2 线圈端子与辅助触点编号（通常 13NO/14NO 为常开，21NC/22NC 为常闭）。互锁用的是<b>常闭</b>辅助触点，自锁用的是<b>常开</b>辅助触点，别接反。')}
          ${fig('ref_comp3.jpg','接触器主/辅触点接线端子图',
                '主触点三进三出（L1/L2/L3 → T1/T2/T3）；辅助触点容量小，只用于控制回路。接线时主回路用粗线、控制回路用细线，布线要横平竖直。')}
        </div>

        <h3 style="color:var(--primary);margin:16px 0 10px;font-size:15px;">三、接线自检清单（赛前对照）</h3>
        <div style="background:#e8f5e9;border:1px solid #c8e6c9;border-radius:8px;padding:11px 14px;font-size:12.5px;line-height:1.9;">
          ✅ <b>主回路：</b>L1/L2/L3 → 3P 空开 → 熔断器 FU1-3 → KM1/KM2 主触点 → 电机 U/V/W；KM2 调换两相实现反转<br>
          ✅ <b>控制回路：</b>2P 控制空开 → SB1 停止（常闭、串总回路）→ 分别经 SB2/SB3 启动 → KM 线圈<br>
          ✅ <b>自锁：</b>SB2 两端并联 KM1 常开辅助；SB3 两端并联 KM2 常开辅助（松开按钮仍能保持吸合）<br>
          ✅ <b>互锁：</b>KM1 常闭串入 KM2 线圈回路，KM2 常闭串入 KM1 线圈回路（<b>防止同时吸合造成相间短路，必查</b>）<br>
          ✅ <b>限位换向：</b>SQ1（左限位）常闭串 KM1 自锁回路、常开触发 KM2；SQ2（右限位）常闭串 KM2、常开触发 KM1<br>
          ✅ <b>工艺：</b>接点牢固、裸铜不过长、不压绝缘层、不伤线芯、布线整齐（每条都是评分扣分项）
        </div>
        <p style="color:var(--muted);margin-top:12px;font-size:12px;">
          ⚠️ 说明：以上图片为通用教学参考图，用于帮助你理解元件外观、端子位置与接线走向；实际比赛请以你们赛区下发的官方图纸为准。
        </p>
      </div>`;
  }

  function practiceWireHTML(){
    return `
      <div style="line-height:1.6;font-size:13px;">
        <p style="margin:4px 0 8px;"><b>玩法：</b>左右两栏——左为参考接线图，右为元器件端子区（按主回路/控制回路分组卡片）。依次<b>点选两个端子</b>即可连线；<b>点已连线段可删除该条</b>；"撤销"回退上一步，"删除最近"移除最后一条。点"校验连线"对照标准答案判分；点"显示答案"查看标准接线。</p>
        <div class="wire-wrap">
          <div class="wire-left">
            <div style="border:1px solid var(--line);border-radius:8px;background:#fff;padding:10px 12px;">
              <div style="font-size:12px;color:var(--muted);text-align:center;margin-bottom:6px;">▲ 标准原理图（主回路 + 控制回路 · 按附件4任务书核对）</div>
              <svg viewBox="0 0 460 560" width="100%" xmlns="http://www.w3.org/2000/svg" style="display:block;margin:0 auto;max-height:560px;">
                <defs><style>.t{font:11px 'Microsoft YaHei',sans-serif;fill:#1f2933}.t2{font:10px 'Microsoft YaHei',sans-serif;fill:#55606b}.lb{font:10px 'Microsoft YaHei',sans-serif;font-weight:700;fill:#1f4e79}.lo{font:9px 'Microsoft YaHei',sans-serif;fill:#d35400}.lc{font:9px 'Microsoft YaHei',sans-serif;fill:#2e75b6}.ls{font:9px 'Microsoft YaHei',sans-serif;fill:#7d3c98}</style></defs>
                <!-- 主回路 L1/L2/L3 -->
                <g stroke="#333" stroke-width="1.4" fill="none">
                  <path d="M40,40 V500"/><path d="M120,40 V500"/><path d="M200,40 V500"/>
                  <path d="M40,90 H70"/><path d="M120,90 H150"/><path d="M200,90 H230"/>
                  <rect x="62" y="60" width="46" height="44" rx="6"/><rect x="142" y="60" width="46" height="44" rx="6"/><rect x="222" y="60" width="46" height="44" rx="6"/>
                  <path d="M85,104 V130"/><path d="M165,104 V130"/><path d="M245,104 V130"/>
                  <path d="M85,160 V190"/><path d="M165,160 V190"/><path d="M245,160 V190"/>
                  <rect x="62" y="130" width="46" height="40" rx="4"/><rect x="142" y="130" width="46" height="40" rx="4"/><rect x="222" y="130" width="46" height="40" rx="4"/>
                  <path d="M85,170 H300"/><path d="M165,170 H300"/><path d="M245,170 H300"/>
                  <path d="M300,170 V300"/><path d="M300,170 V300"/>
                  <path d="M85,200 V230"/><path d="M165,200 V260"/><path d="M245,200 V230"/>
                  <rect x="62" y="230" width="46" height="40" rx="4"/><rect x="142" y="230" width="46" height="40" rx="4"/><rect x="222" y="230" width="46" height="40" rx="4"/>
                  <path d="M85,270 V300"/><path d="M165,270 V300"/><path d="M245,270 V300"/>
                  <path d="M85,300 H330"/><path d="M165,300 H330"/><path d="M245,300 H330"/>
                  <path d="M330,170 V300"/>
                  <path d="M330,220 H360"/><path d="M330,250 H360"/>
                  <circle cx="360" cy="220" r="3" fill="#333"/><circle cx="360" cy="250" r="3" fill="#333"/>
                  <path d="M360,220 V470"/><path d="M360,250 V470"/><path d="M120,500 V470"/><path d="M200,500 V470"/>
                  <path d="M360,470 H120"/><path d="M360,470 H200"/>
                  <path d="M240,470 H330"/><path d="M285,470 V500"/>
                  <path d="M360,485 H400"/><path d="M400,485 V40"/><path d="M400,40 H200"/><path d="M200,40 H40" stroke-dasharray="3 3"/>
                </g>
                <g class="t"><text x="84" y="83" text-anchor="middle">QF1</text><text x="164" y="83" text-anchor="middle">QF1</text><text x="244" y="83" text-anchor="middle">QF1</text>
                  <text x="84" y="153" text-anchor="middle">FU</text><text x="164" y="153" text-anchor="middle">FU</text><text x="244" y="153" text-anchor="middle">FU</text>
                  <text x="84" y="253" text-anchor="middle">KM1</text><text x="164" y="253" text-anchor="middle">KM2</text><text x="244" y="253" text-anchor="middle">KM1</text>
                  <text x="345" y="215">M</text><text x="408" y="34" class="t2">PE</text>
                  <text x="84" y="522" text-anchor="middle" class="lb">L1</text><text x="164" y="522" text-anchor="middle" class="lb">L2</text><text x="244" y="522" text-anchor="middle" class="lb">L3</text>
                  <text x="345" y="290" class="lb">U</text><text x="345" y="305" class="lb">V</text><text x="308" y="298" class="lb">W</text>
                </g>
                <g class="lo"><text x="270" y="120">相序 L1-L2-L3</text><text x="270" y="285">KM2 换两相</text></g>
                <!-- 控制回路 -->
                <g stroke="#2e75b6" stroke-width="1.3" fill="none">
                  <path d="M40,560 V530"/><path d="M40,530 H420"/><path d="M420,530 V40"/><path d="M420,40 H300"/><path d="M300,40 V90"/>
                  <rect x="60" y="90" width="60" height="30" rx="4"/><rect x="150" y="90" width="60" height="30" rx="4"/><rect x="240" y="90" width="60" height="30" rx="4"/>
                  <path d="M120,105 H150"/><path d="M210,105 H240"/><path d="M300,105 H330"/>
                  <rect x="330" y="90" width="46" height="30" rx="4"/>
                  <path d="M300,140 V170"/><path d="M375,120 V170"/>
                  <path d="M300,170 H375"/><path d="M337,170 V200"/>
                  <rect x="300" y="200" width="74" height="34" rx="4"/>
                  <path d="M337,234 V260"/><path d="M337,260 H120"/><path d="M120,260 V530"/>
                  <path d="M40,545 H120"/><path d="M80,530 V545"/>
                </g>
                <g class="t"><text x="90" y="108" text-anchor="middle">SB1</text><text x="180" y="108" text-anchor="middle">SB2</text><text x="270" y="108" text-anchor="middle">SB3</text>
                  <text x="352" y="108" text-anchor="middle">QF2</text><text x="337" y="217" text-anchor="middle">KM1</text>
                  <text x="90" y="78" text-anchor="middle" class="lc">控制回路 L→N</text>
                  <text x="180" y="80" class="ls">SB2∥KM1自锁</text><text x="270" y="80" class="ls">SB3∥KM2自锁</text>
                </g>
                <g class="t2"><text x="300" y="138">KM1常闭互锁</text><text x="300" y="150">串KM2线圈回路</text>
                  <text x="155" y="145">KM2常闭互锁</text><text x="155" y="157">串KM1线圈回路</text>
                  <text x="300" y="195" class="lo">SQ1-NC串KM1</text><text x="300" y="207" class="lo">SQ2-NC串KM2</text>
                </g>
                <g class="lb"><text x="6" y="280">主回路</text><text x="6" y="555">控制回路</text></g>
              </svg>
            </div>
            <div class="ref-cap">▲ 继电器控制器电路图（参考 · 标准原理图）。主回路 KM1/KM2 换相实现正反转；控制回路 SB1 总停、SB2/SB3 启动并自锁、KM1/KM2 常闭交叉互锁、SQ1(左)/SQ2(右) 限位换向。</div>
          </div>
          <div class="wire-right">
            <div class="wire-canvas" id="wireCanvas">
              <div class="comp-grid" id="compGrid"></div>
            </div>
            <div class="wire-tools">
              <button class="btn" id="wireCheck">校验连线</button>
              <button class="btn ghost" id="wireAnswer">显示答案</button>
              <button class="btn ghost" id="wireUndo">撤销</button>
              <button class="btn ghost" id="wireDelLast">删除最近</button>
              <button class="btn ghost" id="wireReset">重置</button>
              <span class="wire-msg" id="wireMsg"></span>
              <span class="wire-legend">已连 <b id="wireConn">0</b> / 应连 <b id="wireTotal">0</b>
                <span style="margin-left:8px;"><i class="wl-dot-main"></i>主回路</span>
                <span><i class="wl-dot-ctrl"></i>控制回路</span>
                <span><i class="wl-dot-self"></i>自锁/互锁</span>
              </span>
            </div>
            <div style="font-size:12px;color:var(--muted);margin-top:8px;line-height:1.7;">
              <b>接线要点（赛点）：</b>主电路 L1/L2/L3 → 3P 空开 → 熔断器 → KM1/KM2 主触点 → 电机 M；控制电路经 2P 空开 → 停止 SB1(常闭) → 正转启动 SB2(常开) / 反转启动 SB3(常开) → KM 自锁/互锁 → 左限位 SQ1 / 右限位 SQ2。KM1、KM2 <b>互锁</b>（常闭触点串入对方线圈回路），防止正反转同时吸合造成相间短路。
            </div>
            <details style="margin-top:10px;font-size:12px;color:var(--muted);">
              <summary style="cursor:pointer;color:var(--primary);font-weight:700;">📋 展开标准答案连线清单（${CORRECT.length} 条 · 按主/控/自锁分组）</summary>
              <div id="wireAnswerList" style="margin-top:8px;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:6px 14px;"></div>
            </details>
          </div>
        </div>`;
  }

  // ---------- 模拟接线游戏 ----------
  // 元器件端子模型（无坐标，按主回路/控制回路分组卡片渲染）
  const COMP_GROUPS = [
    {title:'主回路', comps:[
      {id:'L', name:'三相电源 L1/L2/L3', grp:'main', terms:[{t:'L1'},{t:'L2'},{t:'L3'}]},
      {id:'QF3', name:'3P 空开', grp:'main', terms:[{t:'1'},{t:'2'},{t:'3'},{t:"1'"},{t:"2'"},{t:"3'"}]},
      {id:'FU', name:'熔断器 FU1-3', grp:'main', terms:[{t:'in1'},{t:'in2'},{t:'in3'},{t:'out1'},{t:'out2'},{t:'out3'}]},
      {id:'KM1', name:'KM1 正转接触器', grp:'main', terms:[{t:'主1'},{t:'主2'},{t:'主3'},{t:'线圈A1',ctrl:true},{t:'常开辅助',ctrl:true},{t:'常闭互锁',ctrl:true}]},
      {id:'KM2', name:'KM2 反转接触器', grp:'main', terms:[{t:'主1'},{t:'主2'},{t:'主3'},{t:'线圈A1',ctrl:true},{t:'常开辅助',ctrl:true},{t:'常闭互锁',ctrl:true}]},
      {id:'M', name:'三相异步电机 M', grp:'main', terms:[{t:'U'},{t:'V'},{t:'W'}]},
    ]},
    {title:'控制回路', comps:[
      {id:'QF2', name:'2P 控制空开', grp:'ctrl', terms:[{t:'Lin'},{t:'Lout'}]},
      {id:'SB1', name:'SB1 停止(常闭)', grp:'ctrl', terms:[{t:'SB1-1'},{t:'SB1-2'}]},
      {id:'SB2', name:'SB2 正转启动(常开)', grp:'ctrl', terms:[{t:'SB2-1'},{t:'SB2-2'}]},
      {id:'SB3', name:'SB3 反转启动(常开)', grp:'ctrl', terms:[{t:'SB3-1'},{t:'SB3-2'}]},
      {id:'SQ1', name:'SQ1 左限位', grp:'ctrl', terms:[{t:'SQ1-NC'},{t:'SQ1-NO'}]},
      {id:'SQ2', name:'SQ2 右限位', grp:'ctrl', terms:[{t:'SQ2-NC'},{t:'SQ2-NO'}]},
    ]},
  ];
  // 正确连线（端子 id 对 + 分组）。赛点：主回路三相贯通；控制回路 SB1 常闭总停；
  // SB2 启动 KM1 并自锁，SB3 启动 KM2 并自锁；KM 常闭互锁交叉；
  // SQ1(左限位)NC 串 KM1、NO 触发 KM2；SQ2(右限位)NC 串 KM2、NO 触发 KM1。
  // 分组：main=主回路(橙) ctrl=控制回路(蓝) self=自锁/互锁(紫)
  const CORRECT = [
    ['L:L1','QF3:1','main'],['L:L2','QF3:2','main'],['L:L3','QF3:3','main'],
    ['QF3:1\'','FU:in1','main'],['QF3:2\'','FU:in2','main'],['QF3:3\'','FU:in3','main'],
    ['FU:out1','KM1:主1','main'],['FU:out2','KM1:主2','main'],['FU:out3','KM1:主3','main'],
    ['KM1:主1','M:U','main'],['KM1:主2','M:V','main'],['KM1:主3','M:W','main'],
    ['QF2:Lout','SB1:SB1-1','ctrl'],
    ['SB1:SB1-2','SB2:SB2-1','ctrl'],['SB2:SB2-2','KM1:线圈A1','ctrl'],
    ['SB1:SB1-2','SB3:SB3-1','ctrl'],['SB3:SB3-2','KM2:线圈A1','ctrl'],
    ['KM1:常开辅助','KM1:线圈A1','self'],['KM2:常开辅助','KM2:线圈A1','self'],
    ['KM1:常闭互锁','KM2:线圈A1','self'],['KM2:常闭互锁','KM1:线圈A1','self'],
    ['SQ1:SQ1-NC','KM1:线圈A1','ctrl'],['SQ1:SQ1-NO','KM2:线圈A1','ctrl'],
    ['SQ2:SQ2-NC','KM2:线圈A1','ctrl'],['SQ2:SQ2-NO','KM1:线圈A1','ctrl'],
  ];

  let wire=null; // 游戏运行时状态
  function initWiringGame(){
    const canvas = $('#wireCanvas'); if(!canvas) return;
    const grid = $('#compGrid'); if(!grid) return;
    if(wire && wire.canvas===canvas && grid.dataset.built==='1'){ drawWires(); return; }
    grid.innerHTML=''; grid.dataset.built='1';
    const termEls = {};
    COMP_GROUPS.forEach(g=>{
      const wrap=document.createElement('div'); wrap.style.gridColumn='1 / -1';
      wrap.innerHTML=`<div class="wire-section-title">${g.title==='主回路'?'⚡ 主回路':'🎛️ 控制回路'}</div>`;
      grid.appendChild(wrap);
      g.comps.forEach(c=>{
        const el=document.createElement('div'); el.className='comp';
        const tagHtml = c.grp==='main'?'<span class="tag main">主</span>':'<span class="tag ctrl">控</span>';
        let html=`<div class="cname">${esc(c.name)}${tagHtml}</div><div class="terms">`;
        c.terms.forEach(t=>{
          const cls = (t.ctrl||c.grp==='ctrl')? 'term ctrl':'term main';
          html+=`<span class="${cls}" data-tid="${c.id}:${esc(t.t)}" title="${esc(c.id)}:${esc(t.t)}"><span class="dot"></span><span class="tlabel">${esc(t.t)}</span></span>`;
        });
        html+=`</div>`; el.innerHTML=html; grid.appendChild(el);
        el.querySelectorAll('.term').forEach(span=>{ termEls[span.dataset.tid]=span; });
      });
    });
    let svg=canvas.querySelector('svg');
    if(!svg){ svg=document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.setAttribute('preserveAspectRatio','none'); canvas.appendChild(svg); }
    wire = {canvas, svg, termEls, conns:[], undo:[], sel:null, answered:false};
    const onTermClick=(e)=>{
      const span=e.currentTarget; const tid=span.dataset.tid;
      if(wire.sel && wire.sel!==tid){
        const key=[wire.sel,tid].sort().join('|');
        if(!wire.conns.includes(key)){ wire.conns.push(key); wire.undo.push(key); }
        span.classList.remove('sel'); const s0=wire.termEls[wire.sel]; s0&&s0.classList.remove('sel'); wire.sel=null;
      } else { if(wire.sel===tid){span.classList.remove('sel');wire.sel=null;} else {span.classList.add('sel');wire.sel=tid;} }
      drawWires(); updateWireCount();
    };
    Object.values(termEls).forEach(s=>s.addEventListener('click', onTermClick));
    canvas.addEventListener('click', onClickWireBg);
    drawWires(); updateWireCount();
    $('#wireCheck').onclick=checkWires; $('#wireAnswer').onclick=showAnswer;
    $('#wireReset').onclick=resetWires; $('#wireUndo').onclick=undoWire; $('#wireDelLast').onclick=delLastWire;
    window.addEventListener('resize', drawWires);
    // 渲染标准答案连线清单（按主/控/自锁分组）
    const list=$('#wireAnswerList'); if(list){
      const grpLabel={main:'⚡主回路',ctrl:'🎛️控制回路',self:'🔒自锁/互锁'};
      const grpColor={main:'#d35400',ctrl:'#2e75b6',self:'#7d3c98'};
      const groups={main:[],ctrl:[],self:[]};
      CORRECT.forEach(c=>{ (groups[c[2]]=groups[c[2]]||[]).push(c); });
      list.innerHTML=Object.keys(groups).map(g=>{
        const items=(groups[g]||[]).map(c=>`<li>${esc(c[0].split(':')[0])}:${esc(c[0].split(':')[1])} ↔ ${esc(c[1].split(':')[0])}:${esc(c[1].split(':')[1])}</li>`).join('');
        return `<div><div style="font-weight:700;color:${grpColor[g]||'#1f4e79'};margin-bottom:2px;">${grpLabel[g]||g}（${groups[g].length}条）</div><ul style="margin:0;padding-left:16px;line-height:1.6;">${items}</ul></div>`;
      }).join('');
    }
  }
  // 取端子中心相对 canvas 的坐标（用 offsetLeft/Top 逐级累加，避开 getBoundingClientRect 的滚动/缩放偏移问题）
  function termCenter(tid){
    const el=wire.termEls[tid]; if(!el) return null;
    let x=0,y=0,cur=el; const c=wire.canvas;
    while(cur && cur!==c){ x+=cur.offsetLeft; y+=cur.offsetTop; cur=cur.offsetParent; }
    // el 中心
    x += el.offsetWidth/2; y += el.offsetHeight/2;
    return {x,y};
  }
  function groupOfConn(a,b){
    // 根据 CORRECT 表判断该连线所属分组；找不到归为 ctrl
    const key=[a,b].sort().join('|');
    const hit=CORRECT.find(c=>normConn(c[0]+'|'+c[1])===key); return hit? hit[2]:'ctrl';
  }
  function onClickWireBg(e){
    if(!wire) return;
    if(e.target&&e.target.tagName==='line'){
      const x1=+e.target.getAttribute('x1'), y1=+e.target.getAttribute('y1'), x2=+e.target.getAttribute('x2'), y2=+e.target.getAttribute('y2');
      const idx=wire.conns.findIndex(c=>{const [a,b]=c.split('|');const pa=termCenter(a),pb=termCenter(b);if(!pa||!pb) return false;
        return (Math.hypot(pa.x-x1,pa.y-y1)<10&&Math.hypot(pb.x-x2,pb.y-y2)<10)||(Math.hypot(pa.x-x2,pa.y-y2)<10&&Math.hypot(pb.x-x1,pb.y-y1)<10); });
      if(idx>=0){ wire.conns.splice(idx,1); drawWires(); updateWireCount(); }
    }
  }
  function undoWire(){ if(!wire||!wire.undo.length) return; wire.conns.pop(); wire.undo.pop(); drawWires(); updateWireCount(); }
  function delLastWire(){ undoWire(); }
  function normConn(c){ return c.split('|').sort().join('|'); }
  function connExists(a,b){ return wire.conns.includes([a,b].sort().join('|')); }
  function drawWires(){
    if(!wire) return;
    const svg=wire.svg; while(svg.firstChild) svg.removeChild(svg.firstChild);
    // 动态 viewBox 跟随 canvas 实际尺寸
    const W=wire.canvas.clientWidth||wire.canvas.offsetWidth||600, H=wire.canvas.clientHeight||wire.canvas.offsetHeight||520;
    svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
    wire.conns.forEach(c=>{ const [a,b]=c.split('|'); const pa=termCenter(a), pb=termCenter(b); if(!pa||!pb) return;
      const ln=document.createElementNS('http://www.w3.org/2000/svg','line');
      ln.setAttribute('x1',pa.x);ln.setAttribute('y1',pa.y);ln.setAttribute('x2',pb.x);ln.setAttribute('y2',pb.y);
      ln.setAttribute('stroke-linecap','round');
      // 校验/答案模式下带 ok/bad 类的线段按分组+状态着色
      const isWrong = wire.answered && wire.termEls[a]&&wire.termEls[a].classList.contains('bad');
      if(isWrong){ ln.setAttribute('class','wl-wrong'); }
      else { const g=groupOfConn(a,b); ln.setAttribute('class','wl-'+g); }
      svg.appendChild(ln);
    });
  }
  function updateWireCount(){ if(!wire) return; $('#wireConn').textContent=wire.conns.length; $('#wireTotal').textContent=CORRECT.length; }
  function resetWires(){ if(!wire) return; wire.conns=[]; wire.undo=[]; wire.sel=null; wire.answered=false;
    Object.values(wire.termEls).forEach(e=>e.classList.remove('ok','bad','sel')); drawWires(); updateWireCount(); $('#wireMsg').textContent='已重置'; $('#wireMsg').className='wire-msg'; }
  function checkWires(){
    if(!wire) return;
    const correctSet = new Set(CORRECT.map(c=>normConn(c[0]+'|'+c[1])));
    let correctCnt=0, wrongCnt=0;
    wire.conns.forEach(c=>{ if(correctSet.has(c)) correctCnt++; else wrongCnt++; });
    const need = CORRECT.length;
    Object.values(wire.termEls).forEach(e=>e.classList.remove('ok','bad'));
    wire.conns.forEach(c=>{ const [a,b]=c.split('|'); if(correctSet.has(c)){wire.termEls[a]&&wire.termEls[a].classList.add('ok');wire.termEls[b]&&wire.termEls[b].classList.add('ok');} else {wire.termEls[a]&&wire.termEls[a].classList.add('bad');wire.termEls[b]&&wire.termEls[b].classList.add('bad');} });
    wire.answered=true; drawWires();
    const msg=$('#wireMsg'); msg.textContent=`正确 ${correctCnt} 条，错误 ${wrongCnt} 条，标准应连 ${need} 条。${correctCnt===need&&wrongCnt===0?'🎉 全部接对！':''}`;
    msg.className='wire-msg '+(correctCnt===need&&wrongCnt===0?'ok':'err');
  }
  function showAnswer(){
    if(!wire) return;
    wire.conns=CORRECT.map(c=>normConn(c[0]+'|'+c[1])); wire.undo=[];
    Object.values(wire.termEls).forEach(e=>e.classList.remove('bad'));
    CORRECT.forEach(c=>{ wire.termEls[c[0]]&&wire.termEls[c[0]].classList.add('ok'); wire.termEls[c[1]]&&wire.termEls[c[1]].classList.add('ok'); });
    wire.answered=true; drawWires(); updateWireCount(); $('#wireMsg').textContent='已显示标准答案接线（橙=主回路 / 蓝=控制回路 / 紫=自锁互锁）。'; $('#wireMsg').className='wire-msg ok';
  }

  // ---------- 导航 ----------
  function nextQ(){ if(state.list.length===0) return; state.idx=(state.idx+1)%state.list.length; renderQuestion(); }
  function prevQ(){ if(state.list.length===0) return; state.idx=(state.idx-1+state.list.length)%state.list.length; renderQuestion(); }
  function randQ(){ if(state.list.length===0) return; let n=state.idx; while(state.list.length>1&&n===state.idx) n=Math.floor(Math.random()*state.list.length); state.idx=n; renderQuestion(); }

  // ---------- 事件 ----------
  document.querySelectorAll('#typeTabs .tab').forEach(t=>t.addEventListener('click',()=>switchType(t.dataset.type)));
  document.querySelectorAll('#modeGroup button').forEach(b=>b.addEventListener('click',()=>switchMode(b.dataset.mode)));
  $('#submitBtn').addEventListener('click',checkAnswer);
  $('#nextBtn').addEventListener('click',nextQ);
  $('#prevBtn').addEventListener('click',prevQ);
  $('#randBtn').addEventListener('click',randQ);
  // 删除记录（重置当前题型答题进度，保留错题本）
  const $resetProg=$('#resetProg');
  if($resetProg){ $resetProg.addEventListener('click',resetProgress); }
  // 重新组卷：回到配置页（仅组卷模式显示）
  const $reDrill=$('#reDrillBtn');
  if($reDrill){ $reDrill.addEventListener('click',()=>{ state.drill.active=false; renderDrillSetup(); }); }

  // ---- 题号面板：开关 / 只看错题 / 上次做到 ----
  const $qgridPanel=$('#qgridPanel');
  const $gridToggle=$('#gridToggle');
  if($gridToggle){ $gridToggle.addEventListener('click',()=>{
    if($qgridPanel.style.display==='none'){ $qgridPanel.style.display=''; renderQGrid(); }
    else { $qgridPanel.style.display='none'; }
  }); }
  const $qgOnlyWrong=$('#qgOnlyWrong');
  if($qgOnlyWrong){ $qgOnlyWrong.addEventListener('click',()=>{ qgOnlyWrong=!qgOnlyWrong; $qgOnlyWrong.textContent=qgOnlyWrong?'显示全部':'只看错题'; $qgOnlyWrong.classList.toggle('on',qgOnlyWrong); renderQGrid(); }); }
  const $qgOnlyFav=$('#qgOnlyFav');
  if($qgOnlyFav){ $qgOnlyFav.addEventListener('click',()=>{
    qgOnlyFav=!qgOnlyFav;
    $qgOnlyFav.textContent=qgOnlyFav?'显示全部':'⭐只看收藏';
    $qgOnlyFav.classList.toggle('on',qgOnlyFav);
    const n=$('#qgCountFav')? +$('#qgCountFav').textContent : 0;
    if(qgOnlyFav&&n===0) flash('本题型还没有收藏的题目，点题目旁的「☆ 收藏」可收藏','err',false);
    renderQGrid();
  }); }
  const $qgGotoLast=$('#qgGotoLast');
  if($qgGotoLast){ $qgGotoLast.addEventListener('click',()=>{
    const lastOrig=lastIdx.get(state.type); if(typeof lastOrig!=='number'){ flash('本题型还没有做题记录','err',false); return; }
    const li=state.list.findIndex(q=>q._orig===lastOrig); if(li>=0){ state.idx=li; renderQuestion(); setStats(); }
  }); }
  $('#autoNext').addEventListener('change',e=>state.autoNext=e.target.checked);
  $('#showAns').addEventListener('change',e=>state.showAns=e.target.checked);
  // 🎓 背题模式：切换时重绘当前题（清掉可能已显示的答案/填入内容），保持一致体验
  const $recite=$('#reciteMode');
  if($recite){
    $recite.addEventListener('change',e=>{
      state.recite=e.target.checked;
      try{ localStorage.setItem('reciteMode', state.recite?'1':'0'); }catch(err){}
      if(!isPageType(state.type)){ renderQuestion(); setStats(); }
      flash(state.recite? '🎓 已开启背题模式：可随时看答案，不判分、不计错题' : '已关闭背题模式，恢复正常答题',
            'ok', false);
    });
  }
  document.addEventListener('keydown',e=>{
    if(state.type==='practice') return;
    if(e.target.tagName==='TEXTAREA'||e.target.tagName==='INPUT') return;
    if(e.key==='ArrowRight') nextQ(); else if(e.key==='ArrowLeft') prevQ();
    else if(e.key==='Enter'){ if(state.answered.has(state.idx)) nextQ(); else checkAnswer(); }
  });

  // ================= 多端同步（GitHub Gist / Gitee 仓库 / JSON 文件 三种任选） =================
  const $token=$('#gistToken'), $gid=$('#gistId'), $smsg=$('#syncMsg');
  const $gToken=$('#giteeToken'), $gOwner=$('#giteeOwner'), $gRepo=$('#giteeRepo'), $gPath=$('#giteePath');
  (function restoreSyncCreds(){
    const s=loadStore();
    if(s.token) $token.value=s.token;
    if(s.gistId) $gid.value=s.gistId;
    // Gitee 凭据
    if(s.giteeToken) $gToken.value=s.giteeToken;
    if(s.giteeOwner) $gOwner.value=s.giteeOwner;
    if(s.giteeRepo) $gRepo.value=s.giteeRepo;
    if(s.giteePath) $gPath.value=s.giteePath;
    else if($gPath) $gPath.value='sync.json';
  })();
  function setSyncMsg(t,kind){ $smsg.textContent=t; $smsg.className='sync-msg '+(kind||''); }
  function persistCreds(token,gistId){ const s=loadStore(); if(token)s.token=token; if(gistId)s.gistId=gistId; localStorage.setItem(STORE_KEY,JSON.stringify(s)); }
  function persistGitee(creds){ const s=loadStore(); Object.assign(s,creds); localStorage.setItem(STORE_KEY,JSON.stringify(s)); }
  function serializeAll(){ return {wrongBook:Array.from(wrongBook.values()), progress:Array.from(progress.entries()).map(([k,v])=>({k,t:v.t,answered:v.answered,correct:v.correct,wrong:v.wrong})),
    perQ:Array.from(perQ.entries()).map(([type,v])=>({type,ok:Array.from(v.ok),err:Array.from(v.err)})),
    lastIdx:Array.from(lastIdx.entries()),
    favorites:Array.from(favorites.entries()).map(([type,v])=>({type,items:Array.from(v)})),
    userAns:Array.from(userAns.entries()).map(([type,m])=>({type, items:Array.from(m.entries())})),
    exportedAt:Date.now(), version:3}; }
  function applyRemote(data){
    if(!data) return;
    (data.wrongBook||[]).forEach(x=>wrongBook.set(x.k,x));
    (data.progress||[]).forEach(x=>progress.set(x.k,{t:x.t,answered:x.answered,correct:x.correct,wrong:x.wrong}));
    (data.perQ||[]).forEach(x=>{
      const cur=perQ.get(x.type)||{ok:new Set(),err:new Set()};
      (x.ok||[]).forEach(i=>cur.ok.add(i)); (x.err||[]).forEach(i=>cur.err.add(i));
      perQ.set(x.type,cur);
    });
    (data.lastIdx||[]).forEach(([type,idx])=>{ if(typeof idx==='number') lastIdx.set(type,idx); });
    (data.favorites||[]).forEach(x=>{
      const cur=favorites.get(x.type)||new Set();
      (x.items||[]).forEach(i=>cur.add(i));
      favorites.set(x.type,cur);
    });
    (data.userAns||[]).forEach(x=>{
      const cur=userAns.get(x.type)||new Map();
      (x.items||[]).forEach(([k,v])=>cur.set(k,v));
      userAns.set(x.type,cur);
    });
    saveStore();
  }
  async function gistReq(token,path,opts){ return fetch('https://api.github.com'+path, Object.assign({headers:{'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','Content-Type':'application/json'}},opts)); }

  // ---------- Gitee 仓库同步 ----------
  // 数据以 sync.json 存在你的 Gitee 仓库里。Gitee OpenAPI 支持 CORS，可在浏览器直接调用。
  const GITEE_API='https://gitee.com/api/v5';
  function giteeCreds(){
    return {
      token:($gToken&&$gToken.value||'').trim(),
      owner:($gOwner&&$gOwner.value||'').trim(),
      repo:($gRepo&&$gRepo.value||'').trim(),
      path:($gPath&&$gPath.value||'').trim()||'sync.json'
    };
  }
  // 校验并持久化 Gitee 配置
  function ensureGitee(){
    const c=giteeCreds();
    if(!c.token){ setSyncMsg('请先填写 Gitee 私人令牌（设置 → 私人令牌，勾选 projects 权限）','err'); return null; }
    if(!c.owner){ setSyncMsg('请先填写 Gitee 用户名','err'); return null; }
    if(!c.repo){ setSyncMsg('请先填写仓库名（如 dianong-sync）','err'); return null; }
    persistGitee({giteeToken:c.token, giteeOwner:c.owner, giteeRepo:c.repo, giteePath:c.path});
    return c;
  }
  // UTF-8 安全的 base64 编码（btoa 不支持中文，必须先转 UTF-8 字节）
  function b64encode(str){
    const bytes=new TextEncoder().encode(str);
    let bin=''; for(let i=0;i<bytes.length;i++) bin+=String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  // UTF-8 安全的 base64 解码
  function b64decode(b64){
    const bin=atob(b64.replace(/\s/g,''));
    const bytes=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  // 读取远端文件（返回 {sha, content} 或 null）
  async function giteeReadFile(c){
    const url=`${GITEE_API}/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${encodeURIComponent(c.path)}?access_token=${encodeURIComponent(c.token)}&ref=master`;
    const res=await fetch(url,{headers:{'Accept':'application/json'}});
    if(res.status===404) return null;             // 文件还不存在
    if(!res.ok){ throw new Error('读取失败 '+res.status+' '+(await res.text().catch(()=>'')).slice(0,120)); }
    const j=await res.json();
    return {sha:j.sha, content:b64decode(j.content||'')};
  }
  // 写入/更新远端文件
  async function giteeWriteFile(c, text, sha){
    const url=`${GITEE_API}/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${encodeURIComponent(c.path)}`;
    const body={access_token:c.token, message:'电工题库同步数据 '+new Date().toLocaleString('zh-CN'), content:b64encode(text)};
    if(sha) body.sha=sha;                          // 更新已有文件必须带 sha
    const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(body)});
    if(!res.ok){ throw new Error('写入失败 '+res.status+' '+(await res.text().catch(()=>'')).slice(0,120)); }
    return await res.json();
  }

  // 🆕 自动建仓库：创建私有仓库 → 等初始化完成 → 写入初始同步数据
  $('#giteeInit').addEventListener('click',async ()=>{
    const c0=giteeCreds();
    if(!c0.token){ setSyncMsg('请先填写 Gitee 私人令牌','err'); return; }
    if(!c0.repo){ setSyncMsg('请先填写要创建的仓库名（如 dianong-sync）','err'); return; }
    setSyncMsg('正在创建仓库…');
    try{
      const res=await fetch(`${GITEE_API}/user/repos`,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},
        body:JSON.stringify({access_token:c0.token, name:c0.repo, description:'电工技能大赛题库 · 同步数据', private:true, auto_init:true})});
      const j=await res.json().catch(()=>({}));
      if(!res.ok){
        const msg=(j&&j.message)||(''+res.status);
        // 仓库已存在（Gitee 可能返回 400 "已经存在"）时，视为可用，继续写入
        if(!/已经存在|exist/i.test(msg)){ setSyncMsg('创建仓库失败：'+msg,'err'); return; }
        setSyncMsg('仓库已存在，继续写入初始数据…');
      }
      // 回填用户名（新建成功时用返回的 owner.login）
      if(j&&j.owner&&j.owner.login&&$gOwner){ $gOwner.value=j.owner.login; }
      const c=ensureGitee(); if(!c) return;
      // 等仓库初始化（auto_init 生成 README/默认分支需要一点时间）
      setSyncMsg('仓库已就绪，正在写入初始数据…');
      let lastErr=null;
      for(let i=0;i<6;i++){
        try{ await giteeWriteFile(c, JSON.stringify(serializeAll(),null,2), null); lastErr=null; break; }
        catch(e){ lastErr=e; await new Promise(r=>setTimeout(r,1500)); }
      }
      if(lastErr){ setSyncMsg('写入初始数据失败：'+lastErr.message,'err'); return; }
      setSyncMsg('✅ 仓库已就绪，初始数据已上传。其他设备填同样的【令牌+用户名+仓库名】点「⬇️ 拉取」即可同步。','ok');
    }catch(e){ setSyncMsg('建仓库异常：'+e.message,'err'); }
  });

  // ⬆️ 上传到 Gitee
  $('#giteeUpload').addEventListener('click',async ()=>{
    const c=ensureGitee(); if(!c) return;
    setSyncMsg('正在上传到 Gitee…');
    try{
      const cur=await giteeReadFile(c);
      await giteeWriteFile(c, JSON.stringify(serializeAll(),null,2), cur?cur.sha:null);
      setSyncMsg(`✅ 已上传到 Gitee（${c.owner}/${c.repo}/${c.path}）。其他设备点「⬇️ 拉取」同步。`,'ok');
    }catch(e){ setSyncMsg('上传异常：'+e.message,'err'); }
  });

  // ⬇️ 从 Gitee 拉取
  $('#giteeDownload').addEventListener('click',async ()=>{
    const c=ensureGitee(); if(!c) return;
    setSyncMsg('正在从 Gitee 拉取…');
    try{
      const f=await giteeReadFile(c);
      if(!f){ setSyncMsg('仓库里还没有同步文件，请先点「🆕 自动建仓库」或在其他设备点「⬆️ 上传」。','err'); return; }
      applyRemote(JSON.parse(f.content));
      setSyncMsg('✅ 已从 Gitee 拉取并合并到本地（错题本 '+wrongBook.size+' 道）。','ok');
      if(state.type==='wrongbook') renderWrongBook(); else if(state.type==='favbook') renderFavBook(); else setStats();
    }catch(e){ setSyncMsg('拉取异常：'+e.message,'err'); }
  });
  $('#syncUpload').addEventListener('click',async ()=>{
    const token=$token.value.trim(); if(!token){setSyncMsg('请先填写 GitHub Token（需 gist 权限）','err');return;}
    const body={description:'电工技能大赛理论题库 · 同步数据（自动生成）',public:false,files:{'dianong_tiku_sync.json':{content:JSON.stringify(serializeAll(),null,2)}}};
    try{
      let res, json, id=$gid.value.trim();
      if(id){ res=await gistReq(token,'/gists/'+id,{method:'PATCH',body:JSON.stringify({files:body.files})}); }
      else { res=await gistReq(token,'/gists',{method:'POST',body:JSON.stringify(body)}); }
      if(!res.ok){ setSyncMsg('上传失败：'+res.status+' '+await res.text().catch(()=>''),'err'); return; }
      json=await res.json(); persistCreds(token,json.id); $gid.value=json.id; setSyncMsg('✅ 已上传到 Gist（ID：'+json.id+'），其他设备填此 ID 即可拉取同步。','ok');
    }catch(e){ setSyncMsg('上传异常：'+e.message,'err'); }
  });
  $('#syncDownload').addEventListener('click',async ()=>{
    const token=$token.value.trim(), id=$gid.value.trim(); if(!token||!id){setSyncMsg('请先填写 Token 与 Gist ID','err');return;}
    try{
      const res=await gistReq(token,'/gists/'+id); if(!res.ok){setSyncMsg('拉取失败：'+res.status,'err');return;}
      const json=await res.json(); const file=json.files&&json.files['dianong_tiku_sync.json']; if(!file){setSyncMsg('该 Gist 无同步数据文件','err');return;}
      applyRemote(JSON.parse(file.content)); setSyncMsg('✅ 已从 Gist 拉取并合并到本地（错题本 '+wrongBook.size+' 道）。','ok');
      if(state.type==='wrongbook') renderWrongBook(); else if(state.type==='favbook') renderFavBook(); else setStats();
    }catch(e){ setSyncMsg('拉取异常：'+e.message,'err'); }
  });
  $('#syncExport').addEventListener('click',()=>{
    const blob=new Blob([JSON.stringify(serializeAll(),null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='电工题库同步数据.json'; a.click(); URL.revokeObjectURL(a.href); setSyncMsg('已导出同步数据 JSON 文件','ok');
  });
  // ---------- 同步方式切换（Gist / Gitee / 文件） ----------
  (function initSyncMethod(){
    const group=$('#syncMethodGroup'); if(!group) return;
    const panes={gist:$('#syncPaneGist'), gitee:$('#syncPaneGitee'), file:$('#syncPaneFile')};
    function show(method){
      Object.keys(panes).forEach(k=>{ if(panes[k]) panes[k].style.display = (k===method)? '' : 'none'; });
      [...group.querySelectorAll('button')].forEach(b=>b.classList.toggle('on', b.dataset.method===method));
      try{ localStorage.setItem('syncMethod', method); }catch(e){}
    }
    [...group.querySelectorAll('button')].forEach(b=>{
      b.addEventListener('click',()=>show(b.dataset.method));
    });
    // 恢复上次选择的方式
    let saved='gist';
    try{ saved=localStorage.getItem('syncMethod')||'gist'; }catch(e){}
    if(!panes[saved]) saved='gist';
    show(saved);
  })();

  $('#syncImport').addEventListener('click',()=>$('#syncFile').click());
  $('#syncFile').addEventListener('change',()=>{
    const f=$('#syncFile').files&&$('#syncFile').files[0]; if(!f) return;
    const r=new FileReader(); r.onload=()=>{ try{applyRemote(JSON.parse(String(r.result)));setSyncMsg('✅ 已导入同步数据（错题本 '+wrongBook.size+' 道）','ok');if(state.type==='wrongbook')renderWrongBook();else setStats();}catch(e){setSyncMsg('导入失败：文件格式错误','err');} };
    r.readAsText(f); $('#syncFile').value='';
  });

  // ================= PWA 安装提示 =================
  let deferredPrompt=null;
  const banner=$('#installBanner'), bannerText=$('#installBannerText');
  function isIOS(){ return /iPad|iPhone|iPod/.test(navigator.userAgent) && !/CriOS|FxiOS|OPiOS|EdgiOS/.test(navigator.userAgent); }
  function showInstallBanner(){
    if(!banner) return;
    if(isIOS()){ bannerText.innerHTML='iPhone/iPad 请用 <b>Safari</b> 打开本页 → 点右上角 <b>分享</b> → <b>添加到主屏幕</b>，即可像 APP 一样使用。'; }
    else { bannerText.textContent='可将其安装到手机/电脑主屏幕，像原生 APP 一样离线使用（Android Chrome 通常会自动提示）。'; }
    banner.style.display='flex';
  }
  window.addEventListener('beforeinstallprompt',(e)=>{ e.preventDefault(); deferredPrompt=e; showInstallBanner(); });
  $('#installBtn').addEventListener('click',async ()=>{
    if(deferredPrompt){ try{await deferredPrompt.prompt(); const r=await deferredPrompt.userChoice; if(r.outcome==='accepted') banner.style.display='none';}catch(e){} deferredPrompt=null; }
    else if(isIOS()){ alert('iPhone/iPad：请用 Safari 打开本页，点右上角分享 → 添加到主屏幕。'); }
    else { alert('当前浏览器未触发安装提示。可尝试浏览器菜单中的"安装应用/添加到主屏幕"选项，或使用 Android Chrome。'); }
  });
  $('#installClose').addEventListener('click',()=>{ banner.style.display='none'; });
  // 已安装为 PWA 时隐藏安装横幅
  if(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches) banner&&(banner.style.display='none');
  // 非 HTTPS/localhost 时给出提示（GitHub Pages 部署后为 HTTPS，本地 localhost 也允许 SW）
  if(location.protocol==='http:'&&location.hostname!=='localhost'&&location.hostname!=='127.0.0.1'){
    banner&&(banner.style.display='none');
  }

  // 初始化
  // 🎓 背题模式：恢复上次的开关状态（存 localStorage，跨会话保留）
  (function(){
    try{
      if(localStorage.getItem('reciteMode')==='1'){
        state.recite = true;
        const cb=$('#reciteMode'); if(cb) cb.checked = true;
      }
    }catch(e){}
  })();
  (function(){ const vt=document.getElementById('verTag');
    if(vt){
      vt.textContent = '当前版本：' + APP_VERSION + '（前5题附录 / 填空题96道 / 背题模式 / 555题解析）';
      // 版本号做成醒目样式 + 可点击强制刷新（用于确认浏览器加载的是最新文件）
      vt.title = '点此强制刷新到最新版本（清缓存并重新加载）';
      vt.style.cursor='pointer';
      vt.addEventListener('click',()=>{
        if(!confirm('强制刷新会清空浏览器缓存并重新加载页面。\n\n如果看不到最新功能（如「📝组卷」），点此即可。\n\n继续？')) return;
        forceReload();
      });
    } })();
  switchType('choice');
})();
